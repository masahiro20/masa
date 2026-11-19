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
    // temp: true は「初期パスワード」。最初のログインで本人に変えてもらう
    m.set(a.id, { id: a.id, name: String(a.name || a.id).slice(0, 40), role: a.role === 'admin' ? 'admin' : 'staff', hash: a.hash, temp: a.temp === true });
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
    const tok = sec.signToken(keys.sessionKey, { sid, sub: staff.id, name: staff.name, role: staff.role, via: staff.via, pwc: staff.mustChange ? 1 : 0, pwv: staff.pwv || 0, exp });
    return { cookie: cookieFor(tok, SESSION_HOURS * 3600), exp };
  }

  async function fromCookie(headers) {
    const tok = parseCookies(headers.cookie)[COOKIE];
    if (!tok) return null;
    const p = sec.verifyToken(keys.sessionKey, tok);
    if (!p) return null;
    // ログアウト済みの合札は使えない。パスワードを変えたら、それより前の合札も使えない
    const [revoked, pwRaw] = await store.pipeline([['GET', `revoked:${p.sid}`], ['GET', `staffpw:${p.sub}`]]);
    if (revoked) return null;
    if (p.via === 'password') {
      if (!accounts.has(p.sub)) return null; // 登録が消されていたら無効
      const cur = parsePw(pwRaw);
      if ((cur ? cur.v : 0) !== (p.pwv || 0)) return null;
    }
    return { id: p.sub, name: p.name, role: p.role, via: p.via, sid: p.sid, exp: p.exp, cookie: true, mustChange: !!p.pwc };
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

  const parsePw = (raw) => { try { const j = raw ? JSON.parse(raw) : null; return j && j.hash ? j : null; } catch (_) { return null; } };

  // リクエストからスタッフを読み取る（無ければ null）。
  // 初期パスワードのままの人は、パスワードの変更とログアウト以外は何もできない
  async function staffOf(req, { allowMustChange } = {}) {
    const s = await staffOfRaw(req);
    if (s && s.mustChange && !allowMustChange) return null;
    return s;
  }
  async function staffOfRaw(req) {
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
    // 本人が変えたパスワードがあればそれだけを使う（初期パスワードは使えなくなる）
    const cur = acct ? parsePw((await store.pipeline([['GET', `staffpw:${acct.id}`]]))[0]) : null;
    const okPw = sec.verifyPassword(String(password || ''), cur ? cur.hash : acct && acct.hash); // 無い ID でも同じ時間をかける
    if (!acct || !okPw) {
      await limiter.hit('login_fail_ip', ip);
      await limiter.hit('login_fail_account', acctKey);
      return { error: 401 };
    }
    const mustChange = !cur && acct.temp;
    const s = await issueSession({ id: acct.id, name: acct.name, role: acct.role, via: 'password', mustChange, pwv: cur ? cur.v : 0 });
    return { staff: { id: acct.id, name: acct.name, role: acct.role, mustChange }, cookie: s.cookie };
  }

  // パスワードの変更（本人だけ。いまのパスワードの確認が必要）
  function weak(pw, id) {
    if (pw.length < 10) return '10 文字以上にしてください';
    if (pw.length > 200) return '長すぎます';
    if (pw.toLowerCase().includes(String(id).toLowerCase())) return '社員 ID を含まないものにしてください';
    if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|password|qwerty)/i.test(pw)) return '推測されやすいパスワードです';
    if (new Set(pw).size < 5) return 'もう少し複雑にしてください（同じ文字の繰り返しは使えません）';
    return null;
  }
  async function changePassword(req, staff, current, next) {
    if (!staff || staff.via !== 'password' || !accounts.has(staff.id)) return { error: 400, message: 'この方法でログインした方は、ここでは変更できません' };
    const ip = req.ip || 'unknown';
    const lim = await limiter.peek('login_fail_account', staff.id.toLowerCase());
    if (!lim.ok) return { error: 429, retryAfter: lim.retryAfter };
    const acct = accounts.get(staff.id);
    const cur = parsePw((await store.pipeline([['GET', `staffpw:${acct.id}`]]))[0]);
    if (!sec.verifyPassword(String(current || ''), cur ? cur.hash : acct.hash)) {
      await limiter.hit('login_fail_account', staff.id.toLowerCase());
      await limiter.hit('login_fail_ip', ip);
      return { error: 401, message: 'いまのパスワードが違います' };
    }
    const nx = String(next || '');
    const w = weak(nx, acct.id);
    if (w) return { error: 400, message: w };
    if (sec.verifyPassword(nx, cur ? cur.hash : acct.hash)) return { error: 400, message: 'いまと違うパスワードにしてください' };
    const v = Date.now();
    await store.pipeline([['SET', `staffpw:${acct.id}`, JSON.stringify({ hash: sec.hashPassword(nx), v })]]);
    if (staff.sid) await store.pipeline([['SET', `revoked:${staff.sid}`, 1, 'EX', 13 * 3600]]);
    const sess = await issueSession({ id: acct.id, name: acct.name, role: acct.role, via: 'password', mustChange: false, pwv: v });
    return { staff: { id: acct.id, name: acct.name, role: acct.role, mustChange: false }, cookie: sess.cookie };
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
    staffOf, sameOrigin, login, logout, exchangeCompass, issueSession, changePassword,
    configured: { password: accounts.size > 0, apiKey: !!apiKey, compass: !!compassSecret },
  };
}

module.exports = { createAuth, parseStaffAccounts, parseCookies, COOKIE };
