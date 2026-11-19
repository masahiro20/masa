'use strict';
// API の試験：権限・不正操作・情報の出し方を中心に確かめる
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { boot } = require('./helpers');
const sec = require('../lib/secure');

let t; // 共通のサーバー
test.before(async () => { t = await boot(); });
test.after(() => t.close());

async function newRoom(owner = 'nakatani', body = {}) {
  const s = await t.login(owner);
  const r = await s.as('POST', '/api/rooms', { title: '山田様 間取りのご相談', customerName: '山田 太郎', customerId: 'C-1001', ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { s, room: r.body };
}

async function hostIn(roomId, s) {
  const { res, p } = await t.joinAs(roomId, '中谷', {}, { Cookie: s.cookie });
  assert.equal(res.status, 200);
  assert.equal(res.body.role, 'host');
  return p;
}

// ---------- ルームの作成 ----------
test('ログインしていない人はルームを作れない', async () => {
  const r = await t.call('POST', '/api/rooms', { title: 'x' });
  assert.equal(r.status, 401);
});

test('Cookie での作成は、別サイトからの送信（Origin 違い・Origin なし）を断る（CSRF 対策）', async () => {
  const s = await t.login();
  assert.equal((await s.as('POST', '/api/rooms', {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await s.as('POST', '/api/rooms', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const noOrigin = await fetch(`${t.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: s.cookie }, body: '{}' });
  assert.equal(noOrigin.status, 403);
  // JSON 以外（フォーム送信）は受け付けない
  const form = await fetch(`${t.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: s.cookie, Origin: t.base }, body: 'title=x' });
  assert.equal(form.status, 415);
});

test('サーバー間の API キーで作成でき、主催者用リンクが返る。キー違いは断る', async () => {
  const ok = await t.call('POST', '/api/rooms', { title: 'API から' }, { Authorization: `Bearer ${'k'.repeat(40)}`, 'X-Staff-Id': 'nakatani' });
  assert.equal(ok.status, 201);
  assert.match(ok.body.hostUrl, /#host=[\w-]{40,}$/);
  assert.ok(!ok.body.url.includes('host='), 'お客様用のリンクに主催者の合札は入らない');
  const bad = await t.call('POST', '/api/rooms', {}, { Authorization: 'Bearer wrong', 'X-Staff-Id': 'nakatani' });
  assert.equal(bad.status, 401);
});

test('入力の検証：ID・日時の形式、終了が開始より前、大きすぎる本文を断る', async () => {
  const s = await t.login();
  assert.equal((await s.as('POST', '/api/rooms', { customerId: 'a b<script>' })).status, 400);
  assert.equal((await s.as('POST', '/api/rooms', { start: '2026-11-20 10:00' })).status, 400);
  assert.equal((await s.as('POST', '/api/rooms', { start: '2026-11-20T11:00:00+09:00', end: '2026-11-20T10:00:00+09:00' })).status, 400);
  const big = await s.as('POST', '/api/rooms', { title: 'x'.repeat(2 * 1024 * 1024) });
  assert.equal(big.status, 413);
});

// ---------- ログイン ----------
test('パスワード違いは同じ文言で断り、続けると回数制限がかかる', async () => {
  const x = await boot();
  try {
    const a = await x.call('POST', '/api/auth/login', { id: 'nakatani', password: 'nope' });
    const b = await x.call('POST', '/api/auth/login', { id: 'nobody', password: 'nope' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error, b.body.error, 'ID があるかどうかを文言で推測させない');
    let last;
    for (let i = 0; i < 6; i++) last = await x.call('POST', '/api/auth/login', { id: 'nakatani', password: 'nope' });
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) > 0);
  } finally { x.close(); }
});

test('ログアウトした合札（Cookie）は二度と使えない', async () => {
  const s = await t.login();
  assert.equal((await s.as('GET', '/api/auth/me')).status, 200);
  await s.as('POST', '/api/auth/logout', {});
  assert.equal((await s.as('GET', '/api/auth/me')).status, 401);
  assert.equal((await s.as('POST', '/api/rooms', {})).status, 401);
});

test('改ざんした Cookie は通らない', async () => {
  const s = await t.login();
  const [name, val] = s.cookie.split('=');
  const [body, sig] = val.split('.');
  const p = JSON.parse(Buffer.from(body, 'base64url'));
  p.role = 'admin';
  const forged = `${name}=${Buffer.from(JSON.stringify(p)).toString('base64url')}.${sig}`;
  assert.equal((await t.call('GET', '/api/auth/me', undefined, { Cookie: forged })).status, 401);
});

test('COMPASS からの引き継ぎ（JWT）：正しいものは通り、使い回し・期限切れ・署名なし・発行元違いは断る', async () => {
  const secret = 'c'.repeat(40);
  const now = Math.floor(Date.now() / 1000);
  const good = sec.signJwtHS256(secret, { iss: 'compass', aud: 'compass-meet', sub: 'nakatani', name: '中谷 真弘', iat: now, exp: now + 300, jti: crypto.randomUUID() });
  const r = await t.call('POST', '/api/auth/compass', { token: good });
  assert.equal(r.status, 200);
  assert.ok(r.headers.get('set-cookie').includes('HttpOnly'));
  assert.equal((await t.call('POST', '/api/auth/compass', { token: good })).status, 401, '同じ JWT は一度きり');
  const expired = sec.signJwtHS256(secret, { iss: 'compass', aud: 'compass-meet', sub: 'x', iat: now - 900, exp: now - 60 });
  assert.equal((await t.call('POST', '/api/auth/compass', { token: expired })).status, 401);
  const tooLong = sec.signJwtHS256(secret, { iss: 'compass', aud: 'compass-meet', sub: 'x', iat: now, exp: now + 86400 });
  assert.equal((await t.call('POST', '/api/auth/compass', { token: tooLong })).status, 401, '有効時間が長すぎる JWT は断る');
  const wrongIss = sec.signJwtHS256(secret, { iss: 'other', aud: 'compass-meet', sub: 'x', iat: now, exp: now + 60 });
  assert.equal((await t.call('POST', '/api/auth/compass', { token: wrongIss })).status, 401);
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: 'compass', aud: 'compass-meet', sub: 'x', iat: now, exp: now + 60 })).toString('base64url')}.`;
  assert.equal((await t.call('POST', '/api/auth/compass', { token: none })).status, 401);
});

// ---------- 情報の出し方 ----------
test('リンクを知っているだけでは、件名・お客様名・顧客 ID・参加人数は取れない', async () => {
  const { room } = await newRoom();
  const r = await t.call('GET', `/api/rooms/${room.id}`);
  assert.equal(r.status, 200);
  const text = JSON.stringify(r.body);
  for (const s of ['山田', 'C-1001', '間取り', 'participants']) assert.ok(!text.includes(s), `${s} が漏れている: ${text}`);
  assert.equal(r.body.ownerName, '中谷 真弘', '担当者名（社員名）だけは、本物の案内か確かめるために出す');
});

test('保存データ（Redis の中身）に件名・お客様名が平文で残らない', async () => {
  await newRoom();
  const dump = JSON.stringify([...t.store._data.entries()].map(([k, v]) => [k, v.v instanceof Map ? [...v.v] : v.v]));
  assert.ok(!dump.includes('山田'), 'お客様名が平文で保存されている');
  assert.ok(!dump.includes('C-1001'), '顧客 ID が平文で保存されている');
});

test('参加者の合言葉は、保存側にはハッシュでしか残らない', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  const dump = JSON.stringify([...t.store._data.entries()].map(([k, v]) => [k, v.v instanceof Map ? [...v.v] : v.v]));
  assert.ok(!dump.includes(host.secret));
});

// ---------- 主催者と参加者 ----------
test('最初に来たお客様が主催者になることはない：誰もいなくても待合室で待つ', async () => {
  const { s, room } = await newRoom();
  const { res, p: guest } = await t.joinAs(room.id, '山田');
  assert.equal(res.status, 200);
  assert.equal(res.body.role, 'guest');
  assert.equal(res.body.waiting, true);
  const g = await guest.poll();
  assert.equal(g.body.state, 'waiting');
  assert.equal(g.body.hostPresent, false);
  assert.equal(g.body.roster, undefined, '待合室の人には中の一覧を見せない');
  // 主催者が来ると、待っている人の一覧が届く
  const host = await hostIn(room.id, s);
  const ev = (await host.poll()).body.events;
  const adm = ev.find((e) => e.type === 'admitted');
  assert.equal(adm.data.you.role, 'host');
  assert.deepEqual(adm.data.waiting.map((w) => w.name), ['山田']);
  assert.equal(adm.data.room.title, '山田様 間取りのご相談', '件名は入室済みの人にだけ届く');
});

test('お客様は主催者の操作（許可・拒否・退出・ミュート・権限・ロック・終了・記録）を一切できない', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  const { p: g1 } = await t.joinAs(room.id, 'お客様A');
  const { p: g2 } = await t.joinAs(room.id, 'お客様B');
  await host.act('admit', { target: g1.peerId });
  for (const [a, b] of [['admit', { target: g2.peerId }], ['deny', { target: g2.peerId }], ['kick', { target: host.peerId }], ['mute', { target: 'all' }], ['perms', { guestScreen: true }], ['lock', { locked: true }], ['end', {}], ['rec-request', {}], ['stop-share', { target: host.peerId }]]) {
    const r = await g1.act(a, b);
    assert.equal(r.status, 403, `${a} が通ってしまった`);
  }
  // 同時にたくさん送っても、権限の確認はすり抜けない
  const results = await Promise.all(Array.from({ length: 20 }, () => g1.act('admit', { target: g2.peerId })));
  assert.ok(results.every((r) => r.status === 403));
  assert.equal((await g2.poll()).body.state, 'waiting');
});

test('主催者用の合札が違えば主催者にはなれない。正しい合札（主催者用リンク）ならログインなしで主催者', async () => {
  const r = await t.call('POST', '/api/rooms', { title: 'x' }, { Authorization: `Bearer ${'k'.repeat(40)}`, 'X-Staff-Id': 'nakatani' });
  const id = r.body.id;
  const token = r.body.hostUrl.split('#host=')[1];
  const fake = await t.joinAs(id, '偽物', { hostToken: token.slice(0, -2) + 'xx' });
  assert.equal(fake.res.body.role, 'guest');
  const real = await t.joinAs(id, '中谷', { hostToken: token });
  assert.equal(real.res.body.role, 'host');
});

test('持ち主でないスタッフは主催者になれず、詳細・記録も見られない。管理者は見られる', async () => {
  const { room } = await newRoom('nakatani');
  const other = await t.login('tanaka');
  const j = await t.joinAs(room.id, '田中', {}, { Cookie: other.cookie });
  assert.equal(j.res.body.role, 'guest');
  assert.equal((await other.as('GET', `/api/rooms/${room.id}/detail`)).status, 403);
  assert.equal((await other.as('GET', `/api/meetings/${room.id}`)).status, 404, '他人の記録は「無い」と返す');
  assert.equal((await other.as('DELETE', `/api/meetings/${room.id}`)).status, 404);
  const admin = await t.login('boss');
  assert.equal((await admin.as('GET', `/api/meetings/${room.id}`)).status, 200);
});

test('断られた人は何もできず、待合室の一覧からも消える', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  const { p: g } = await t.joinAs(room.id, '不審者');
  await host.act('deny', { target: g.peerId });
  const r = await g.poll();
  assert.ok(r.body.events.some((e) => e.type === 'denied'));
  assert.equal(r.body.state, 'denied');
  assert.equal((await g.act('chat', { text: 'x' })).status, 403);
  assert.equal((await g.act('signal', { to: host.peerId, data: { type: 'resync' } })).status, 403);
});

test('強制退出：本人に知らされ、以後の合図・チャットは断られ、ほかの人には退出が届く', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  const { p: g } = await t.joinAs(room.id, '山田');
  await host.act('admit', { target: g.peerId });
  await g.poll();
  await host.poll();
  assert.equal((await host.act('kick', { target: g.peerId })).status, 200);
  const gr = await g.poll();
  assert.ok(gr.body.events.some((e) => e.type === 'kicked'));
  assert.equal(gr.body.state, 'kicked');
  assert.equal((await g.act('signal', { to: host.peerId, data: { type: 'resync' } })).status, 403);
  assert.equal((await g.act('chat', { text: 'まだいる' })).status, 403);
  const hr = await host.poll();
  assert.ok(hr.body.events.some((e) => e.type === 'peer-left' && e.data.reason === 'kicked'));
  assert.equal(hr.body.roster.length, 1);
});

test('ロック中はお客様の新しい入室を断る（主催者は入れる）', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  await host.act('lock', { locked: true });
  const j = await t.joinAs(room.id, '遅れて来た人');
  assert.equal(j.res.status, 423);
  const h2 = await t.joinAs(room.id, '中谷（別端末）', {}, { Cookie: s.cookie });
  assert.equal(h2.res.status, 200);
  await host.act('lock', { locked: false });
  assert.equal((await t.joinAs(room.id, '遅れて来た人')).res.status, 200);
});

test('通話の終了：全員に届き、再入室・再利用はできない', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  const { p: g } = await t.joinAs(room.id, '山田');
  await host.act('admit', { target: g.peerId });
  await g.poll();
  assert.equal((await host.act('end', {})).status, 200);
  const gr = await g.poll();
  assert.ok(gr.body.events.some((e) => e.type === 'closed'));
  assert.equal(gr.body.state, 'ended');
  assert.equal((await g.act('chat', { text: 'x' })).status, 410);
  assert.equal((await t.joinAs(room.id, '山田')).res.status, 410);
  assert.equal((await t.joinAs(room.id, '中谷', {}, { Cookie: s.cookie })).res.status, 410, '主催者でも終了した通話は開き直せない');
  assert.equal((await t.call('GET', `/api/rooms/${room.id}`)).body.status, 'ended');
  // ほかの更新（権限の変更など）で「終了」が取り消されないこと
  assert.equal((await host.act('perms', { chat: false })).status, 410);
});

test('有効期限を過ぎたリンクでは入れない', async () => {
  const { room } = await newRoom();
  const key = `room:${room.id}`;
  const e = t.store._data.get(key);
  const obj = JSON.parse(e.v);
  obj.expiresAt = Date.now() - 1000;
  e.v = JSON.stringify(obj);
  const j = await t.joinAs(room.id, '山田');
  assert.equal(j.res.status, 410);
  assert.match(j.res.body.error, /有効期限/);
});

test('確認コード（任意）：違うと入れず、続けて間違えると止まる', async () => {
  const x = await boot();
  try {
    const s = await x.login();
    const r = await s.as('POST', '/api/rooms', { title: 'x', pin: true });
    assert.match(r.body.pin, /^\d{6}$/);
    assert.equal((await x.call('GET', `/api/rooms/${r.body.id}`)).body.requiresPin, true);
    assert.equal((await x.joinAs(r.body.id, '山田', { pin: '000000' === r.body.pin ? '111111' : '000000' })).res.status, 403);
    assert.equal((await x.joinAs(r.body.id, '山田', { pin: r.body.pin })).res.status, 200);
    // 部屋ごとの失敗回数で止まる（回線を変えても総当たりできない）
    let last;
    for (let i = 0; i < 12; i++) last = await x.call('POST', `/api/rooms/${r.body.id}/join`, { name: 'x', pin: String(100000 + i) }, { 'X-Forwarded-For': `10.0.0.${i}` });
    assert.equal(last.status, 429);
  } finally { x.close(); }
});

test('合図の中身は形を確かめてから渡す（壊れた形・自分あて・大きすぎるものは断る）', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  const { p: g } = await t.joinAs(room.id, '山田');
  await host.act('admit', { target: g.peerId });
  assert.equal((await g.act('signal', { to: host.peerId, data: { type: 'offer', sdp: '<script>' } })).status, 400);
  assert.equal((await g.act('signal', { to: host.peerId, data: { type: 'evil', payload: 'x' } })).status, 400);
  assert.equal((await g.act('signal', { to: host.peerId, data: { type: 'offer', sdp: 'v=0' + 'a'.repeat(30000) } })).status, 400);
  assert.equal((await g.act('signal', { to: g.peerId, data: { type: 'resync' } })).status, 404);
  assert.equal((await g.act('signal', { to: host.peerId, data: { type: 'offer', sdp: 'v=0\r\n', extra: 'x' } })).status, 200);
  const ev = (await host.poll()).body.events.find((e) => e.type === 'signal');
  assert.deepEqual(Object.keys(ev.data.data).sort(), ['sdp', 'type'], '余計な項目は落として渡す');
});

test('他人の合言葉・ID の組み合わせでは操作できない（なりすまし防止）', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  const { p: g } = await t.joinAs(room.id, '山田');
  const r = await t.call('POST', `/api/rooms/${room.id}/admit`, { peerId: host.peerId, secret: g.secret, target: g.peerId });
  assert.equal(r.status, 403);
  const r2 = await t.call('GET', `/api/rooms/${room.id}/poll?peerId=${host.peerId}`, undefined, { 'X-Peer-Secret': g.secret });
  assert.equal(r2.status, 403);
  // アドレスに合言葉を載せても受け付けない（記録に残る形は使わせない）
  const r3 = await t.call('GET', `/api/rooms/${room.id}/poll?peerId=${host.peerId}&secret=${host.secret}`);
  assert.equal(r3.status, 403);
  // 別の部屋の合言葉は通らない
  const other = await newRoom();
  const r4 = await t.call('POST', `/api/rooms/${other.room.id}/chat`, { peerId: host.peerId, secret: host.secret, text: 'x' });
  assert.equal(r4.status, 403);
});

test('取りに来る間隔が短すぎると断る（大量アクセス対策）', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  const q = () => t.call('GET', `/api/rooms/${room.id}/poll?peerId=${host.peerId}`, undefined, { 'X-Peer-Secret': host.secret });
  await new Promise((r) => setTimeout(r, 400));
  const a = await q();
  const b = await q();
  assert.equal(a.status, 200);
  assert.equal(b.status, 429);
});

test('待合室の人数には上限があり、同じ回線からの申し込みは部屋ごとに数える', async () => {
  const x = await boot();
  try {
    const s = await x.login();
    const r = await s.as('POST', '/api/rooms', {});
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await x.call('POST', `/api/rooms/${r.body.id}/join`, { name: `人${i}` }, { })).status);
    assert.ok(statuses.includes(429), `上限が効いていない: ${statuses}`);
    // 別の部屋には影響しない（同じ回線のお客様が別の打ち合わせに入れなくなることはない）
    const r2 = await s.as('POST', '/api/rooms', {});
    assert.equal((await x.call('POST', `/api/rooms/${r2.body.id}/join`, { name: '別の方' })).status, 200);
  } finally { x.close(); }
});

// ---------- 権限の設定 ----------
test('画面共有は許可されたときだけ。チャットは主催者が止められる。許可を取り消すと共有停止の依頼が届く', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  const { p: g } = await t.joinAs(room.id, '山田');
  await host.act('admit', { target: g.peerId });
  assert.equal((await g.act('state', { mic: true, cam: true, screen: true })).status, 403);
  await host.act('perms', { guestScreen: true });
  assert.equal((await g.act('state', { mic: true, cam: true, screen: true })).status, 200);
  await host.act('perms', { guestScreen: false, chat: false });
  const ev = (await g.poll()).body.events.map((e) => e.type);
  assert.ok(ev.includes('perms') && ev.includes('stop-share'));
  assert.equal((await g.act('chat', { text: 'x' })).status, 403);
  assert.equal((await host.act('chat', { text: '主催者は書ける' })).status, 200);
});

test('画面共有の希望：許可のないお客様が押すと、主催者にだけ知らせが届く', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  const { p: g } = await t.joinAs(room.id, '山田');
  await host.act('admit', { target: g.peerId });
  await g.poll(); await host.poll();
  const r = await g.act('share-request');
  assert.equal(r.body.allowed, false);
  const ev = (await host.poll()).body.events.find((e) => e.type === 'share-request');
  assert.equal(ev.data.name, '山田');
  assert.ok(!(await g.poll()).body.events.some((e) => e.type === 'share-request'), 'お客様自身には届かない');
  await host.act('perms', { guestScreen: true });
  assert.equal((await g.act('share-request')).body.allowed, true);
});

test('主催者を渡す：渡された人は主催者の操作ができ、社員の主催者は外せない。お客様は渡せない', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  const { p: g } = await t.joinAs(room.id, '山田');
  const { p: g2 } = await t.joinAs(room.id, '花子');
  await host.act('admit', { target: g.peerId });
  await host.act('admit', { target: g2.peerId });
  await g.poll(); await g2.poll(); await host.poll();
  assert.equal((await g.act('make-host', { target: g2.peerId })).status, 403, 'お客様は主催者を渡せない');
  assert.equal((await host.act('make-host', { target: g.peerId })).status, 200);
  const ev = (await g2.poll()).body.events.find((e) => e.type === 'role');
  assert.deepEqual([ev.data.id, ev.data.role, ev.data.by], [g.peerId, 'host', '中谷 真弘']);
  const roster = (await g.poll()).body.roster;
  assert.equal(roster.find((x) => x.id === g.peerId).role, 'host');
  assert.equal(roster.find((x) => x.id === host.peerId).staff, true);
  assert.equal(roster.find((x) => x.id === g.peerId).staff, false);
  // 渡された人は主催者の操作ができる。ただし社員の主催者は外せない・退出させられない
  assert.equal((await g.act('lock', { locked: false })).status, 200);
  assert.equal((await g.act('unhost', { target: host.peerId })).status, 403);
  assert.equal((await g.act('kick', { target: host.peerId })).status, 403);
  // 社員の主催者は、渡した役割を外せる
  assert.equal((await host.act('unhost', { target: g.peerId })).status, 200);
  assert.equal((await g.act('lock', { locked: false })).status, 403);
  // メモ・記録は社員だけ（主催者を渡されても見られない）
  assert.equal((await t.call('GET', `/api/meetings/${room.id}`)).status, 401);
});

test('主催者が抜けると、残っている人に自動で主催者が渡り、待合室の人も引き継がれる', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  const { p: g } = await t.joinAs(room.id, '山田');
  await host.act('admit', { target: g.peerId });
  await g.poll(); await host.poll();
  const { p: g3 } = await t.joinAs(room.id, '後から来た人');
  assert.equal((await host.act('leave')).status, 200);
  const r = await g.poll();
  const role = r.body.events.find((e) => e.type === 'role');
  assert.equal(role.data.id, g.peerId);
  assert.equal(role.data.role, 'host');
  assert.ok(r.body.events.some((e) => e.type === 'knock' && e.data.id === g3.peerId), '待合室の人が新しい主催者に届く');
  assert.equal((await g.act('admit', { target: g3.peerId })).status, 200);
  // 担当者が戻ってくれば、また主催者として入れる
  const back = await hostIn(room.id, s);
  assert.ok(back.peerId);
});

test('チャットの保存は主催者が決め、保存したものは記録で見られる。他人のメッセージは消せない', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  const { p: g1 } = await t.joinAs(room.id, '山田');
  const { p: g2 } = await t.joinAs(room.id, '山田 花子');
  await host.act('admit', { target: g1.peerId });
  await host.act('admit', { target: g2.peerId });
  await g1.act('chat', { text: '保存されない' });
  await host.act('perms', { saveChat: true });
  const sent = await g1.act('chat', { text: 'キッチンは対面がいい https://example.com/kitchen' });
  assert.equal((await g2.act('chat-delete', { id: sent.body.id, from: g2.peerId })).status, 403, '送信者を偽っても保存側で確かめる');
  const m = await s.as('GET', `/api/meetings/${room.id}`);
  assert.deepEqual(m.body.meeting.chat.map((c) => c.text), ['キッチンは対面がいい https://example.com/kitchen']);
  assert.equal((await g1.act('chat-delete', { id: sent.body.id, from: g1.peerId })).status, 200);
  const m2 = await s.as('GET', `/api/meetings/${room.id}`);
  assert.equal(m2.body.meeting.chat.length, 0);
});

// ---------- 会議記録 ----------
test('メモの保存・書き出し・削除は持ち主だけ。参加の記録も残る', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  const { p: g } = await t.joinAs(room.id, '山田');
  await host.act('admit', { target: g.peerId });
  const n = await s.as('PUT', `/api/meetings/${room.id}/notes`, { body: 'LDK は 20 帖希望', decisions: '平屋で進める', pending: '外壁の色', todos: '中谷：概算見積を 11/25 までに', projectId: 'P-77' });
  assert.equal(n.status, 200);
  const other = await t.login('tanaka');
  assert.equal((await other.as('PUT', `/api/meetings/${room.id}/notes`, { body: '改ざん' })).status, 404);
  const ex = await s.as('GET', `/api/meetings/${room.id}/export`);
  assert.match(ex.body.markdown, /平屋で進める/);
  assert.match(ex.body.markdown, /山田/);
  const list = await s.as('GET', '/api/meetings');
  assert.ok(list.body.rooms.some((r) => r.id === room.id && r.hasNotes));
  assert.equal((await s.as('DELETE', `/api/meetings/${room.id}`)).status, 200);
  assert.equal((await s.as('GET', `/api/meetings/${room.id}`)).status, 404);
});

test('議事録の確定は持ち主だけ。形の違う入力は整えてから保存する', async () => {
  const { s, room } = await newRoom();
  const content = { overview: '概要', requests: { layout: [{ text: '20帖のLDK', sources: ['note'], evil: 1 }] }, decisions: [{ text: '平屋', sources: ['note'] }], pending: [], todos: [{ who: '中谷', what: '見積', due: '11/25', sources: [] }], suggestedAgenda: [], extra: 'x' };
  const r = await s.as('PUT', `/api/meetings/${room.id}/minutes`, { content, confirm: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.minutes.status, 'confirmed');
  assert.equal(r.body.minutes.content.extra, undefined);
  assert.equal(r.body.minutes.content.requests.layout[0].evil, undefined);
  const admin = await t.login('boss');
  assert.equal((await admin.as('PUT', `/api/meetings/${room.id}/minutes`, { content, confirm: true })).status, 403, '管理者でも他人の議事録の確定はできない');
});

test('AI 要約は承認の設定がなければ動かない（外部へ送らない）', async () => {
  const { s, room } = await newRoom();
  const r = await s.as('POST', `/api/meetings/${room.id}/summarize`, {});
  assert.equal(r.status, 409);
  assert.match(r.body.error, /承認/);
});

// ---------- 録音・文字起こしの同意 ----------
test('文字起こしの依頼は、外部送信の承認設定がないと始められない', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  assert.equal((await host.act('rec-request', {})).status, 409);
});

test('同意の流れ：一人でも断れば記録しない。全員が同意して初めて記録できる。途中参加者がいれば止まる', async () => {
  const x = await boot({ ALLOW_REC_DRYRUN: '1' });
  try {
    const s = await x.login();
    const room = (await s.as('POST', '/api/rooms', {})).body;
    const host = (await x.joinAs(room.id, '中谷', {}, { Cookie: s.cookie })).p;
    const g = (await x.joinAs(room.id, '山田')).p;
    await host.act('admit', { target: g.peerId });
    // 同意前は文字起こしを受け付けない
    assert.equal((await host.act('rec-request', { dryRun: true })).status, 200);
    assert.equal((await host.act('transcript', { segments: [{ text: 'テスト' }] })).status, 409);
    // お客様が断る → 記録はオフ
    await g.act('rec-consent', { accept: false });
    assert.equal((await host.act('transcript', { segments: [{ text: 'テスト' }] })).status, 409);
    // もう一度依頼 → 全員同意 → 記録できる
    await host.act('rec-request', { dryRun: true });
    await g.act('rec-consent', { accept: true });
    assert.equal((await g.act('transcript', { segments: [{ text: '吹き抜けにしたい' }] })).status, 200);
    // 途中参加者 → 止まる
    const g2 = (await x.joinAs(room.id, '山田 花子')).p;
    await host.act('admit', { target: g2.peerId });
    assert.equal((await g.act('transcript', { segments: [{ text: '同意していない人がいる' }] })).status, 409);
    await g2.act('rec-consent', { accept: true });
    assert.equal((await g.act('transcript', { segments: [{ text: '再開' }] })).status, 200);
    const m = await s.as('GET', `/api/meetings/${room.id}`);
    assert.deepEqual(m.body.meeting.transcript.map((t2) => t2.text), ['吹き抜けにしたい', '再開']);
  } finally { x.close(); }
});

// ---------- TURN ----------
test('TURN の資格情報は入室済みの人にだけ、期限つきで渡す', async () => {
  const x = await boot({ TURN_SECRET: 's3cret', TURN_URLS: 'turn:turn.example.jp:3478?transport=udp,turns:turn.example.jp:5349' });
  try {
    const s = await x.login();
    const room = (await s.as('POST', '/api/rooms', {})).body;
    const host = (await x.joinAs(room.id, '中谷', {}, { Cookie: s.cookie })).p;
    const g = (await x.joinAs(room.id, '山田')).p;
    const denied = await x.call('GET', `/api/rooms/${room.id}/ice?peerId=${g.peerId}`, undefined, { 'X-Peer-Secret': g.secret });
    assert.equal(denied.status, 403, '待合室の人には渡さない');
    const r = await x.call('GET', `/api/rooms/${room.id}/ice?peerId=${host.peerId}`, undefined, { 'X-Peer-Secret': host.secret });
    const turn = r.body.iceServers.find((i) => i.username);
    const [exp] = turn.username.split(':');
    assert.ok(Number(exp) > Date.now() / 1000 && Number(exp) < Date.now() / 1000 + 86400);
    assert.equal(turn.credential, crypto.createHmac('sha1', 's3cret').update(turn.username).digest('base64'));
    assert.equal((await x.call('GET', '/api/config')).body.iceServers, undefined, '誰でも見られる設定には資格情報を載せない');
  } finally { x.close(); }
});

// ---------- 2〜4 人の流れ ----------
test('4 人（主催者 1・お客様 3）が入り、途中退出・合図の中継ができる', async () => {
  const { s, room } = await newRoom();
  const host = await hostIn(room.id, s);
  const gs = [];
  for (const n of ['山田 太郎', '山田 花子', '設計 佐藤']) {
    const { p } = await t.joinAs(room.id, n);
    await host.act('admit', { target: p.peerId });
    gs.push(p);
  }
  const r = await gs[2].poll();
  assert.equal(r.body.roster.length, 4);
  const adm = r.body.events.find((e) => e.type === 'admitted');
  assert.equal(adm.data.peers.length, 3, '新しく入った人には先にいる 3 人が知らされる');
  await gs[2].act('signal', { to: gs[0].peerId, data: { type: 'resync' } });
  assert.ok((await gs[0].poll()).body.events.some((e) => e.type === 'signal' && e.data.from === gs[2].peerId));
  await gs[1].act('leave');
  const h = await host.poll();
  assert.ok(h.body.events.some((e) => e.type === 'peer-left' && e.data.id === gs[1].peerId));
  assert.equal(h.body.roster.length, 3);
});

test('満員（6 名）を超えると断る', async () => {
  const x = await boot({ MAX_PEERS: '3' });
  try {
    const s = await x.login();
    const room = (await s.as('POST', '/api/rooms', {})).body;
    const host = (await x.joinAs(room.id, '中谷', {}, { Cookie: s.cookie })).p;
    const { p: a } = await x.joinAs(room.id, 'A');
    const { p: b } = await x.joinAs(room.id, 'B');
    await host.act('admit', { target: a.peerId });
    await host.act('admit', { target: b.peerId });
    assert.equal((await x.joinAs(room.id, 'C')).res.status, 409, '満員なら待合室にも入れない');
  } finally { x.close(); }
});

// ---------- 鍵がない本番設定 ----------
test('本番（Vercel）で鍵が未設定なら、API は動かない（使い捨ての鍵で動かしてしまわない）', async () => {
  const x = await boot({ VERCEL: '1' });
  try {
    assert.equal((await x.call('GET', '/api/config')).status, 503);
  } finally { x.close(); }
});

test('安全用ヘッダーが付く', async () => {
  const r = await fetch(`${t.base}/`);
  assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.match(r.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
});
