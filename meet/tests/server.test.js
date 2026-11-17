'use strict';
// サーバーの流れ：発行 → 入室（待機室・許可）→ 中継 → 退出
const test = require('node:test');
const assert = require('node:assert/strict');

const { start } = require('../server.js');
const { createMemoryStore, createUpstashStore } = require('../lib/store');

const env = { MEET_API_KEY: 'test-key' };
let server, base;
test.before(async () => {
  server = await start(0, { store: createMemoryStore(), env });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.closeAllConnections(); server.close(); });

async function call(method, path, body, headers = {}) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}

const poll = async (room, p) => (await call('GET', `/api/rooms/${room}/poll?peerId=${p.peerId}&secret=${p.secret}`)).body;
const types = (r) => r.events.map((e) => e.type);

test('予定の情報つきで通話を発行し、Meet 形のリンクが返る', async () => {
  const r = await call('POST', '/api/rooms', { title: '山田様 間取り打ち合わせ', start: '2026-11-20T10:00', end: '2026-11-20T11:00', eventRef: 'compass:evt_1' });
  assert.equal(r.status, 201);
  assert.match(r.body.id, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
  assert.equal(r.body.url, `${base}/r/${r.body.id}`);
  const info = await call('GET', `/api/rooms/${r.body.id}`);
  assert.equal(info.body.title, '山田様 間取り打ち合わせ');
  assert.equal(info.body.eventRef, 'compass:evt_1');
  assert.equal(info.body.participants, 0);
});

test('無いルームは 404、通話ページは形の正しい ID だけ返す', async () => {
  assert.equal((await call('GET', '/api/rooms/aaa-bbbb-ccc')).status, 404);
  assert.equal((await fetch(`${base}/r/not-a-room`)).status, 404);
  const room = (await call('POST', '/api/rooms', {})).body;
  const page = await fetch(`${base}/r/${room.id}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /COMPASS 通話/);
});

test('ルームの削除は API キーが要る', async () => {
  const room = (await call('POST', '/api/rooms', {})).body;
  assert.equal((await call('DELETE', `/api/rooms/${room.id}`)).status, 401);
  assert.equal((await call('DELETE', `/api/rooms/${room.id}`, null, { Authorization: 'Bearer test-key' })).status, 200);
  assert.equal((await call('GET', `/api/rooms/${room.id}`)).status, 404);
});

test('最初の人はすぐ入り、2人目は待機室で許可を待つ。許可後に中継とチャットが届く', async () => {
  const room = (await call('POST', '/api/rooms', { title: 't' })).body.id;

  const a = (await call('POST', `/api/rooms/${room}/join`, { name: '中谷' })).body;
  assert.equal(a.waiting, false);
  let ra = await poll(room, a);
  assert.deepEqual(types(ra), ['admitted']);
  assert.deepEqual(ra.events[0].data.peers, []);

  const b = (await call('POST', `/api/rooms/${room}/join`, { name: '山田' })).body;
  assert.equal(b.waiting, true);
  assert.deepEqual(types(await poll(room, b)), ['waiting']);
  ra = await poll(room, a);
  assert.deepEqual(types(ra), ['knock']);
  assert.equal(ra.events[0].data.name, '山田');

  // 許可される前は中継できない・合言葉が違うと操作できない
  assert.equal((await call('POST', `/api/rooms/${room}/signal`, { peerId: b.peerId, secret: b.secret, to: a.peerId, data: {} })).status, 403);
  assert.equal((await call('POST', `/api/rooms/${room}/admit`, { peerId: a.peerId, secret: 'x', target: b.peerId })).status, 403);
  assert.equal((await call('GET', `/api/rooms/${room}/poll?peerId=${b.peerId}&secret=x`)).status, 403);

  assert.equal((await call('POST', `/api/rooms/${room}/admit`, { peerId: a.peerId, secret: a.secret, target: b.peerId })).status, 200);
  const rb = await poll(room, b);
  assert.deepEqual(types(rb), ['admitted']);
  assert.deepEqual(rb.events[0].data.peers, [{ id: a.peerId, name: '中谷' }]);
  assert.equal(rb.state, 'joined');
  assert.deepEqual(types(await poll(room, a)), ['peer-joined', 'knock-cancel']);

  await call('POST', `/api/rooms/${room}/signal`, { peerId: b.peerId, secret: b.secret, to: a.peerId, data: { type: 'offer', sdp: 'v=0' } });
  ra = await poll(room, a);
  assert.equal(ra.events[0].type, 'signal');
  assert.equal(ra.events[0].data.from, b.peerId);
  assert.equal(ra.events[0].data.data.sdp, 'v=0');
  assert.equal(ra.roster.length, 2);

  await call('POST', `/api/rooms/${room}/chat`, { peerId: a.peerId, secret: a.secret, text: '図面を共有します' });
  const chat = (await poll(room, b)).events[0];
  assert.equal(chat.type, 'chat');
  assert.equal(chat.data.text, '図面を共有します');
  assert.equal(chat.data.name, '中谷');
  assert.deepEqual(types(await poll(room, a)), ['chat']); // 自分にも届く（画面に出すため）

  // 一度受け取った合図は二度と来ない
  assert.deepEqual(types(await poll(room, a)), []);

  assert.equal((await call('GET', `/api/rooms/${room}`)).body.participants, 2);
  await call('POST', `/api/rooms/${room}/leave`, { peerId: b.peerId, secret: b.secret });
  ra = await poll(room, a);
  assert.deepEqual(types(ra), ['peer-left']);
  assert.equal(ra.roster.length, 1);
});

test('断られた人には denied が届き、入れない', async () => {
  const room = (await call('POST', '/api/rooms', {})).body.id;
  const a = (await call('POST', `/api/rooms/${room}/join`, { name: 'A' })).body;
  const b = (await call('POST', `/api/rooms/${room}/join`, { name: 'B' })).body;
  await call('POST', `/api/rooms/${room}/deny`, { peerId: a.peerId, secret: a.secret, target: b.peerId });
  const rb = await poll(room, b);
  assert.ok(types(rb).includes('denied'));
  assert.equal(rb.state, 'denied');
  assert.equal((await call('POST', `/api/rooms/${room}/chat`, { peerId: b.peerId, secret: b.secret, text: 'x' })).status, 403);
  assert.equal((await call('GET', `/api/rooms/${room}`)).body.participants, 1);
});

test('待機室なし（lobby:false）なら2人目もそのまま入る', async () => {
  const room = (await call('POST', '/api/rooms', { lobby: false })).body.id;
  await call('POST', `/api/rooms/${room}/join`, { name: 'A' });
  const b = (await call('POST', `/api/rooms/${room}/join`, { name: 'B' })).body;
  assert.equal(b.waiting, false);
  assert.deepEqual(types(await poll(room, b)), ['admitted']);
});

test('30 秒以上取りに来ない人は抜けたとみなし、ほかの人に知らせる', async () => {
  const store = createMemoryStore();
  const s = await start(0, { store, env: {} });
  const b2 = `http://127.0.0.1:${s.address().port}`;
  const c = async (m, p, body) => (await fetch(b2 + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })).json();
  const room = (await c('POST', '/api/rooms', { lobby: false })).id;
  const a = await c('POST', `/api/rooms/${room}/join`, { name: 'A' });
  const b = await c('POST', `/api/rooms/${room}/join`, { name: 'B' });
  await store.touch(room, b.peerId, Date.now() - 31000, 3600);  // B の回線が切れたことにする
  const ra = await c('GET', `/api/rooms/${room}/poll?peerId=${a.peerId}&secret=${a.secret}`);
  assert.ok(ra.events.some((e) => e.type === 'peer-left' && e.data.id === b.peerId));
  assert.equal(ra.roster.length, 1);
  s.closeAllConnections(); s.close();
});

test('Upstash 用の置き場所は、REST の pipeline / multi-exec を正しく組み立てる', async () => {
  const sent = [];
  const fake = async (url, opts) => {
    const cmds = JSON.parse(opts.body);
    sent.push({ url, auth: opts.headers.Authorization, cmds });
    const result = cmds.map((c) => ({ result: c[0] === 'LRANGE' ? [JSON.stringify({ type: 'chat', data: {} })] : c[0] === 'HGETALL' ? ['p1', JSON.stringify({ id: 'p1', name: 'A', secret: 's', state: 'joined' })] : 'OK' }));
    return { ok: true, json: async () => (url.endsWith('/multi-exec') ? { result } : result) };
  };
  const st = createUpstashStore({ url: 'https://example.upstash.io/', token: 'tok', fetchImpl: fake });
  await st.push('r', ['p1', 'p2'], { type: 'chat', data: {} });
  assert.equal(sent[0].url, 'https://example.upstash.io/pipeline');
  assert.equal(sent[0].auth, 'Bearer tok');
  assert.deepEqual(sent[0].cmds.map((c) => c[0]), ['RPUSH', 'EXPIRE', 'RPUSH', 'EXPIRE']);
  const events = await st.drain('r', 'p1');
  assert.equal(sent[1].url, 'https://example.upstash.io/multi-exec');
  assert.deepEqual(events, [{ type: 'chat', data: {} }]);
  const peers = await st.getPeers('r');
  assert.equal(peers.p1.name, 'A');
});
