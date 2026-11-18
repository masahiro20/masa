'use strict';
// Google アカウント（会社のドメイン）でのログイン
//
// 流れ（OpenID Connect の認可コード方式 + PKCE）
//   1) /api/auth/google/start  … Google のログイン画面へ送る（state・nonce・PKCE を短命の Cookie に入れる）
//   2) Google でログイン
//   3) /api/auth/google/callback … コードを ID トークンに交換し、署名・発行元・宛先・期限・nonce・
//      メール確認済み・会社のドメイン（hd）を確かめてから、COMPASS Meet のログイン Cookie を発行する
//
// 設定（環境変数）
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET … Google Cloud で作る「OAuth クライアント（ウェブ）」
//   GOOGLE_ALLOWED_DOMAIN                   … 通す会社のドメイン（例 limgroup.jp）。必須
//   GOOGLE_ADMIN_EMAILS                     … 管理者にするメールアドレス（カンマ区切り。任意）
//   GOOGLE_ALLOWED_EMAILS                   … さらに人を絞る場合のメールアドレス（カンマ区切り。任意）

const crypto = require('node:crypto');
const sec = require('./secure');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const FLOW_COOKIE = 'cm_oauth';

const list = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// ログイン後に戻る先は、このサイトの中のページだけ（外のサイトへ飛ばされないように）
function safeReturn(p) {
  const s = String(p || '/');
  if (!/^\/(r\/[a-z]{3}-[a-z]{4}-[a-z]{3}|records)?$/.test(s)) return '/';
  return s;
}

function createGoogle({ env, keys, fetchImpl = fetch }) {
  const clientId = env.GOOGLE_CLIENT_ID || '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET || '';
  const domain = String(env.GOOGLE_ALLOWED_DOMAIN || '').trim().toLowerCase();
  const admins = list(env.GOOGLE_ADMIN_EMAILS);
  const allowEmails = list(env.GOOGLE_ALLOWED_EMAILS);
  const enabled = !!(clientId && clientSecret && domain);
  const secureCookie = env.INSECURE_COOKIE !== '1';
  const publicUrl = (env.PUBLIC_URL || '').replace(/\/$/, '');

  let jwksCache = { at: 0, keys: [] };
  async function jwks(force) {
    if (!force && Date.now() - jwksCache.at < 3600e3 && jwksCache.keys.length) return jwksCache.keys;
    const r = await fetchImpl(JWKS_URL);
    if (!r.ok) throw new Error('Google の公開鍵を取得できませんでした');
    const j = await r.json();
    jwksCache = { at: Date.now(), keys: Array.isArray(j.keys) ? j.keys : [] };
    return jwksCache.keys;
  }

  const redirectUri = (origin) => `${publicUrl || origin}/api/auth/google/callback`;
  const cookie = (v, maxAge) => `${FLOW_COOKIE}=${v}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;

  // 1) Google のログイン画面へ
  function start(req) {
    const state = sec.token(24);
    const nonce = sec.token(24);
    const verifier = sec.token(48);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const flow = sec.signToken(keys.sessionKey, { state, nonce, verifier, ret: safeReturn(req.query.returnTo), exp: Math.floor(Date.now() / 1000) + 600 });
    const q = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri(req.origin), response_type: 'code',
      scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
      hd: domain, prompt: 'select_account',
    });
    return { location: `${AUTH_URL}?${q}`, cookie: cookie(flow, 600) };
  }

  // ID トークンを確かめる（署名 RS256、発行元、宛先、期限、nonce）
  async function verifyIdToken(idToken, nonce) {
    const parts = String(idToken || '').split('.');
    if (parts.length !== 3) return null;
    let header; let claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch (_) { return null; }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    let jwk = (await jwks()).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await jwks(true)).find((k) => k.kid === header.kid); // 鍵が入れ替わった直後
    if (!jwk || jwk.kty !== 'RSA') return null;
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!ok) return null;
    const now = Math.floor(Date.now() / 1000);
    if (!ISSUERS.includes(claims.iss)) return null;
    if (claims.aud !== clientId && !(Array.isArray(claims.aud) && claims.aud.includes(clientId))) return null;
    if (typeof claims.exp !== 'number' || claims.exp < now - 60) return null;
    if (typeof claims.iat !== 'number' || claims.iat > now + 300) return null;
    if (!nonce || !sec.safeEqual(claims.nonce, nonce)) return null;
    return claims;
  }

  // 3) 戻ってきたときの確認。返り値 { staff, ret } か { error }
  async function callback(req) {
    const flowTok = (String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${FLOW_COOKIE}=([^;]+)`)) || [])[1];
    const flow = flowTok && sec.verifyToken(keys.sessionKey, flowTok);
    if (!flow) return { error: 'expired' };
    const ret = flow.ret;
    if (req.query.error) return { error: 'cancelled', ret };
    if (!req.query.state || !sec.safeEqual(req.query.state, flow.state)) return { error: 'state', ret };
    const code = String(req.query.code || '');
    if (!code || code.length > 2048) return { error: 'state', ret };

    const r = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(req.origin), grant_type: 'authorization_code', code_verifier: flow.verifier }).toString(),
    });
    if (!r.ok) return { error: 'token', ret };
    const tok = await r.json();
    const claims = await verifyIdToken(tok.id_token, flow.nonce);
    if (!claims) return { error: 'token', ret };

    const email = String(claims.email || '').toLowerCase();
    // 会社のアカウントか：hd（Google Workspace のドメイン）とメールのドメインの両方で確かめる
    if (claims.email_verified !== true || claims.hd !== domain || !email.endsWith(`@${domain}`)) return { error: 'domain', ret };
    if (allowEmails.length && !allowEmails.includes(email)) return { error: 'notallowed', ret };
    return {
      ret,
      staff: { id: email, name: String(claims.name || email.split('@')[0]).slice(0, 40), role: admins.includes(email) ? 'admin' : 'staff', via: 'google' },
    };
  }

  return { enabled, domain, start, callback, clearCookie: cookie('', 0), _verifyIdToken: verifyIdToken };
}

module.exports = { createGoogle, safeReturn };
