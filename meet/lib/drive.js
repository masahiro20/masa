'use strict';
// 録音を、担当者本人の Google ドライブへ直接置く
//
// 流れ
//   1) 担当者が一度だけ「ドライブにつなぐ」を押す → Google の同意画面（会社のアカウントだけ）
//      → 戻ってきたら、更新用の鍵（refresh token）を暗号化して保存する
//   2) 対面の録音が終わると、サーバーが受け渡し箱の音声をつなげて、その人のドライブに置く
//      置き場所：その人の「マイドライブ」にあるお客様のフォルダ（中に「録音」フォルダがあればそこ）。
//      見つからなければ マイドライブ直下の「録音」フォルダ（無ければ作る）
//      共有ドライブには書き込まない（会社の決まり）
//   3) 置けたら、受け渡し箱の音声は消す
//
// 設定（環境変数）：ログインと同じ Google Cloud の「OAuth クライアント（ウェブ）」を使う
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_ALLOWED_DOMAIN
//   承認済みのリダイレクト URI に  {PUBLIC_URL}/api/drive/callback  を足す
//   Google Drive API を有効にし、同意画面は「内部」にする（会社の人だけ・審査なし）

const crypto = require('node:crypto');
const sec = require('./secure');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SCOPE = 'openid email https://www.googleapis.com/auth/drive';
const FOLDER = 'application/vnd.google-apps.folder';
const COOKIE = 'cm_drive';
const FALLBACK = '録音';

// お名前の比べ方：「様」・空白・記号を除く
const norm = (s) => String(s || '').normalize('NFKC').replace(/様|さま|殿|邸|御中/g, '').replace(/[\s_\-・,，.、。()（）［］[\]【】「」]/g, '').toLowerCase();
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function createDrive({ env, keys, store, seal, unseal, fetchImpl = fetch }) {
  const clientId = env.GOOGLE_CLIENT_ID || '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET || '';
  const domain = String(env.GOOGLE_ALLOWED_DOMAIN || '').trim().toLowerCase();
  const enabled = !!(clientId && clientSecret && domain);
  const secureCookie = env.INSECURE_COOKIE !== '1';
  const publicUrl = (env.PUBLIC_URL || '').replace(/\/$/, '');
  const redirectUri = (origin) => `${publicUrl || origin}/api/drive/callback`;
  const cookie = (v, maxAge) => `${COOKIE}=${v}; Path=/api/drive; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
  const key = (staffId) => `drive:${staffId}`;
  const tokCache = new Map(); // staffId → { token, exp }

  async function load(staffId) {
    const [raw] = await store.pipeline([['GET', key(staffId)]]);
    return raw ? unseal(raw, `drive:${staffId}`) : null;
  }

  async function status(staffId) {
    if (!enabled) return { enabled: false, connected: false };
    const d = await load(staffId);
    return { enabled: true, connected: !!d, email: d ? d.email : '' };
  }

  // 1) 同意画面へ
  function start(req, staff) {
    const state = sec.token(24);
    const verifier = sec.token(48);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const flow = sec.signToken(keys.sessionKey, { state, verifier, sid: staff.id, exp: Math.floor(Date.now() / 1000) + 600 });
    const p = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri(req.origin), response_type: 'code', scope: SCOPE,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
      state, code_challenge: challenge, code_challenge_method: 'S256', hd: domain,
    });
    if (/@/.test(staff.id)) p.set('login_hint', staff.id);
    return { location: `${AUTH_URL}?${p}`, cookie: cookie(flow, 600) };
  }

  // 2) 戻ってきたとき。返り値 { ok } か { error }
  async function callback(req, staff) {
    const tok = (String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`)) || [])[1];
    const flow = tok && sec.verifyToken(keys.sessionKey, tok);
    if (!flow || flow.sid !== staff.id) return { error: 'expired' };
    if (req.query.error) return { error: 'cancelled' };
    if (!req.query.state || !sec.safeEqual(req.query.state, flow.state)) return { error: 'state' };
    const code = String(req.query.code || '');
    if (!code || code.length > 2048) return { error: 'state' };
    const r = await fetchImpl(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(req.origin), grant_type: 'authorization_code', code_verifier: flow.verifier }).toString(),
    });
    if (!r.ok) return { error: 'token' };
    const t = await r.json();
    if (!t.refresh_token || !t.access_token) return { error: 'token' };
    if (!String(t.scope || '').split(' ').includes('https://www.googleapis.com/auth/drive')) return { error: 'scope' };
    const u = await fetchImpl(USERINFO_URL, { headers: { Authorization: `Bearer ${t.access_token}` } });
    if (!u.ok) return { error: 'token' };
    const info = await u.json();
    const email = String(info.email || '').toLowerCase();
    if (info.email_verified !== true || info.hd !== domain || !email.endsWith(`@${domain}`)) return { error: 'domain' };
    await store.pipeline([['SET', key(staff.id), seal({ refresh: t.refresh_token, email, at: Date.now() }, `drive:${staff.id}`)]]);
    tokCache.set(staff.id, { token: t.access_token, exp: Date.now() + (Number(t.expires_in) || 3000) * 1000 - 60e3 });
    return { ok: true, email };
  }

  async function disconnect(staffId) {
    const d = await load(staffId);
    await store.pipeline([['DEL', key(staffId)]]);
    tokCache.delete(staffId);
    if (d) { try { await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(d.refresh)}`, { method: 'POST' }); } catch (_) { /* 取り消せなくても、こちらでは忘れる */ } }
  }

  async function accessToken(staffId) {
    const c = tokCache.get(staffId);
    if (c && c.exp > Date.now()) return c.token;
    const d = await load(staffId);
    if (!d) throw Object.assign(new Error('ドライブにつながっていません'), { code: 'connect' });
    const r = await fetchImpl(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: d.refresh, grant_type: 'refresh_token' }).toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      if (j.error === 'invalid_grant') { await store.pipeline([['DEL', key(staffId)]]); throw Object.assign(new Error('ドライブとの接続が切れました。もう一度つないでください'), { code: 'connect' }); }
      throw new Error('ドライブの鍵を更新できませんでした');
    }
    tokCache.set(staffId, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3000) * 1000 - 60e3 });
    return j.access_token;
  }

  async function gapi(token, path, params) {
    const r = await fetchImpl(`${API}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`ドライブの検索に失敗しました（${r.status}）`);
    return r.json();
  }
  async function folders(token, query, pages = 1) {
    const out = []; let pageToken = '';
    for (let i = 0; i < pages; i++) {
      const params = { q: `mimeType='${FOLDER}' and trashed=false and 'me' in owners${query ? ` and ${query}` : ''}`, fields: 'nextPageToken,files(id,name,parents,modifiedTime)', pageSize: '1000', orderBy: 'modifiedTime desc', corpora: 'user', spaces: 'drive' };
      if (pageToken) params.pageToken = pageToken;
      const j = await gapi(token, '/files', params);
      out.push(...(j.files || []));
      if (!j.nextPageToken) break;
      pageToken = j.nextPageToken;
    }
    return out;
  }

  // お客様のフォルダを探す。無ければ null
  async function findCustomerFolder(token, customerName) {
    const full = norm(customerName);
    if (full.length < 2) return null;
    const surname = norm(String(customerName).normalize('NFKC').trim().split(/[\s　]+/)[0]) || full.slice(0, 2);
    let list = await folders(token, `name contains '${q(surname)}'`);
    if (!list.length) list = await folders(token, '', 3); // 日本語は前方一致の検索で拾えないことがあるので、手元で絞る
    const strong = list.filter((f) => norm(f.name).includes(full) && norm(f.name) !== norm(FALLBACK));
    if (strong.length) return strong[0];
    const weak = list.filter((f) => surname.length >= 2 && norm(f.name).includes(surname));
    return weak.length === 1 ? weak[0] : null;
  }
  async function child(token, parentId, name) {
    const j = await folders(token, `'${q(parentId)}' in parents and name='${q(name)}'`);
    return (j || [])[0] || null;
  }
  async function fallbackFolder(token) {
    const found = await folders(token, `'root' in parents and name='${q(FALLBACK)}'`);
    if (found.length) return found[0];
    const r = await fetchImpl(`${API}/files?fields=id,name`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FALLBACK, mimeType: FOLDER, parents: ['root'] }),
    });
    if (!r.ok) throw new Error(`「${FALLBACK}」フォルダを作れませんでした（${r.status}）`);
    return r.json();
  }

  async function uploadFile(token, { name, mime, data, parentId, description }) {
    const init = await fetchImpl(`${UPLOAD}?uploadType=resumable&fields=id,name,webViewLink`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(data.length) },
      body: JSON.stringify({ name, parents: [parentId], description: description || '' }),
    });
    if (!init.ok) throw new Error(`ドライブへの送信を始められませんでした（${init.status}）`);
    const loc = init.headers.get('location');
    if (!loc || !/^https:\/\/www\.googleapis\.com\/upload\/drive\//.test(loc)) throw new Error('ドライブの送信先が正しくありません');
    const put = await fetchImpl(loc, { method: 'PUT', headers: { 'Content-Type': mime, 'Content-Length': String(data.length) }, body: data });
    if (!put.ok) throw new Error(`ドライブに置けませんでした（${put.status}）`);
    return put.json();
  }

  // 録音（と文字起こし）を置く
  async function save(staffId, { customerName, fileName, mime, audio, textName, text, description }) {
    const token = await accessToken(staffId);
    let folder = await findCustomerFolder(token, customerName);
    let where = 'customer';
    if (folder) { const sub = await child(token, folder.id, FALLBACK); if (sub) folder = { ...sub, name: `${folder.name}/${sub.name}` }; }
    else { folder = await fallbackFolder(token); where = 'fallback'; }
    const f = await uploadFile(token, { name: fileName, mime, data: audio, parentId: folder.id, description });
    let t = null;
    if (text) t = await uploadFile(token, { name: textName, mime: 'text/plain; charset=UTF-8', data: Buffer.from(text, 'utf8'), parentId: folder.id, description });
    return { fileId: f.id, name: f.name || fileName, link: f.webViewLink || '', folder: folder.name, folderId: folder.id, where, textFileId: t ? t.id : '' };
  }

  return { enabled, status, start, callback, disconnect, save, clearCookie: cookie('', 0), _norm: norm };
}

module.exports = { createDrive };
