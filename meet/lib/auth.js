'use strict';
// スタッフ（主催者になれる人）の本人確認
//
// 入口は 3 つ。どれも最後は同じ「スタッフ」の形 { id, name, role, via } になる。
//   1) 暫定ログイン：社員 ID とパスワード（STAFF_ACCOUNTS に scrypt ハッシュで登録）→ 署名つき Cookie
//   2) COMPASS からの引き継ぎ（将来）：COMPASS が発行する短命の JWT（HS256、COMPASS_JWT_SECRET）
//      → /api/auth/compass で Cookie に交換、または API 呼び出しに直接付ける
//   3) サーバー間（将来の COMPASS 本体から）：MEET_API_KEY ＋ X-Staff-Id / X-Staff-Name
// お客様（ゲスト）はアカウント不要。主催者の権限は、ここで確かめたスタッフにだけ与える。

const sec = require('./secure');

const COOKIE = 'cm_staff';
const SESSION_HOURS = 12;

function parseStaffAccounts(raw) {
  if (!raw) return new Map();
  let list;
  try { list = JSON.parse(raw); } catch (_) { throw new Error('STAFF_ACCOUNTS を読めません（JSON 配列にしてください）'); }
  const m = new Map();
  for (const a of list) {
    if (!a || typeof a.id !== 'string' || typeof a.hash !== 'string') continue;
    m.set(a.id, { id: a.id, name: String(a.name || a.id).slice(0, 40), role: a.role === 'admin' ? 'admin' : 'staff', hash: a.hash });
  }
  return m;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createAuth({ store, env, keys, limiter }) {
  const accounts = parseStaffAccounts(env.STAFF_ACCOUNTS);
  const apiKey = env.MEET_API_KEY || '';
  const compassSecret = env.COMPASS_JWT_SECRET || '';
  const secureCookie = env.INSECURE_COOKIE !== '1'; // 手元の http 試験でだけ 1 にする

  function cookieFor(token, maxAge) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
  }

  async function issueSession(staff) {
    const sid = sec.token(18);
    const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
    const tok = sec.signToken(keys.sessionKey, { sid, sub: staff.id, name: staff.name, role: staff.role, via: staff.via, exp });
    return { cookie: cookieFor(tok, SESSION_HOURS * 3600), exp };
  }

  async function fromCookie(headers) {
    const tok = parseCookies(headers.cookie)[COOKIE];
    if (!tok) return null;
    const p = sec.verifyToken(keys.sessionKey, tok);
    if (!p) return null;
    // ログアウト済みの合札は使えない
    const revoked = await store.pipeline([['GET', `revoked:${p.sid}`]]);
    if (revoked[0]) return null;
    // 暫定ログインの人は、登録が消されていたら無効
    if (p.via === 'password' && !accounts.has(p.sub)) return null;
    return { id: p.sub, name: p.name, role: p.role, via: p.via, sid: p.sid, exp: p.exp, cookie: true };
  }

  function fromApiKey(headers) {
    const h = headers.authorization || '';
    if (!apiKey || !h.startsWith('Bearer ')) return null;
    if (!sec.safeEqual(h.slice(7), apiKey)) return null;
    const id = String(headers['x-staff-id'] || '').trim().slice(0, 64);
    if (!/^[\w.@-]{1,64}$/.test(id)) return { invalid: true };
    const known = accounts.get(id);
    const name = known ? known.name : decodeURIComponent(String(headers['x-staff-name'] || id)).slice(0, 40);
    return { id, name, role: known ? known.role : 'staff', via: 'apikey' };
  }

  function fromCompassJwt(tok) {
    if (!compassSecret) return null;
    const c = sec.verifyJwtHS256(compassSecret, tok, { iss: 'compass', aud: 'compass-meet', maxLifetimeSec: 600 });
    if (!c || !/^[\w.@-]{1,64}$/.test(c.sub)) return null;
    return { id: c.sub, name: String(c.name || c.sub).slice(0, 40), role: c.role === 'admin' ? 'admin' : 'staff', via: 'compass', jti: c.jti };
  }

  // リクエストからスタッフを読み取る（無ければ null）
  async function staffOf(req) {
    const h = req.headers;
    if ((h.authorization || '').startsWith('Bearer ')) {
      const s = fromApiKey(h);
      return s && !s.invalid ? s : null;
    }
    if ((h.authorization || '').startsWith('CompassJWT ')) return fromCompassJwt(h.authorization.slice(11));
    return fromCookie(h);
  }

  // Cookie で認証する書き込みは、同じサイトからの送信だけ受け付ける（CSRF 対策）
  function sameOrigin(req) {
    const h = req.headers;
    const site = h['sec-fetch-site'];
    if (site && site !== 'same-origin') return false;
    const origin = h.origin;
    if (origin && origin !== req.origin) return false;
    if (!origin && !site) return false; // どちらも無い送信は、ブラウザ以外の不審な送信とみなす
    return true;
  }

  async function login(req, id, password) {
    const ip = req.ip || 'unknown';
    const acctKey = String(id).toLowerCase();
    const a = await limiter.peek('login_fail_ip', ip);
    const b = await limiter.peek('login_fail_account', acctKey);
    if (!a.ok || !b.ok) return { error: 429, retryAfter: Math.max(a.retryAfter, b.retryAfter) };
    const acct = accounts.get(String(id));
    const okPw = sec.verifyPassword(String(password || ''), acct && acct.hash); // 無い ID でも同じ時間をかける
    if (!acct || !okPw) {
      await limiter.hit('login_fail_ip', ip);
      await limiter.hit('login_fail_account', acctKey);
      return { error: 401 };
    }
    const s = await issueSession({ id: acct.id, name: acct.name, role: acct.role, via: 'password' });
    return { staff: { id: acct.id, name: acct.name, role: acct.role }, cookie: s.cookie };
  }

  async function exchangeCompass(req, jwt) {
    const ip = req.ip || 'unknown';
    const a = await limiter.peek('login_fail_ip', ip);
    if (!a.ok) return { error: 429, retryAfter: a.retryAfter };
    const s = fromCompassJwt(jwt);
    if (!s) { await limiter.hit('login_fail_ip', ip); return { error: 401 }; }
    // 同じ JWT の使い回しを防ぐ（jti があれば一度きり）
    if (s.jti) {
      const [set] = await store.pipeline([['SET', `jti:${sec.sha256(s.jti)}`, 1, 'EX', 900, 'NX']]);
      if (set !== 'OK') return { error: 401 };
    }
    const sess = await issueSession(s);
    return { staff: { id: s.id, name: s.name, role: s.role }, cookie: sess.cookie };
  }

  async function logout(staff) {
    if (staff && staff.sid) {
      const ttl = Math.max(60, staff.exp - Math.floor(Date.now() / 1000));
      await store.pipeline([['SET', `revoked:${staff.sid}`, 1, 'EX', ttl]]);
    }
    return cookieFor('', 0);
  }

  return {
    staffOf, sameOrigin, login, logout, exchangeCompass, issueSession,
    configured: { password: accounts.size > 0, apiKey: !!apiKey, compass: !!compassSecret },
  };
}

module.exports = { createAuth, parseStaffAccounts, parseCookies, COOKIE };
