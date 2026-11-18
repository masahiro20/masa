// COMPASS Meet — 手元で動かすときのサーバー（依存パッケージなし）
//   npm start → http://localhost:8080
// Vercel では api/handler.js が同じ中身（lib/api.js）を使う。
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createApi, ROOM_ID_RE } = require('./lib/api');
const { storeFromEnv } = require('./lib/store');

const PUBLIC_DIR = path.join(__dirname, 'public');
// Vercel（vercel.json）と同じ安全用ヘッダー
const SECURITY_HEADERS = Object.fromEntries(require('./lib/headers.json').map((h) => [h.key, h.value]));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveFile(res, file) {
  const p = path.normalize(path.join(PUBLIC_DIR, file));
  if (!p.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(404); return res.end(); }
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404, SECURITY_HEADERS); return res.end('not found'); }
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let tooBig = false;
    // 上限を超えたら貯めるのをやめ、最後まで受け取ってから 413 を返す（途中で切ると相手に返事が届かない）
    req.on('data', (c) => { size += c.length; if (size > limit) tooBig = true; else chunks.push(c); });
    req.on('end', () => {
      if (tooBig) return reject(Object.assign(new Error('too large'), { code: 413 }));
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch (e) { reject(Object.assign(e, { code: 400 })); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

function start(port = Number(process.env.PORT || 8080), { store = storeFromEnv(), env = process.env, fetchImpl } = {}) {
  const api = createApi({ store, env, fetchImpl });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (req.method === 'GET' && p === '/') return serveFile(res, 'index.html');
      if (req.method === 'GET' && p === '/records') return serveFile(res, 'records.html');
      if (req.method === 'GET' && /^\/r\/[^/]+$/.test(p)) {
        if (!ROOM_ID_RE.test(p.slice(3))) { res.writeHead(404, SECURITY_HEADERS); return res.end('not found'); }
        return serveFile(res, 'room.html');
      }
      if (req.method === 'GET' && /^\/static\/[\w.-]+(\/[\w.-]+)*$/.test(p)) return serveFile(res, p.slice(8));
      if (!p.startsWith('/api/')) { res.writeHead(404, SECURITY_HEADERS); return res.end('not found'); }

      let body = {};
      if (req.method === 'POST' || req.method === 'PUT') {
        const ct = String(req.headers['content-type'] || '');
        // JSON 以外は受け付けない（フォーム送信を使った CSRF をさらに難しくする）
        if (!ct.startsWith('application/json')) return send(res, 415, { error: 'JSON で送ってください' });
        try { body = await readBody(req, 1024 * 1024); } catch (e) { return send(res, e.code === 413 ? 413 : 400, { error: '送られた内容を読めません' }); }
      }
      const r = await api.handle({
        method: req.method,
        path: p,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body,
        origin: `http://${req.headers.host}`,
        ip: req.socket.remoteAddress,
      });
      send(res, r.status, r.body, r.headers || {});
    } catch (e) {
      console.error('サーバーの不具合', e && e.message); // 本文・個人情報はログに出さない
      send(res, 500, { error: 'サーバーの不具合です' });
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (require.main === module) {
  start().then((s) => {
    console.log(`COMPASS Meet: http://localhost:${s.address().port}`);
  });
}

module.exports = { start };
