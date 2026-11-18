'use strict';
// Google（会社のドメイン）でのログインの試験。Google の代わりに、試験用の鍵とトークン発行を用意する
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { boot } = require('./helpers');
const { safeReturn } = require('../lib/google');

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

function sign(claims, key = privateKey, header = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url');
  return `${h}.${p}.${sig}`;
}

let nextToken = null; // 次に Google が返す ID トークンを作る関数（nonce を受け取る）
let lastNonce = null;
const fakeFetch = async (url, opts = {}) => {
  if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) return { ok: true, json: async () => ({ keys: [jwk] }) };
  if (url === 'https://oauth2.googleapis.com/token') {
    const form = new URLSearchParams(opts.body);
    assert.equal(form.get('client_id'), CLIENT_ID);
    assert.ok(form.get('code_verifier') && form.get('code_verifier').length >= 43, 'PKCE の確認用の値を送っている');
    return { ok: true, json: async () => ({ id_token: nextToken(lastNonce) }) };
  }
  throw new Error(`想定外の通信: ${url}`);
};

const base = (nonce, over = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1234', email: 'nakatani.masahiro@limgroup.jp', email_verified: true, hd: 'limgroup.jp', name: '中谷 真弘', iat: now, exp: now + 3600, nonce, ...over };
};

let t;
test.before(async () => {
  t = await boot({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_ALLOWED_DOMAIN: 'limgroup.jp', GOOGLE_ADMIN_EMAILS: 'boss@limgroup.jp' }, { fetchImpl: fakeFetch });
});
test.after(() => t.close());

async function startFlow(returnTo) {
  const r = await fetch(`${t.base}/api/auth/google/start${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(loc.searchParams.get('hd'), 'limgroup.jp');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  lastNonce = loc.searchParams.get('nonce');
  return { state: loc.searchParams.get('state'), cookie };
}

async function finish(flow, { state, cookie } = {}) {
  const r = await fetch(`${t.base}/api/auth/google/callback?code=abc&state=${encodeURIComponent(state ?? flow.state)}`, { redirect: 'manual', headers: cookie === null ? {} : { Cookie: cookie ?? flow.cookie } });
  assert.equal(r.status, 302);
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const staffCookie = set.map((c) => c.split(';')[0]).find((c) => c.startsWith('cm_staff=') && c.length > 'cm_staff='.length);
  return { location: r.headers.get('location'), staffCookie };
}

test('会社の Google アカウントでログインでき、元のページに戻る', async () => {
  nextToken = (n) => sign(base(n));
  const f = await startFlow('/r/abc-defg-hij');
  const r = await finish(f);
  assert.equal(r.location, '/r/abc-defg-hij');
  assert.ok(r.staffCookie);
  const me = await t.call('GET', '/api/auth/me', undefined, { Cookie: r.staffCookie });
  assert.equal(me.body.staff.id, 'nakatani.masahiro@limgroup.jp');
  assert.equal(me.body.staff.name, '中谷 真弘');
  assert.equal(me.body.staff.role, 'staff');
  // ログインした社員はルームを作れる
  const room = await t.call('POST', '/api/rooms', { title: 'Google ログインの試験' }, { Cookie: r.staffCookie });
  assert.equal(room.status, 201);
});

test('管理者に指定したアドレスは管理者になる', async () => {
  nextToken = (n) => sign(base(n, { email: 'boss@limgroup.jp' }));
  const r = await finish(await startFlow());
  const me = await t.call('GET', '/api/auth/me', undefined, { Cookie: r.staffCookie });
  assert.equal(me.body.staff.role, 'admin');
});

for (const [label, over, err] of [
  ['個人の Gmail（hd なし）', { email: 'someone@gmail.com', hd: undefined }, 'domain'],
  ['別の会社の Google Workspace', { email: 'x@other.co.jp', hd: 'other.co.jp' }, 'domain'],
  ['hd は合っているがメールのドメインが違う', { email: 'x@other.co.jp' }, 'domain'],
  ['メールアドレスが未確認', { email_verified: false }, 'domain'],
  ['宛先（aud）が違う', { aud: 'other-client' }, 'token'],
  ['発行元が違う', { iss: 'https://evil.example' }, 'token'],
  ['期限切れ', { exp: Math.floor(Date.now() / 1000) - 3600 }, 'token'],
]) {
  test(`断る：${label}`, async () => {
    nextToken = (n) => sign(base(n, over));
    const r = await finish(await startFlow());
    assert.equal(r.location, `/?login_error=${err}`);
    assert.equal(r.staffCookie, undefined);
  });
}

test('断る：nonce が違う（別のログインのトークンの使い回し）', async () => {
  nextToken = () => sign(base('other-nonce'));
  const r = await finish(await startFlow());
  assert.equal(r.location, '/?login_error=token');
});

test('断る：別の鍵で署名されたトークン・署名なし（alg=none）', async () => {
  nextToken = (n) => sign(base(n), other.privateKey);
  assert.equal((await finish(await startFlow())).location, '/?login_error=token');
  nextToken = (n) => `${Buffer.from('{"alg":"none","kid":"k1"}').toString('base64url')}.${Buffer.from(JSON.stringify(base(n))).toString('base64url')}.`;
  assert.equal((await finish(await startFlow())).location, '/?login_error=token');
});

test('断る：state が違う・ログインの流れの Cookie がない（CSRF 対策）', async () => {
  nextToken = (n) => sign(base(n));
  const f = await startFlow();
  assert.equal((await finish(f, { state: 'wrong' })).location, '/?login_error=state');
  assert.equal((await finish(f, { cookie: null })).location, '/?login_error=expired');
});

test('ログイン後の戻り先は、このサイトの中だけ（外のサイトへ飛ばさない）', () => {
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', '/r/../../x', 'javascript:alert(1)']) assert.equal(safeReturn(bad), '/');
  assert.equal(safeReturn('/r/abc-defg-hij'), '/r/abc-defg-hij');
  assert.equal(safeReturn('/records'), '/records');
});

test('Google の設定が無ければ、ログインの入口は無い', async () => {
  const x = await boot();
  try {
    assert.equal((await fetch(`${x.base}/api/auth/google/start`, { redirect: 'manual' })).status, 404);
    assert.equal((await x.call('GET', '/api/config')).body.googleLogin, false);
  } finally { x.close(); }
});
