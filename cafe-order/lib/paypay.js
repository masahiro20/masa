// PayPay 連携（動的QRコード決済）。
// 会計画面に金額入りのQRを出し、お客様がPayPayアプリで読み取って支払うと自動で会計済みになる。
//
//  mode: 'off'       … 使わない
//        'simulator' … テスト用。PayPayに接続せず、画面のボタンで「支払われた」ことにできる
//        'sandbox'   … PayPayのテスト環境（PayPay for Developers のテスト用キー）
//        'production'… 本番（審査後に発行される本番キー）
//
// 署名の作り方は PayPay 公式SDK (@paypayopa/paypayopa-sdk-node) と同じ。
import crypto from 'node:crypto';

const HOSTS = { sandbox: 'apigw.sandbox.paypay.ne.jp', production: 'apigw.paypay.ne.jp' };

// Authorization ヘッダー: hmac OPA-Auth:<APIキー>:<署名>:<nonce>:<epoch>:<本文ダイジェスト>
export function authHeader({ apiKey, apiSecret, method, path, body, nonce, epoch }) {
  let contentType = 'empty';
  let digest = 'empty';
  if (body != null && body !== '') {
    contentType = 'application/json';
    digest = crypto.createHash('md5').update(contentType).update(body).digest('base64');
  }
  const raw = [path, method, nonce, epoch, contentType, digest].join('\n');
  const mac = crypto.createHmac('sha256', apiSecret).update(raw).digest('base64');
  return `hmac OPA-Auth:${[apiKey, mac, nonce, epoch, digest].join(':')}`;
}

export class PayPayError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}

export function createPayPayClient({ mode, apiKey, apiSecret, merchantId, fetchImpl = globalThis.fetch }) {
  const host = HOSTS[mode];
  if (!host) throw new Error(`unknown PayPay mode: ${mode}`);
  if (!apiKey || !apiSecret || !merchantId) throw new PayPayError('PayPayのAPIキー・シークレット・加盟店IDが設定されていません', 'not_configured');

  async function call(method, path, payload) {
    const body = payload ? JSON.stringify({ ...payload, requestedAt: Math.floor(Date.now() / 1000) }) : null;
    const headers = {
      Authorization: authHeader({ apiKey, apiSecret, method, path: path.split('?')[0], body, nonce: crypto.randomUUID(), epoch: Math.floor(Date.now() / 1000) }),
      'X-ASSUME-MERCHANT': merchantId,
    };
    if (body) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetchImpl(`https://${host}${path}`, { method, headers, body });
    } catch (e) {
      throw new PayPayError(`PayPayに接続できませんでした（${e.message}）`, 'network');
    }
    const json = await res.json().catch(() => ({}));
    const code = json?.resultInfo?.code || '';
    return { status: res.status, code, message: json?.resultInfo?.message || '', data: json?.data || null };
  }

  return {
    // 金額入りQRコードを作る
    async createQr({ merchantPaymentId, amount, description }) {
      const r = await call('POST', '/v2/codes', {
        merchantPaymentId, amount: { amount, currency: 'JPY' }, codeType: 'ORDER_QR', orderDescription: description, isAuthorization: false,
      });
      if (r.code !== 'SUCCESS' || !r.data) throw new PayPayError(`QRコードを作れませんでした（${r.code || r.status} ${r.message}）`, r.code, r.status);
      return { codeId: r.data.codeId, url: r.data.url, deeplink: r.data.deeplink, expiresAt: r.data.expiryDate ? new Date(r.data.expiryDate * 1000).toISOString() : null };
    },
    // 支払い状況。まだ支払われていなければ status: 'pending'
    async getStatus(merchantPaymentId) {
      const r = await call('GET', `/v2/codes/payments/${encodeURIComponent(merchantPaymentId)}`);
      const st = r.data?.status;
      if (r.code === 'SUCCESS' && st === 'COMPLETED') return { status: 'completed', paymentId: r.data.paymentId };
      if (r.code === 'SUCCESS' && ['EXPIRED', 'FAILED', 'CANCELED'].includes(st)) return { status: 'failed', reason: st };
      if (r.status === 401 || r.status === 403) throw new PayPayError('PayPayの認証に失敗しました。キーの設定を確認してください', r.code, r.status);
      return { status: 'pending' };
    },
    async deleteQr(codeId) {
      await call('DELETE', `/v2/codes/${encodeURIComponent(codeId)}`);
    },
    async refund({ merchantRefundId, paymentId, amount, reason }) {
      const r = await call('POST', '/v2/refunds', { merchantRefundId, paymentId, amount: { amount, currency: 'JPY' }, reason });
      if (r.code !== 'SUCCESS') throw new PayPayError(`返金できませんでした（${r.code || r.status} ${r.message}）`, r.code, r.status);
      return r.data;
    },
    // 接続テスト：存在しない支払いを問い合わせ、認証が通るか（401/403にならないか）を見る
    async check() {
      const r = await call('GET', `/v2/codes/payments/mamereji-check-${Date.now()}`);
      if (r.status === 401 || r.status === 403) throw new PayPayError(`認証に失敗しました（${r.code || r.status}）`, r.code, r.status);
      return { ok: true, code: r.code };
    },
  };
}

// テスト用：PayPayに接続しない。QRは /pay/sim/:id のページを指し、そこで「支払う」と完了になる
export function createSimulator() {
  const paid = new Map(); // merchantPaymentId -> paymentId
  return {
    simulated: true,
    async createQr({ merchantPaymentId, publicBase }) {
      return { codeId: `sim-${merchantPaymentId}`, url: `${publicBase}/pay/sim/${merchantPaymentId}`, deeplink: null, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
    },
    async getStatus(merchantPaymentId) {
      return paid.has(merchantPaymentId) ? { status: 'completed', paymentId: paid.get(merchantPaymentId) } : { status: 'pending' };
    },
    async deleteQr() {},
    async refund() { return { status: 'REFUNDED' }; },
    async check() { return { ok: true, code: 'SIMULATOR' }; },
    markPaid(merchantPaymentId) { paid.set(merchantPaymentId, `sim-pay-${merchantPaymentId}`); },
  };
}
