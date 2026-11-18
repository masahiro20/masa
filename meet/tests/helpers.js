'use strict';
// 試験用の小物：手元サーバーの起動、スタッフのログイン、参加者の操作
const { start } = require('../server.js');
const { createMemoryStore } = require('../lib/store');
const sec = require('../lib/secure');

const PASSWORD = 'correct horse battery staple';
const ACCOUNTS = [
  { id: 'nakatani', name: '中谷 真弘', role: 'staff', hash: sec.hashPassword(PASSWORD) },
  { id: 'tanaka', name: '田中 一郎', role: 'staff', hash: sec.hashPassword(PASSWORD) },
  { id: 'boss', name: '管理者', role: 'admin', hash: sec.hashPassword(PASSWORD) },
];

async function boot(extraEnv = {}) {
  const store = createMemoryStore();
  const env = {
    STAFF_ACCOUNTS: JSON.stringify(ACCOUNTS),
    INSECURE_COOKIE: '1',
    MEET_API_KEY: 'k'.repeat(40),
    COMPASS_JWT_SECRET: 'c'.repeat(40),
    ...extraEnv,
  };
  const server = await start(0, { store, env });
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = () => { server.closeAllConnections(); server.close(); };

  async function call(method, path, body, headers = {}) {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: base, 'Sec-Fetch-Site': 'same-origin', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch (_) { /* 空 */ }
    return { status: r.status, body: json, headers: r.headers };
  }

  async function login(id = 'nakatani') {
    const r = await call('POST', '/api/auth/login', { id, password: PASSWORD });
    if (r.status !== 200) throw new Error(`login failed ${r.status}`);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const as = (method, path, body, headers = {}) => call(method, path, body, { Cookie: cookie, ...headers });
    return { cookie, as, staff: r.body.staff };
  }

  // 参加者（お客様・主催者）を表す小物
  function participant(roomId, creds) {
    const p = {
      ...creds,
      poll: async () => {
        await new Promise((res) => setTimeout(res, 360)); // 取りに来る間隔の下限を守る
        return call('GET', `/api/rooms/${roomId}/poll?peerId=${creds.peerId}`, undefined, { 'X-Peer-Secret': creds.secret });
      },
      act: (action, body = {}) => call('POST', `/api/rooms/${roomId}/${action}`, { peerId: creds.peerId, secret: creds.secret, ...body }),
    };
    p.events = async () => (await p.poll()).body.events.map((e) => e.type);
    return p;
  }

  async function joinAs(roomId, name, extra = {}, headers = {}) {
    const r = await call('POST', `/api/rooms/${roomId}/join`, { name, ...extra }, headers);
    return { res: r, p: r.status === 200 ? participant(roomId, r.body) : null };
  }

  return { store, env, base, close, call, login, participant, joinAs };
}

module.exports = { boot, PASSWORD, ACCOUNTS };
