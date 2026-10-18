import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../lib/app.js';

let server; let base; let cookie = ''; let app; let dir;
// 平日の 12:00 (JST) に固定
const fixedNow = () => new Date('2026-10-19T03:00:00Z');

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cafe-test-'));
  app = createApp({ dataDir: dir, now: fixedNow });
  server = http.createServer((req, res) => app.handle(req, res));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); app.store.saveNow(); fs.rmSync(dir, { recursive: true, force: true }); });

async function api(method, p, body, { admin = false } = {}) {
  const res = await fetch(base + p, {
    method, headers: { 'Content-Type': 'application/json', ...(admin ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
}

test('お客様のスマホ注文 → オーナー画面 → 割り勘で会計', async () => {
  assert.equal((await api('POST', '/api/admin/login', { pin: '0000' })).status, 401);
  assert.equal((await api('POST', '/api/admin/login', { pin: '1234' })).status, 200);
  const st = (await api('GET', '/api/admin/state', null, { admin: true })).data;
  const tag = st.tags.find((t) => t.no === 3);

  // 不正なキーでは注文できない
  assert.equal((await api('GET', `/api/c/session?tag=3&k=wrong`)).status, 403);

  const ses = (await api('GET', `/api/c/session?tag=3&k=${tag.key}&device=d1`)).data;
  assert.equal(ses.tagNo, 3);
  assert.equal(ses.check, null);
  assert.ok(ses.menu.items.find((i) => i.id === 'basque'));
  assert.ok(!ses.menu.items.find((i) => i.id === 'ticket11'), 'スタッフ専用商品は出さない');
  assert.equal(ses.menu.items.find((i) => i.id === 'morning').orderable, false, '12時はモーニング終了');

  // 必須オプション未選択はエラー
  const bad = await api('POST', '/api/c/order', { tag: 3, k: tag.key, device: 'd1', knownCheckId: null, lines: [{ itemId: 'basque', qty: 1 }] });
  assert.equal(bad.status, 409);

  const o1 = await api('POST', '/api/c/order', {
    tag: 3, k: tag.key, device: 'd1', name: 'あや', people: 2, knownCheckId: null, clientOrderId: 'x1',
    lines: [
      { itemId: 'blend', qty: 1, sel: { temp: ['hot'] }, timing: 'after', unitPrice: 1 },
      { itemId: 'basque', qty: 1, sel: { flavor: ['l1'], set: [] } },
    ],
  });
  assert.equal(o1.status, 200, JSON.stringify(o1.data));
  assert.equal(o1.data.check.total, 500 + 600, 'クライアントの金額は無視してサーバーで計算');
  const checkId = o1.data.check.id;

  // 同じ clientOrderId の再送は二重注文にならない
  const dup = await api('POST', '/api/c/order', {
    tag: 3, k: tag.key, device: 'd1', knownCheckId: checkId, clientOrderId: 'x1', lines: [{ itemId: 'blend', qty: 1, sel: { temp: ['hot'] } }],
  });
  assert.equal(dup.data.check.orders.length, 1);

  // 同じテーブルの別のスマホから追加
  await api('POST', '/api/c/order', {
    tag: 3, k: tag.key, device: 'd2', name: 'けん', knownCheckId: checkId, lines: [{ itemId: 'napolitan', qty: 1, sel: { size: ['large'] } }],
  });
  await api('POST', '/api/c/call', { tag: 3, k: tag.key, type: 'お会計をお願いします' });

  let state = (await api('GET', '/api/admin/state', null, { admin: true })).data;
  const ck = state.openChecks.find((c) => c.id === checkId);
  assert.equal(ck.orders.length, 2);
  assert.equal(ck.people, 2);
  assert.equal(state.calls.length, 1);

  // コーヒーチケット1枚 → ブレンド500円分を値引き
  await api('PATCH', `/api/admin/checks/${checkId}`, { tickets: 1 }, { admin: true });
  // 割り勘（均等）
  state = (await api('GET', '/api/admin/state', null, { admin: true })).data;
  const total = 600 + 1100; // ケーキ600 + ナポリタン大盛1100
  const p1 = await api('POST', `/api/admin/checks/${checkId}/payments`, { method: 'QR決済', amount: 850, label: '1人目' }, { admin: true });
  assert.equal(p1.data.closed, false);
  const p2 = await api('POST', `/api/admin/checks/${checkId}/payments`, { method: '現金', amount: total - 850, received: 1000, label: '2人目' }, { admin: true });
  assert.equal(p2.status, 200, JSON.stringify(p2.data));
  assert.equal(p2.data.closed, true);
  assert.equal(p2.data.payment.change, 150);

  state = (await api('GET', '/api/admin/state', null, { admin: true })).data;
  assert.equal(state.openChecks.length, 0);
  assert.equal(state.calls.length, 0, '会計済みの呼び出しは消える');

  // 会計後の古い画面からの注文はブロック
  const stale = await api('POST', '/api/c/order', { tag: 3, k: tag.key, device: 'd1', knownCheckId: checkId, lines: [{ itemId: 'orange', qty: 1 }] });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'check_changed');

  const rep = (await api('GET', '/api/admin/report?date=2026-10-19', null, { admin: true })).data;
  assert.equal(rep.sales, total);
  assert.equal(rep.tickets, 1);
  assert.equal(rep.byMethod['現金'], total - 850);

  const csv = await api('GET', '/api/admin/export.csv?from=2026-10-19&type=items', null, { admin: true });
  assert.match(csv.data, /バスクチーズケーキ/);
});

test('本日の準備：売り切れ・残数・日替わりの中身', async () => {
  await api('PATCH', '/api/admin/items/scone', { stock: 1, choice: { groupId: 'kind', choiceId: 'daily', detail: 'かぼちゃ' } }, { admin: true });
  const st = (await api('GET', '/api/admin/state', null, { admin: true })).data;
  const tag = st.tags.find((t) => t.no === 5);
  const ses = (await api('GET', `/api/c/session?tag=5&k=${tag.key}`)).data;
  const scone = ses.menu.items.find((i) => i.id === 'scone');
  assert.equal(scone.stockLeft, 1);
  assert.equal(scone.optionGroups[0].choices[1].detail, 'かぼちゃ');

  const tooMany = await api('POST', '/api/c/order', { tag: 5, k: tag.key, knownCheckId: null, lines: [{ itemId: 'scone', qty: 2, sel: { kind: ['daily'] } }] });
  assert.equal(tooMany.status, 409);
  assert.match(tooMany.data.error, /残り1点/);
  const after = (await api('GET', '/api/admin/state', null, { admin: true })).data;
  assert.equal(after.openChecks.length, 0, '失敗した注文で空の伝票を残さない');

  const ok = await api('POST', '/api/c/order', { tag: 5, k: tag.key, knownCheckId: null, lines: [{ itemId: 'scone', qty: 1, sel: { kind: ['daily'] } }] });
  assert.equal(ok.status, 200);
  const ses2 = (await api('GET', `/api/c/session?tag=5&k=${tag.key}`)).data;
  assert.equal(ses2.menu.items.find((i) => i.id === 'scone').orderable, false, '残数0で自動的に売り切れ');

  // 取消すると在庫が戻る
  const check = (await api('GET', '/api/admin/state', null, { admin: true })).data.openChecks.find((c) => c.tagNo === 5);
  await api('POST', `/api/admin/checks/${check.id}/lines/${check.orders[0].lines[0].id}`, { status: 'cancelled' }, { admin: true });
  const ses3 = (await api('GET', `/api/c/session?tag=5&k=${tag.key}`)).data;
  assert.equal(ses3.menu.items.find((i) => i.id === 'scone').stockLeft, 1);
});

test('スマホを持っていないお客様：スタッフが受付・番号札の移動・合流', async () => {
  const a = (await api('POST', '/api/admin/checks', { tagNo: 8, people: 1 }, { admin: true })).data.check;
  await api('POST', `/api/admin/checks/${a.id}/orders`, { lines: [{ itemId: 'beans', qty: 1, sel: { grind: ['paper'] } }] }, { admin: true });
  const dupOpen = await api('POST', '/api/admin/checks', { tagNo: 8 }, { admin: true });
  assert.equal(dupOpen.status, 409);

  const b = (await api('POST', '/api/admin/checks', { tagNo: 9, people: 2 }, { admin: true })).data.check;
  await api('POST', `/api/admin/checks/${b.id}/orders`, { lines: [{ itemId: 'orange', qty: 2 }] }, { admin: true });
  const merged = (await api('POST', `/api/admin/checks/${a.id}/merge`, { fromId: b.id }, { admin: true })).data.check;
  assert.equal(merged.people, 3);
  assert.equal(merged.orders.length, 2);

  const moved = await api('PATCH', `/api/admin/checks/${a.id}`, { tagNo: 12 }, { admin: true });
  assert.equal(moved.data.check.tagNo, 12);

  // カウンター会計（番号札なし）
  const c = (await api('POST', '/api/admin/checks', { tagNo: null, takeout: true }, { admin: true })).data.check;
  assert.equal(c.tagNo, null);
  const voided = await api('POST', `/api/admin/checks/${c.id}/void`, {}, { admin: true });
  assert.equal(voided.status, 200);
});

test('注文停止中・ログインなしは拒否', async () => {
  await api('PUT', '/api/admin/settings', { orderingPaused: true }, { admin: true });
  const st = (await api('GET', '/api/admin/state', null, { admin: true })).data;
  const tag = st.tags[0];
  const r = await api('POST', '/api/c/order', { tag: 1, k: tag.key, knownCheckId: null, lines: [{ itemId: 'orange', qty: 1 }] });
  assert.equal(r.status, 423);
  await api('PUT', '/api/admin/settings', { orderingPaused: false }, { admin: true });
  const saved = cookie; cookie = '';
  assert.equal((await api('GET', '/api/admin/state', null, { admin: true })).status, 401);
  cookie = saved;
});

test('連動キーの枠はまとめて更新される', async () => {
  await api('PATCH', '/api/admin/items/scone', { choice: { groupId: 'kind', choiceId: 'daily', detail: 'ほうじ茶', soldOut: true } }, { admin: true });
  const st = (await api('GET', '/api/admin/state', null, { admin: true })).data;
  const brunch = st.items.find((i) => i.id === 'brunch').optionGroups.find((g) => g.id === 'scone').choices.find((c) => c.id === 'daily');
  assert.equal(brunch.detail, 'ほうじ茶');
  assert.equal(brunch.soldOutDate, st.ctx.bizDate);
});

test('先に会計したカウンター注文は、提供するまで注文ボードに残る', async () => {
  const c = (await api('POST', '/api/admin/checks', { tagNo: 15 }, { admin: true })).data.check;
  await api('POST', `/api/admin/checks/${c.id}/orders`, { lines: [{ itemId: 'orange', qty: 1 }] }, { admin: true });
  const pay = await api('POST', `/api/admin/checks/${c.id}/payments`, { method: '現金', amount: 500 }, { admin: true });
  assert.equal(pay.data.closed, true);
  let st = (await api('GET', '/api/admin/state', null, { admin: true })).data;
  assert.ok(!st.openChecks.some((x) => x.id === c.id), '番号札は空く');
  const waiting = st.pendingServe.find((x) => x.id === c.id);
  assert.ok(waiting, '未提供の品は注文ボードに残る');
  const line = waiting.orders[0].lines[0];
  assert.equal((await api('POST', `/api/admin/checks/${c.id}/lines/${line.id}`, { status: 'cancelled' }, { admin: true })).status, 409);
  await api('POST', `/api/admin/checks/${c.id}/serve`, {}, { admin: true });
  st = (await api('GET', '/api/admin/state', null, { admin: true })).data;
  assert.ok(!st.pendingServe.some((x) => x.id === c.id), '提供済みになったら消える');
});
