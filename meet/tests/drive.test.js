'use strict';
// 録音を担当者本人の Google ドライブに置く試験。Google の代わりに、試験用の応答を返す
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');
const { createDrive } = require('../lib/drive');

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const g = { folders: [], created: [], uploads: [], revoked: 0, refreshes: 0, userinfo: { email: 'nakatani.masahiro@limgroup.jp', email_verified: true, hd: 'limgroup.jp' }, scope: 'openid https://www.googleapis.com/auth/drive email' };
const json = (o, headers = {}) => ({ ok: true, status: 200, headers: { get: (k) => headers[k.toLowerCase()] || null }, json: async () => o });

const fakeFetch = async (url, opts = {}) => {
  const u = new URL(url);
  if (url === 'https://oauth2.googleapis.com/token') {
    const f = new URLSearchParams(opts.body);
    assert.equal(f.get('client_id'), CLIENT_ID);
    if (f.get('grant_type') === 'authorization_code') {
      assert.ok(f.get('code_verifier'));
      return json({ access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, scope: g.scope });
    }
    g.refreshes++;
    assert.equal(f.get('refresh_token'), 'rt1');
    return json({ access_token: 'at2', expires_in: 3600 });
  }
  if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return json(g.userinfo);
  if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/revoke') { g.revoked++; return json({}); }
  const one = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (one && (opts.method || 'GET') === 'GET') { const f = g.folders.find((x) => x.id === decodeURIComponent(one[1])); return f ? json(f) : { ok: false, status: 404, json: async () => ({}) }; }
  if (u.origin + u.pathname === 'https://www.googleapis.com/drive/v3/files' && (opts.method || 'GET') === 'GET') {
    assert.match(opts.headers.Authorization, /^Bearer at/);
    const q = u.searchParams.get('q');
    assert.match(q, /'me' in owners/, '自分のドライブだけを探す');
    let files = g.folders;
    const contains = q.match(/name contains '([^']+)'/);
    if (contains) files = files.filter((f) => f.name.startsWith(contains[1]));
    const exact = q.match(/name='([^']+)'/);
    if (exact) files = files.filter((f) => f.name === exact[1]);
    const parent = q.match(/'([^']+)' in parents/);
    if (parent) files = files.filter((f) => (f.parents || ['root']).includes(parent[1]));
    return json({ files });
  }
  if (u.origin + u.pathname === 'https://www.googleapis.com/drive/v3/files' && opts.method === 'POST') {
    const b = JSON.parse(opts.body);
    const f = { id: `folder${g.created.length + 1}`, name: b.name, parents: b.parents };
    g.created.push(f); g.folders.push(f);
    return json(f);
  }
  if (u.origin + u.pathname === 'https://www.googleapis.com/upload/drive/v3/files' && opts.method === 'POST') {
    const meta = JSON.parse(opts.body);
    const id = `up${g.uploads.length + 1}`;
    g.uploads.push({ id, meta, type: opts.headers['X-Upload-Content-Type'] });
    return json({}, { location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${id}` });
  }
  if (u.origin + u.pathname === 'https://www.googleapis.com/upload/drive/v3/files' && opts.method === 'PUT') {
    const up = g.uploads.find((x) => x.id === u.searchParams.get('upload_id'));
    up.data = Buffer.from(opts.body);
    return json({ id: `file-${up.id}`, name: up.meta.name, webViewLink: `https://drive.google.com/file/d/file-${up.id}/view` });
  }
  throw new Error(`想定外の通信: ${opts.method || 'GET'} ${url}`);
};

let t;
test.before(async () => {
  t = await boot({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_ALLOWED_DOMAIN: 'limgroup.jp' }, { fetchImpl: fakeFetch });
});
test.after(() => t.close());

async function connect(s) {
  const r = await fetch(`${t.base}/api/drive/connect`, { redirect: 'manual', headers: { Cookie: s.cookie } });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.searchParams.get('access_type'), 'offline');
  assert.match(loc.searchParams.get('scope'), /auth\/drive/);
  assert.equal(loc.searchParams.get('hd'), 'limgroup.jp');
  const flow = r.headers.get('set-cookie').split(';')[0];
  return fetch(`${t.base}/api/drive/callback?code=abc&state=${loc.searchParams.get('state')}`, { redirect: 'manual', headers: { Cookie: `${s.cookie}; ${flow}` } });
}

async function record(s, customerName, text) {
  const v = (await s.as('POST', '/api/visits', { customerName, title: '打ち合わせ' })).body.visit;
  const a = Buffer.from('first-part-'); const b = Buffer.from('second-part');
  await s.as('POST', `/api/visits/${v.id}/chunk`, { seq: 0, data: a.toString('base64') });
  await s.as('POST', `/api/visits/${v.id}/chunk`, { seq: 1, data: b.toString('base64') });
  const f = await s.as('POST', `/api/visits/${v.id}/finish`, { chunks: 2, mime: 'audio/mp4', durationMs: 65000, bytes: 22, text });
  assert.equal(f.status, 200);
  return { v: f.body.visit, audio: Buffer.concat([a, b]) };
}

test('ドライブにつなぐ前は「未接続」、つなぐと本人のメールが出る', async () => {
  const s = await t.login();
  assert.deepEqual((await s.as('GET', '/api/drive')).body, { enabled: true, connected: false, email: '' });
  const r = await connect(s);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/visit?drive=ok');
  const st = (await s.as('GET', '/api/drive')).body;
  assert.equal(st.connected, true);
  assert.equal(st.email, 'nakatani.masahiro@limgroup.jp');
  // 別の人には見えない
  const other = await t.login('tanaka');
  assert.equal((await other.as('GET', '/api/drive')).body.connected, false);
});

test('他人のログインのまま戻ってきても、つながらない（取り違え防止）', async () => {
  const a = await t.login('tanaka');
  const r = await fetch(`${t.base}/api/drive/connect`, { redirect: 'manual', headers: { Cookie: a.cookie } });
  const loc = new URL(r.headers.get('location'));
  const flow = r.headers.get('set-cookie').split(';')[0];
  const b = await t.login('boss');
  const back = await fetch(`${t.base}/api/drive/callback?code=abc&state=${loc.searchParams.get('state')}`, { redirect: 'manual', headers: { Cookie: `${b.cookie}; ${flow}` } });
  assert.equal(back.headers.get('location'), '/visit?drive=error_expired');
  assert.equal((await b.as('GET', '/api/drive')).body.connected, false);
});

test('会社以外の Google アカウントでは、つながらない', async () => {
  const s = await t.login('boss');
  g.userinfo = { email: 'someone@gmail.com', email_verified: true };
  const r = await connect(s);
  g.userinfo = { email: 'nakatani.masahiro@limgroup.jp', email_verified: true, hd: 'limgroup.jp' };
  assert.equal(r.headers.get('location'), '/visit?drive=error_domain');
  assert.equal((await s.as('GET', '/api/drive')).body.connected, false);
});

test('お客様のフォルダがあれば、打合せのフォルダ（⑥打合せ関係 → ①打合せ資料 議事録）に録音と文字起こしを置き、受け渡し箱の音声は消す', async () => {
  g.folders.push(
    { id: 'custs', name: '001.お客様', parents: ['root'] },
    { id: 'cust1', name: '006.大崎純様', parents: ['custs'] },
    { id: 'c1m', name: '⑥打合せ関係', parents: ['cust1'] },
    { id: 'c1other', name: '④設計図書', parents: ['cust1'] },
    { id: 'cust1rec', name: '①打合せ資料 議事録', parents: ['c1m'] },
    { id: 'c1keiyaku', name: '④契約前議事録', parents: ['c1m'] },
    { id: 'c1rec2', name: '録音', parents: ['cust1'] },
  );
  const s = await t.login();
  const { v, audio } = await record(s, '大崎 純 様', '[0:01] よろしくお願いします\n[0:05] 間取りの件ですが');
  assert.equal(v.hasText, true);
  const r = await s.as('POST', `/api/visits/${v.id}/drive`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.visit.drive.where, 'customer');
  assert.equal(r.body.visit.drive.folder, '006.大崎純様/⑥打合せ関係/①打合せ資料 議事録');
  const [au, tx] = g.uploads.slice(-2);
  assert.deepEqual(au.meta.parents, ['cust1rec']);
  assert.match(au.meta.name, /^\d{4}-\d{2}-\d{2} \d{4} 大崎純様 打ち合わせ\.m4a$/);
  assert.equal(au.type, 'audio/mp4');
  assert.ok(au.data.equals(audio), '録った音声がそのまま届く');
  assert.match(tx.meta.name, /文字起こし\.txt$/);
  assert.match(tx.data.toString('utf8'), /間取りの件ですが/);
  assert.match(tx.data.toString('utf8'), /端末の中だけで作った/);
  // 受け渡し箱の音声は消えている（Claude からも取り出せない）
  const key = { Authorization: `Bearer ${'k'.repeat(40)}`, 'X-Staff-Id': 'claude-sorter' };
  assert.equal((await t.call('GET', `/api/visits/inbox/${v.id}/chunk/0`, undefined, key)).status, 410);
  // 文字起こしは本人なら読める
  assert.match((await s.as('GET', `/api/visits/${v.id}/text`)).body.text, /よろしく/);
  assert.equal((await (await t.login('tanaka')).as('GET', `/api/visits/${v.id}/text`)).status, 404);
});

test('契約の録音は「④契約前議事録」に置く', async () => {
  const s = await t.login();
  const v = (await s.as('POST', '/api/visits', { customerName: '大崎 純', title: '契約' })).body.visit;
  await s.as('POST', `/api/visits/${v.id}/chunk`, { seq: 0, data: Buffer.from('x').toString('base64') });
  await s.as('POST', `/api/visits/${v.id}/finish`, { chunks: 1, mime: 'audio/mp4' });
  const r = await s.as('POST', `/api/visits/${v.id}/drive`);
  assert.equal(r.body.visit.drive.folder, '006.大崎純様/⑥打合せ関係/④契約前議事録');
});

test('お客様のフォルダが無ければ、マイドライブの「録音」フォルダを作って置く（お客様フォルダの中の「録音」は使わない）', async () => {
  const s = await t.login();
  const before = g.created.length;
  const { v } = await record(s, '寺川 花子');
  const r = await s.as('POST', `/api/visits/${v.id}/drive`);
  assert.equal(r.status, 200);
  assert.equal(r.body.visit.drive.where, 'fallback');
  assert.equal(r.body.visit.drive.folder, '録音');
  assert.equal(g.created.length, before + 1);
  assert.deepEqual(g.created.at(-1).parents, ['root']);
  // 2 本目は作らずに同じフォルダへ
  const { v: v2 } = await record(s, '寺川 花子');
  await s.as('POST', `/api/visits/${v2.id}/drive`);
  assert.equal(g.created.length, before + 1);
  assert.deepEqual(g.uploads.at(-1).meta.parents, [g.created.at(-1).id]);
});

test('番号付きの「007.録音」があれば、そこを予備に使う', async () => {
  g.folders.push({ id: 'shiryo', name: '002.資料関係', parents: ['root'] }, { id: 'rec007', name: '007.録音', parents: ['shiryo'], modifiedTime: '2099-01-01T00:00:00Z' });
  const s = await t.login();
  const { v } = await record(s, '山本 一郎');
  const r = await s.as('POST', `/api/visits/${v.id}/drive`);
  assert.equal(r.body.visit.drive.folder, '007.録音');
  assert.deepEqual(g.uploads.at(-1).meta.parents, ['rec007']);
});

test('電池切れなどで止まった録音は、届いたところまでで締めて、途中までの文字起こしと一緒にドライブに置く', async () => {
  const s = await t.login();
  const v = (await s.as('POST', '/api/visits', { customerName: '大崎 純', title: '打ち合わせ' })).body.visit;
  await s.as('POST', `/api/visits/${v.id}/chunk`, { seq: 0, data: Buffer.from('aaa').toString('base64'), mime: 'audio/mp4', elapsedMs: 10000, text: '[0:01] こんにちは' });
  await s.as('POST', `/api/visits/${v.id}/chunk`, { seq: 1, data: Buffer.from('bbb').toString('base64'), elapsedMs: 20000, text: '[0:01] こんにちは\n[0:12] 間取りの話' });
  // まだ締めていない（finish が来ない）。10 分たったことにする
  const realNow = Date.now; Date.now = () => realNow() + 11 * 60 * 1000;
  try {
    const list = (await s.as('GET', '/api/visits')).body.visits;
    const x = list.find((y) => y.id === v.id);
    assert.equal(x.status, 'ready');
    assert.equal(x.interrupted, true);
    assert.equal(x.chunks, 2);
    assert.equal(x.durationMs, 20000);
    const r = await s.as('POST', `/api/visits/${v.id}/drive`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [au, tx] = g.uploads.slice(-2);
    assert.equal(au.data.toString(), 'aaabbb');
    assert.match(au.meta.name, /（途中まで）\.m4a$/);
    assert.match(tx.data.toString('utf8'), /間取りの話/);
    assert.match(tx.data.toString('utf8'), /途中で止まった/);
  } finally { Date.now = realNow; }
});

test('1 日 1 回の見回りは、合言葉が無いと動かない', async () => {
  assert.equal((await t.call('GET', '/api/cron')).status, 401);
  assert.equal((await t.call('GET', '/api/cron', undefined, { Authorization: 'Bearer wrong' })).status, 401);
});

test('つないでいない人の録音は受け渡し箱に残り、つないだ後の「まとめて置く」で置かれる', async () => {
  const s = await t.login('tanaka');
  const { v } = await record(s, '大崎 純 様');
  const r = await s.as('POST', `/api/visits/${v.id}/drive`);
  assert.equal(r.status, 409);
  assert.equal(r.body.need, 'connect');
  assert.equal((await s.as('POST', '/api/visits/sync')).body.done.length, 0);
  await connect(s);
  const sync = await s.as('POST', '/api/visits/sync');
  assert.deepEqual(sync.body.done.map((d) => d.ok), [true]);
  const list = (await s.as('GET', '/api/visits')).body.visits;
  assert.ok(list.find((x) => x.id === v.id).drive);
});

test('接続を切ると、Google 側の許可も取り消す', async () => {
  const s = await t.login('tanaka');
  const n = g.revoked;
  assert.equal((await s.as('POST', '/api/drive/disconnect')).status, 200);
  assert.equal(g.revoked, n + 1);
  assert.equal((await s.as('GET', '/api/drive')).body.connected, false);
});

test('設定が無いときは、ドライブは「使えない」と返し、録音はそのまま受け渡し箱に残る', async () => {
  const t2 = await boot();
  try {
    const s = await t2.login();
    assert.deepEqual((await s.as('GET', '/api/drive')).body, { enabled: false, connected: false });
    const v = (await s.as('POST', '/api/visits', { customerName: '大崎 純 様' })).body.visit;
    await s.as('POST', `/api/visits/${v.id}/chunk`, { seq: 0, data: Buffer.from('x').toString('base64') });
    await s.as('POST', `/api/visits/${v.id}/finish`, { chunks: 1, mime: 'audio/mp4' });
    const r = await s.as('POST', `/api/visits/${v.id}/drive`);
    assert.equal(r.status, 502);
    const key = { Authorization: `Bearer ${'k'.repeat(40)}`, 'X-Staff-Id': 'claude-sorter' };
    assert.equal((await t2.call('GET', `/api/visits/inbox/${v.id}/chunk/0`, undefined, key)).status, 200);
  } finally { t2.close(); }
});

test('お名前の比べ方（様・空白を無視）', () => {
  const d = createDrive({ env: {}, keys: {}, store: null, seal: null, unseal: null });
  assert.equal(d._norm('大崎 純 様'), '大崎純');
  assert.equal(d._norm('2025_大崎　純様邸'), '2025大崎純');
});
