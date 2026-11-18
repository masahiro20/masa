'use strict';
// 暗号まわりの小物（Node.js 標準の crypto だけを使う）
//   ・乱数トークン、ハッシュ、署名
//   ・保存データの暗号化（AES-256-GCM）
//   ・パスワードのハッシュ（scrypt）

const crypto = require('node:crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

function token(bytes = 32) { return b64u(crypto.randomBytes(bytes)); }
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function hmac(key, data) { return crypto.createHmac('sha256', key).update(String(data)).digest(); }

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  if (x.length === 0 || x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

// ---- 鍵 ----
// 本番では DATA_KEY（保存データの暗号化）と SESSION_SECRET（ログインの署名）を必ず設定する。
// 開発時（未設定）は起動ごとに使い捨ての鍵を作る（再起動すると読めなくなる）。
function loadKeys(env) {
  const prod = !!env.VERCEL || env.NODE_ENV === 'production';
  const missing = [];
  const keyFrom = (name, bytes) => {
    const raw = env[name];
    if (raw) {
      const buf = fromB64u(raw);
      if (buf.length < bytes) throw new Error(`${name} は ${bytes} バイト以上の base64url にしてください`);
      return buf.subarray(0, bytes);
    }
    missing.push(name);
    return crypto.randomBytes(bytes);
  };
  const dataKey = keyFrom('DATA_KEY', 32);
  const sessionKey = keyFrom('SESSION_SECRET', 32);
  return { dataKey, sessionKey, ready: !(prod && missing.length), missing, ephemeral: missing.length > 0 };
}

// ---- 保存データの暗号化 ----
// 形式: v1.<iv>.<tag>.<本文>（すべて base64url）。aad に用途（例: room:abc-defg-hij）を入れ、
// 別のレコードに付け替えられても読めないようにする。
function seal(key, value, aad = '') {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return `v1.${b64u(iv)}.${b64u(c.getAuthTag())}.${b64u(ct)}`;
}

function open(key, sealed, aad = '') {
  if (typeof sealed !== 'string' || !sealed.startsWith('v1.')) return null;
  const [, iv, tag, ct] = sealed.split('.');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, fromB64u(iv));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(fromB64u(tag));
    return JSON.parse(Buffer.concat([d.update(fromB64u(ct)), d.final()]).toString('utf8'));
  } catch (_) {
    return null;
  }
}

// ---- パスワード（scrypt） ----
// 形式: scrypt$<N>$<r>$<p>$<salt>$<hash>
function hashPassword(password, { N = 16384, r = 8, p = 1 } = {}) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${b64u(salt)}$${b64u(hash)}`;
}

// 存在しないアカウントでも同じだけ時間をかける（アカウントの有無を時間で推測させない）
const DUMMY_HASH = hashPassword(token(12));

function verifyPassword(password, stored) {
  const parts = String(stored || DUMMY_HASH).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const got = crypto.scryptSync(String(password), fromB64u(salt), 32, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  const want = fromB64u(hash);
  return stored ? (got.length === want.length && crypto.timingSafeEqual(got, want)) : false;
}

// ---- 署名つきトークン（ログインの合札・COMPASS からの JWT） ----
function signToken(key, payload) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${b64u(hmac(key, body))}`;
}

function verifyToken(key, tok) {
  const [body, sig] = String(tok || '').split('.');
  if (!body || !sig) return null;
  if (!safeEqual(b64u(hmac(key, body)), sig)) return null;
  try {
    const p = JSON.parse(fromB64u(body).toString('utf8'));
    if (!p.exp || p.exp * 1000 < Date.now()) return null;
    return p;
  } catch (_) { return null; }
}

// HS256 の JWT を確かめる（COMPASS 連携用。iss / aud / exp / 有効時間の上限を必ず確認）
function verifyJwtHS256(secret, jwt, { iss, aud, maxLifetimeSec = 600 } = {}) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header, claims;
  try {
    header = JSON.parse(fromB64u(h).toString('utf8'));
    claims = JSON.parse(fromB64u(p).toString('utf8'));
  } catch (_) { return null; }
  if (header.alg !== 'HS256' || header.typ && header.typ !== 'JWT') return null; // alg=none などを拒否
  const expect = b64u(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest());
  if (!safeEqual(expect, s)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp < now) return null;
  if (typeof claims.iat !== 'number' || claims.iat > now + 60 || claims.exp - claims.iat > maxLifetimeSec) return null;
  if (iss && claims.iss !== iss) return null;
  if (aud && claims.aud !== aud && !(Array.isArray(claims.aud) && claims.aud.includes(aud))) return null;
  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  return claims;
}

function signJwtHS256(secret, claims) { // 試験・COMPASS 側の実装例として
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(claims));
  return `${h}.${p}.${b64u(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest())}`;
}

module.exports = {
  token, sha256, hmac, safeEqual, loadKeys, seal, open,
  hashPassword, verifyPassword, signToken, verifyToken, verifyJwtHS256, signJwtHS256, b64u, fromB64u,
};
