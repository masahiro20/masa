// まめレジ：レジ締め・PayPay連携・プリンター・会計ソフト用CSV
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startApp } from './helpers.js';
import { authHeader } from '../lib/paypay.js';
import { registerSummary, countTotal } from '../lib/features/register.js';
import { encodeSjis, toEscPos, twoCol, textWidth } from '../lib/features/printing.js';

const ORANGE = [{ itemId: 'orange', qty: 2 }]; // 1,000円

test('レジ締め：釣銭準備金＋現金売上±入出金 と 数えた現金の過不足', async () => {
  const t = await startApp();
  try {
    const { api } = t;
    assert.equal((await api('POST', '/api/admin/register/movements', { type: 'in', amount: 100 })).status, 409, '開ける前は入出金できない');
    await api('POST', '/api/admin/register/open', { float: 30000 });
    assert.equal((await api('POST', '/api/admin/register/open', { float: 1 })).status, 409);

    const a = await t.openWithOrder(3, ORANGE);
    await api('POST', `/api/admin/checks/${a.id}/payments`, { method: '現金', amount: 1000, received: 5000 });
    const b = await t.openWithOrder(4, ORANGE);
    await api('POST', `/api/admin/checks/${b.id}/payments`, { method: 'クレジットカード', amount: 1000 });
    await api('POST', '/api/admin/register/movements', { type: 'out', amount: 800, reason: '牛乳の買い出し' });

    const reg = (await api('GET', '/api/admin/register')).data;
    assert.equal(reg.summary.cashSales, 1000);
    assert.equal(reg.summary.expectedCash, 30000 + 1000 - 800);
    assert.equal(reg.summary.byMethod['クレジットカード'].amount, 1000);
    assert.equal(reg.summary.sales, 2000);

    const close = (await api('POST', '/api/admin/register/close', { counts: { 10000: 3, 100: 1, 50: 1, 10: 4 }, note: '' })).data;
    assert.equal(close.entry.actual, 30190);
    assert.equal(close.entry.difference, -10, '10円足りない');
    const after = (await api('GET', '/api/admin/register')).data;
    assert.equal(after.session, null);
    assert.equal(after.log[0].difference, -10);
    assert.equal(after.lastFloat, 30000, '次回は同じ準備金を提案');
  } finally { t.close(); }
});

test('レジ締めの計算（純粋関数）', () => {
  const s = registerSummary({ openedAt: '2026-10-19T00:00:00Z', float: 10000, movements: [{ type: 'in', amount: 500 }] }, [
    { status: 'closed', closedAt: '2026-10-19T01:00:00Z', totals: { total: 900 }, people: 2, payments: [{ method: '現金', amount: 900, at: '2026-10-19T01:00:00Z' }] },
    { status: 'closed', closedAt: '2026-10-18T23:00:00Z', totals: { total: 500 }, payments: [{ method: '現金', amount: 500, at: '2026-10-18T23:00:00Z' }] },
  ]);
  assert.equal(s.expectedCash, 11400, '開ける前の会計は含めない');
  assert.equal(s.salesChecks, 1);
  assert.equal(countTotal({ 1000: 2, 5: 3 }), 2015);
});

test('PayPay（テストモード）：QRを出す → 支払う → 自動で会計済み', async () => {
  const t = await startApp({ settings: { paypay: { mode: 'simulator' } } });
  try {
    const { api } = t;
    const c = await t.openWithOrder(5, ORANGE);
    const qr = (await api('POST', `/api/admin/checks/${c.id}/paypay`, {})).data;
    assert.equal(qr.pending.amount, 1000);
    assert.match(qr.svg, /<svg/);
    assert.match(qr.pending.url, /\/pay\/sim\//);
    assert.equal((await api('GET', `/api/admin/checks/${c.id}/paypay`)).data.status, 'pending');

    const mpid = qr.pending.merchantPaymentId;
    assert.equal((await api('GET', `/api/pay/sim/${mpid}`)).data.amount, 1000);
    await api('POST', `/api/pay/sim/${mpid}`);
    const done = (await api('GET', `/api/admin/checks/${c.id}/paypay`)).data;
    assert.equal(done.status, 'completed');
    assert.equal(done.closed, true);
    assert.equal(done.payment.method, 'PayPay（テスト）', 'テストの支払いは本物と区別する');
    // 二重に記録しない
    assert.equal((await api('GET', `/api/admin/checks/${c.id}/paypay`)).data.status, 'closed');
    const rep = (await api('GET', '/api/admin/report?date=2026-10-19')).data;
    assert.equal(rep.byMethod['PayPay（テスト）'], 1000);
  } finally { t.close(); }
});

test('PayPay（本番API）：署名つきでQR作成・状態確認・返金を呼ぶ', async () => {
  const calls = [];
  let paid = false;
  const SECRET = 'test-secret';
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    // 署名を受け取る側の立場で検証する
    const [, rest] = init.headers.Authorization.split('hmac OPA-Auth:');
    const [key, mac, nonce, epoch, digest] = rest.split(':');
    assert.equal(key, 'test-key');
    const ct = init.body ? 'application/json' : 'empty';
    const expDigest = init.body ? crypto.createHash('md5').update(ct + init.body).digest('base64') : 'empty';
    assert.equal(digest, expDigest);
    const expMac = crypto.createHmac('sha256', SECRET).update([u.pathname, init.method, nonce, epoch, ct, expDigest].join('\n')).digest('base64');
    assert.equal(mac, expMac, '署名が正しい');
    assert.equal(init.headers['X-ASSUME-MERCHANT'], 'M-123');
    assert.equal(u.host, 'apigw.sandbox.paypay.ne.jp');
    const json = (o) => ({ status: 200, json: async () => o });
    if (init.method === 'POST' && u.pathname === '/v2/codes') {
      const b = JSON.parse(init.body);
      assert.equal(b.amount.amount, 1000);
      assert.equal(b.codeType, 'ORDER_QR');
      return json({ resultInfo: { code: 'SUCCESS' }, data: { codeId: 'CODE1', url: 'https://qr.paypay.ne.jp/abc', deeplink: 'paypay://x', expiryDate: 1900000000 } });
    }
    if (init.method === 'GET' && u.pathname.startsWith('/v2/codes/payments/')) {
      return json(paid ? { resultInfo: { code: 'SUCCESS' }, data: { status: 'COMPLETED', paymentId: 'PAY1' } } : { resultInfo: { code: 'DYNAMIC_QR_PAYMENT_NOT_FOUND' } });
    }
    if (init.method === 'POST' && u.pathname === '/v2/refunds') {
      assert.equal(JSON.parse(init.body).paymentId, 'PAY1');
      return json({ resultInfo: { code: 'SUCCESS' }, data: { status: 'CREATED' } });
    }
    return json({ resultInfo: { code: 'SUCCESS' } });
  };
  const env = { PAYPAY_MODE: 'sandbox', PAYPAY_API_KEY: 'test-key', PAYPAY_API_SECRET: SECRET, PAYPAY_MERCHANT_ID: 'M-123' };
  const t = await startApp({ env, fetchImpl });
  try {
    const { api } = t;
    const st = await t.state();
    assert.equal(st.paypay.mode, 'sandbox');
    assert.equal(st.paypay.configured, true);
    assert.ok(!JSON.stringify(st).includes(SECRET), 'シークレットは画面に送らない');

    const c = await t.openWithOrder(6, [...ORANGE, ...ORANGE]); // 2,000円
    const qr = (await api('POST', `/api/admin/checks/${c.id}/paypay`, { amount: 1000, label: '1人目' })).data;
    assert.equal(qr.pending.url, 'https://qr.paypay.ne.jp/abc');
    assert.equal((await api('GET', `/api/admin/checks/${c.id}/paypay`)).data.status, 'pending');
    paid = true;
    const done = (await api('GET', `/api/admin/checks/${c.id}/paypay`)).data;
    assert.equal(done.status, 'completed');
    assert.equal(done.closed, false, '割り勘の1人分なのでまだ締めない');
    assert.equal(done.payment.method, 'PayPay');
    assert.equal(done.payment.external.paymentId, 'PAY1');

    // 支払いを取り消すとPayPayへ返金される
    const del = await api('DELETE', `/api/admin/checks/${c.id}/payments/${done.payment.id}`);
    assert.equal(del.status, 200);
    assert.ok(calls.some((x) => x.url.pathname === '/v2/refunds'));
  } finally { t.close(); }
});

test('PayPay：認証ヘッダーの形', () => {
  const h = authHeader({ apiKey: 'K', apiSecret: 'S', method: 'GET', path: '/v2/codes/payments/x', body: null, nonce: 'n1', epoch: 1700000000 });
  const exp = crypto.createHmac('sha256', 'S').update(['/v2/codes/payments/x', 'GET', 'n1', 1700000000, 'empty', 'empty'].join('\n')).digest('base64');
  assert.equal(h, `hmac OPA-Auth:K:${exp}:n1:1700000000:empty`);
});

test('PayPayを使わない設定では QR を出せない', async () => {
  const t = await startApp();
  try {
    const c = await t.openWithOrder(7, ORANGE);
    assert.equal((await t.api('POST', `/api/admin/checks/${c.id}/paypay`, {})).status, 409);
  } finally { t.close(); }
});

test('プリンター：現金会計でドロアを開けてレシートを自動印刷', async () => {
  const jobs = [];
  const t = await startApp({
    settings: { printer: { type: 'escpos-net', host: '192.168.0.50', port: 9100, paper: 80, autoReceipt: true, drawer: true, kitchenTicket: true } },
    printerTransport: async (p, ops, out) => { jobs.push({ ops, escpos: out.escpos }); },
  });
  try {
    const { api } = t;
    const c = await t.openWithOrder(8, ORANGE);
    assert.equal(jobs.length, 1, 'キッチン伝票');
    await api('POST', `/api/admin/checks/${c.id}/payments`, { method: '現金', amount: 1000, received: 1000 });
    await new Promise((r) => setTimeout(r, 20));
    const last = jobs.at(-1);
    assert.equal(last.ops[0].t, 'pulse', 'ドロアを開ける');
    assert.ok(last.ops.some((o) => o.t === 'row' && o.l === '合計'));
    const sjisTotal = Buffer.from(encodeSjis('合計'));
    assert.ok(last.escpos.includes(sjisTotal), 'Shift_JISで印字');
  } finally { t.close(); }
});

test('プリンター：EPSON Server Direct Print はプリンターが取りに来る', async () => {
  const t = await startApp({ settings: { printer: { type: 'epson-sdp', paper: 80, drawer: false } } });
  try {
    const { api } = t;
    await api('POST', '/api/admin/print/test');
    const st = await t.state();
    assert.equal(st.printer.queued, 1);
    const token = st.settings.printer.token;
    assert.equal((await api('POST', '/api/printer/epson?token=wrong', 'ConnectionType=GetRequest', { raw: true })).status, 403);
    const got = await api('POST', `/api/printer/epson?token=${token}`, 'ConnectionType=GetRequest&ID=1', { raw: true });
    assert.match(got.data, /<PrintRequestInfo/);
    assert.match(got.data, /まめレジ テスト印刷/);
    const empty = await api('POST', `/api/printer/epson?token=${token}`, 'ConnectionType=GetRequest&ID=1', { raw: true });
    assert.equal(empty.data, '', '印刷待ちがなければ空');
  } finally { t.close(); }
});

test('レシートの文字幅と2列配置', () => {
  assert.equal(textWidth('合計 ¥1,000'), 4 + 1 + 6);
  const row = twoCol('とても長い商品名のバスクチーズケーキ', '¥500', 20);
  assert.equal(textWidth(row), 20);
  assert.ok(row.endsWith('¥500'));
  const bytes = toEscPos([{ t: 'text', s: 'テスト' }, { t: 'cut' }], 32);
  assert.equal(bytes[0], 0x1b);
});

test('会計ソフト用の日別CSV', async () => {
  const t = await startApp();
  try {
    const { api } = t;
    const c = await t.openWithOrder(9, ORANGE);
    await api('POST', `/api/admin/checks/${c.id}/payments`, { method: '現金', amount: 1000 });
    const csv = (await api('GET', '/api/admin/export.csv?from=2026-10-19&type=daily')).data;
    const [head, row] = csv.replace(/^﻿/, '').split('\r\n');
    assert.match(head, /売上合計\(税込\)/);
    assert.match(head, /入金:現金/);
    assert.match(row, /^2026-10-19,1,2,1000,1000,90,0,0,/);
  } finally { t.close(); }
});
