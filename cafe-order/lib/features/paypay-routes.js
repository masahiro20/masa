// PayPay 連携の画面・API。
// 会計画面で「PayPay」→ 金額入りQRを表示 → お客様が支払う → 状態を確認して自動で会計に記録。
//
// キーは環境変数（推奨）か設定画面で入れる。シークレットは画面に二度と表示しない。
//   PAYPAY_MODE=sandbox|production  PAYPAY_API_KEY  PAYPAY_API_SECRET  PAYPAY_MERCHANT_ID
import { createPayPayClient, createSimulator, PayPayError } from '../paypay.js';

const MODES = ['off', 'simulator', 'sandbox', 'production'];
export const PAYPAY_METHOD = 'PayPay';
export const PAYPAY_TEST_METHOD = 'PayPay（テスト）';

export function installPayPay(f) {
  const { route, S, store, fail, str, int, newId, findOpen, recordPayment, publicBase, refunders, computeTotals, notifyAdmin, onSettings, env, fetchImpl, QRCode } = f;
  const simulator = createSimulator();
  const secrets = () => (S().secrets ||= {});

  function config() {
    const saved = secrets().paypay || {};
    const fromEnv = env.PAYPAY_API_KEY && env.PAYPAY_API_SECRET && env.PAYPAY_MERCHANT_ID;
    const mode = env.PAYPAY_MODE && MODES.includes(env.PAYPAY_MODE) ? env.PAYPAY_MODE : (S().settings.paypay?.mode || 'off');
    return {
      mode,
      source: fromEnv ? 'env' : 'settings',
      apiKey: fromEnv ? env.PAYPAY_API_KEY : saved.apiKey,
      apiSecret: fromEnv ? env.PAYPAY_API_SECRET : saved.apiSecret,
      merchantId: fromEnv ? env.PAYPAY_MERCHANT_ID : saved.merchantId,
    };
  }
  function client() {
    const c = config();
    if (c.mode === 'off') fail(409, 'PayPay連携は「使わない」になっています（設定 → 電子決済）');
    if (c.mode === 'simulator') return simulator;
    try {
      return createPayPayClient({ ...c, fetchImpl });
    } catch (e) {
      fail(409, e.message);
    }
    return null;
  }
  const methodName = () => (config().mode === 'simulator' ? PAYPAY_TEST_METHOD : PAYPAY_METHOD);
  const asHttp = (e) => (e instanceof PayPayError ? fail(502, e.message, e.code) : Promise.reject(e));

  // 支払いが完了していたら会計に記録する（同じ支払いは二重に記録しない）
  function settle(check, pending, paymentId) {
    if (check.payments.some((p) => p.external?.merchantPaymentId === pending.merchantPaymentId)) return { already: true };
    check.pendingPaypay = null;
    const r = recordPayment(check, {
      method: pending.simulated ? PAYPAY_TEST_METHOD : PAYPAY_METHOD, amount: pending.amount, label: pending.label,
      external: { provider: 'paypay', merchantPaymentId: pending.merchantPaymentId, paymentId, simulated: !!pending.simulated, mode: pending.mode },
    });
    return r;
  }

  // ---- QRを出す ----
  route('POST', '/api/admin/checks/:id/paypay', async ({ params, body, req }) => {
    const check = findOpen(params.id);
    const t = computeTotals(check, S().settings);
    const amount = int(body.amount || t.remaining);
    if (amount <= 0 || amount > t.remaining) fail(400, `金額が正しくありません（残り ${t.remaining}円）`);
    const c = client();
    const mode = config().mode;
    // 前のQRが残っていたら消す
    if (check.pendingPaypay) await c.deleteQr(check.pendingPaypay.codeId).catch(() => {});
    const merchantPaymentId = `mame_${newId()}`.replace(/[^\w-]/g, '').slice(0, 60);
    const description = `${S().settings.shopName} ${check.tagNo == null ? 'カウンター' : `${check.tagNo}番`}`.slice(0, 80);
    const qr = await c.createQr({ merchantPaymentId, amount, description, publicBase: publicBase(req) }).catch(asHttp);
    check.pendingPaypay = {
      merchantPaymentId, codeId: qr.codeId, url: qr.url, deeplink: qr.deeplink, amount, label: str(body.label, 30),
      createdAt: new Date().toISOString(), expiresAt: qr.expiresAt, simulated: mode === 'simulator', mode,
    };
    store.save();
    const svg = await QRCode.toString(qr.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { ok: true, pending: check.pendingPaypay, svg };
  });

  // ---- 支払い状況（画面から数秒おきに確認）----
  route('GET', '/api/admin/checks/:id/paypay', async ({ params }) => {
    let check = S().openChecks.find((c) => c.id === params.id);
    if (!check) return { status: 'closed' };
    const pending = check.pendingPaypay;
    if (!pending) return { status: 'none' };
    const c = pending.simulated ? simulator : client();
    const st = await c.getStatus(pending.merchantPaymentId).catch(asHttp);
    check = S().openChecks.find((x) => x.id === params.id); // 確認している間に状況が変わっていないか
    if (!check || check.pendingPaypay?.merchantPaymentId !== pending.merchantPaymentId) return { status: 'none' };
    if (st.status === 'completed') {
      const r = settle(check, pending, st.paymentId);
      return { status: 'completed', closed: !!r.closed, payment: r.payment, check };
    }
    if (st.status === 'failed') {
      check.pendingPaypay = null;
      store.save();
      return { status: 'failed', reason: st.reason };
    }
    return { status: 'pending', pending };
  });

  // ---- やめる（支払われていたら記録する）----
  route('DELETE', '/api/admin/checks/:id/paypay', async ({ params }) => {
    const check = findOpen(params.id);
    const pending = check.pendingPaypay;
    if (!pending) return { ok: true, status: 'none' };
    const c = pending.simulated ? simulator : client();
    const st = await c.getStatus(pending.merchantPaymentId).catch(() => ({ status: 'pending' }));
    if (st.status === 'completed') {
      const r = settle(check, pending, st.paymentId);
      return { ok: true, status: 'completed', closed: !!r.closed, payment: r.payment, check };
    }
    await c.deleteQr(pending.codeId).catch(() => {});
    check.pendingPaypay = null;
    store.save();
    return { ok: true, status: 'cancelled' };
  });

  // ---- 返金（支払いの取り消し・会計の取り消し時）----
  refunders.paypay = async (p) => {
    const ext = p.external;
    if (ext.simulated) return;
    const c = client();
    await c.refund({ merchantRefundId: `mame_rf_${newId()}`.replace(/[^\w-]/g, '').slice(0, 60), paymentId: ext.paymentId, amount: p.amount, reason: '会計の取り消し' }).catch(asHttp);
    notifyAdmin('changed', {});
  };

  // ---- 接続テスト ----
  route('POST', '/api/admin/paypay/check', async () => {
    const c = client();
    const r = await c.check().catch(asHttp);
    return { ok: true, mode: config().mode, ...r };
  });

  // ---- テストモード：QRを読むと開くページから「支払う」----
  function findPending(mpid) {
    for (const c of S().openChecks) if (c.pendingPaypay?.merchantPaymentId === mpid) return c;
    return null;
  }
  route('GET', '/api/pay/sim/:mpid', ({ params }) => {
    const check = findPending(params.mpid);
    if (!check || !check.pendingPaypay.simulated) return { status: 'unknown', shop: S().settings.shopName };
    return { status: 'pending', amount: check.pendingPaypay.amount, shop: S().settings.shopName };
  });
  route('POST', '/api/pay/sim/:mpid', ({ params }) => {
    const check = findPending(params.mpid);
    if (!check || !check.pendingPaypay.simulated) fail(404, 'このQRコードは使えません（期限切れか、テストモードではありません）');
    simulator.markPaid(params.mpid);
    notifyAdmin('paypay', { checkId: check.id });
    return { ok: true };
  });

  // ---- 設定 ----
  onSettings((b, s) => {
    if (!b.paypay) return;
    const mode = MODES.includes(b.paypay.mode) ? b.paypay.mode : 'off';
    s.paypay = { mode };
    const cur = secrets().paypay || {};
    secrets().paypay = {
      merchantId: b.paypay.merchantId != null ? str(b.paypay.merchantId, 80) : cur.merchantId,
      apiKey: b.paypay.apiKey != null ? str(b.paypay.apiKey, 120) : cur.apiKey,
      // シークレットは空欄なら変更しない
      apiSecret: b.paypay.apiSecret ? str(b.paypay.apiSecret, 200) : cur.apiSecret,
    };
  });

  return {
    state: () => {
      const c = config();
      return {
        paypay: {
          mode: c.mode, source: c.source, method: methodName(),
          configured: c.mode === 'simulator' || !!(c.apiKey && c.apiSecret && c.merchantId),
          merchantId: c.merchantId ? `${String(c.merchantId).slice(0, 4)}…` : '', hasKey: !!c.apiKey, hasSecret: !!c.apiSecret,
        },
      };
    },
  };
}
