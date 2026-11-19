'use strict';
// 社員の初期パスワードと、最初のログインでの変更の試験
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');
const sec = require('../lib/secure');

const INIT = 'sakura-Init-123';
let t;
test.before(async () => {
  t = await boot({ STAFF_ACCOUNTS: JSON.stringify([{ id: 'shimada', name: '島田 一樹', role: 'staff', hash: sec.hashPassword(INIT), temp: true }]) });
});
test.after(() => t.close());

async function login(pw) {
  const r = await t.call('POST', '/api/auth/login', { id: 'shimada', password: pw });
  return { r, cookie: r.status === 200 ? r.headers.get('set-cookie').split(';')[0] : null };
}

test('初期パスワードでログインすると、変更するまで何もできない', async () => {
  const { r, cookie } = await login(INIT);
  assert.equal(r.status, 200);
  assert.equal(r.body.staff.mustChange, true);
  const me = await t.call('GET', '/api/auth/me', undefined, { Cookie: cookie });
  assert.equal(me.body.staff.mustChange, true);
  assert.equal((await t.call('POST', '/api/rooms', {}, { Cookie: cookie })).status, 401, '打ち合わせは作れない');
  assert.equal((await t.call('GET', '/api/meetings', undefined, { Cookie: cookie })).status, 401, '記録も見られない');
});

test('弱いパスワード・いまのパスワードの間違い・同じパスワードへの変更は断る', async () => {
  const { cookie } = await login(INIT);
  const ch = (current, next) => t.call('POST', '/api/auth/password', { current, next }, { Cookie: cookie });
  assert.equal((await ch(INIT, 'short')).status, 400);
  assert.equal((await ch(INIT, 'shimada-12345')).status, 400, '社員 ID を含む');
  assert.equal((await ch(INIT, 'aaaaaaaaaaaa')).status, 400);
  assert.equal((await ch(INIT, INIT)).status, 400);
  assert.equal((await ch('wrong-password', 'Good-Pass-2026x')).status, 401);
});

test('変更すると使えるようになり、初期パスワードと古い合札は使えなくなる', async () => {
  const first = await login(INIT);
  const other = await login(INIT); // 別の端末でもログインしていたとする
  const r = await t.call('POST', '/api/auth/password', { current: INIT, next: 'Kiri-Tree-2026!' }, { Cookie: first.cookie });
  assert.equal(r.status, 200);
  const newCookie = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await t.call('POST', '/api/rooms', { title: 'x' }, { Cookie: newCookie })).status, 201);
  assert.equal((await t.call('GET', '/api/auth/me', undefined, { Cookie: first.cookie })).status, 401, '変更前の合札は無効');
  assert.equal((await t.call('GET', '/api/auth/me', undefined, { Cookie: other.cookie })).status, 401, '別の端末の合札も無効');
  assert.equal((await login(INIT)).r.status, 401, '初期パスワードは使えない');
  const again = await login('Kiri-Tree-2026!');
  assert.equal(again.r.status, 200);
  assert.equal(again.r.body.staff.mustChange, false);
});

test('別サイトからのパスワード変更は断る（CSRF 対策）', async () => {
  const { cookie } = await login('Kiri-Tree-2026!');
  const r = await t.call('POST', '/api/auth/password', { current: 'Kiri-Tree-2026!', next: 'Another-Pass-77' }, { Cookie: cookie, Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});
