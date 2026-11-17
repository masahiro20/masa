'use strict';
// サーバーの流れ：発行 → 入室（待機室・許可）→ 中継 → 退出
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.DATA_FILE = 'none';
process.env.MEET_API_KEY = 'test-key';
const { start } = require('../server.js');

let server, base;
test.before(async () => {
  server = await start(0);
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

// SSE を読んで、届いたイベントを順に取り出せるようにする
function listen(path) {
  const queue = [];
  const waiters = [];
  const req = http.get(base + path, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block);
        const data = /^data: (.+)$/m.exec(block);
        if (!ev) continue;
        const item = { type: ev[1], data: data ? JSON.parse(data[1]) : null };
        const w = waiters.shift();
        if (w) w(item); else queue.push(item);
      }
    });
  });
  return {
    next(timeout = 2000) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('イベントが来ない')), timeout);
        waiters.push((x) => { clearTimeout(t); resolve(x); });
      });
    },
    close() { req.destroy(); },
  };
}

test('予定の情報つきで通話を発行し、Meet 形のリンクが返る', async () => {
  const r = await call('POST', '/api/rooms', { title: '山田様 間取り打ち合わせ', start: '2026-11-20T10:00', end: '2026-11-20T11:00', eventRef: 'compass:evt_1' });
  assert.equal(r.status, 201);
  assert.match(r.body.id, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
  assert.equal(r.body.url, `${base.replace('127.0.0.1', '127.0.0.1')}/r/${r.body.id}`);
  assert.equal(r.body.title, '山田様 間取り打ち合わせ');
  const info = await call('GET', `/api/rooms/${r.body.id}`);
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
  const room = (await call('POST', '/api/rooms', { title: 't' })).body;

  const a = (await call('POST', `/api/rooms/${room.id}/join`, { name: '中谷' })).body;
  assert.equal(a.waiting, false);
  const aEv = listen(`/api/rooms/${room.id}/events?peerId=${a.peerId}&secret=${a.secret}`);
  const adm = await aEv.next();
  assert.equal(adm.type, 'admitted');
  assert.deepEqual(adm.data.peers, []);

  const b = (await call('POST', `/api/rooms/${room.id}/join`, { name: '山田' })).body;
  assert.equal(b.waiting, true);
  const bEv = listen(`/api/rooms/${room.id}/events?peerId=${b.peerId}&secret=${b.secret}`);
  assert.equal((await bEv.next()).type, 'waiting');
  const knock = await aEv.next();
  assert.equal(knock.type, 'knock');
  assert.equal(knock.data.name, '山田');

  // 許可される前は中継できない
  const early = await call('POST', `/api/rooms/${room.id}/signal`, { peerId: b.peerId, secret: b.secret, to: a.peerId, data: {} });
  assert.equal(early.status, 403);

  // 合言葉が違うと操作できない
  const forged = await call('POST', `/api/rooms/${room.id}/admit`, { peerId: a.peerId, secret: 'x', target: b.peerId });
  assert.equal(forged.status, 403);

  assert.equal((await call('POST', `/api/rooms/${room.id}/admit`, { peerId: a.peerId, secret: a.secret, target: b.peerId })).status, 200);
  const bAdm = await bEv.next();
  assert.equal(bAdm.type, 'admitted');
  assert.deepEqual(bAdm.data.peers, [{ id: a.peerId, name: '中谷' }]);
  const joined = await aEv.next();
  assert.equal(joined.type, 'peer-joined');
  assert.equal((await aEv.next()).type, 'knock-cancel');

  await call('POST', `/api/rooms/${room.id}/signal`, { peerId: b.peerId, secret: b.secret, to: a.peerId, data: { type: 'offer', sdp: 'v=0' } });
  const sig = await aEv.next();
  assert.equal(sig.type, 'signal');
  assert.equal(sig.data.from, b.peerId);
  assert.equal(sig.data.data.sdp, 'v=0');

  await call('POST', `/api/rooms/${room.id}/chat`, { peerId: a.peerId, secret: a.secret, text: '図面を共有します' });
  const chatB = await bEv.next();
  assert.equal(chatB.type, 'chat');
  assert.equal(chatB.data.text, '図面を共有します');
  assert.equal(chatB.data.name, '中谷');
  assert.equal((await aEv.next()).type, 'chat'); // 自分にも届く（画面に出すため）

  assert.equal((await call('GET', `/api/rooms/${room.id}`)).body.participants, 2);

  await call('POST', `/api/rooms/${room.id}/leave`, { peerId: b.peerId, secret: b.secret });
  const left = await aEv.next();
  assert.equal(left.type, 'peer-left');
  assert.equal(left.data.id, b.peerId);
  aEv.close(); bEv.close();
});

test('断られた人には denied が届き、入れない', async () => {
  const room = (await call('POST', '/api/rooms', {})).body;
  const a = (await call('POST', `/api/rooms/${room.id}/join`, { name: 'A' })).body;
  const aEv = listen(`/api/rooms/${room.id}/events?peerId=${a.peerId}&secret=${a.secret}`);
  await aEv.next();
  const b = (await call('POST', `/api/rooms/${room.id}/join`, { name: 'B' })).body;
  const bEv = listen(`/api/rooms/${room.id}/events?peerId=${b.peerId}&secret=${b.secret}`);
  await bEv.next();
  await aEv.next();
  await call('POST', `/api/rooms/${room.id}/deny`, { peerId: a.peerId, secret: a.secret, target: b.peerId });
  assert.equal((await bEv.next()).type, 'denied');
  assert.equal((await call('GET', `/api/rooms/${room.id}`)).body.participants, 1);
  aEv.close(); bEv.close();
});

test('待機室なし（lobby:false）なら2人目もそのまま入る', async () => {
  const room = (await call('POST', '/api/rooms', { lobby: false })).body;
  const a = (await call('POST', `/api/rooms/${room.id}/join`, { name: 'A' })).body;
  const aEv = listen(`/api/rooms/${room.id}/events?peerId=${a.peerId}&secret=${a.secret}`);
  await aEv.next();
  const b = (await call('POST', `/api/rooms/${room.id}/join`, { name: 'B' })).body;
  assert.equal(b.waiting, false);
  const bEv = listen(`/api/rooms/${room.id}/events?peerId=${b.peerId}&secret=${b.secret}`);
  assert.equal((await bEv.next()).type, 'admitted');
  aEv.close(); bEv.close();
});
