// COMPASS 通話 — 手元で動かすときのサーバー（依存パッケージなし）
//   npm start → http://localhost:8080
// Vercel では api/handler.js が同じ中身（lib/core.js）を使う。
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createCore, ROOM_ID_RE } = require('./lib/core');
const { storeFromEnv } = require('./lib/store');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveFile(res, file) {
  const p = path.join(PUBLIC_DIR, file);
  if (!p.startsWith(PUBLIC_DIR)) { res.writeHead(404); return res.end(); }
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function start(port = Number(process.env.PORT || 8080), { store = storeFromEnv(), env = process.env } = {}) {
  const core = createCore({ store, env });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (req.method === 'GET' && p === '/') return serveFile(res, 'index.html');
      if (req.method === 'GET' && /^\/r\/[^/]+$/.test(p)) {
        if (!ROOM_ID_RE.test(p.slice(3))) { res.writeHead(404); return res.end('not found'); }
        return serveFile(res, 'room.html');
      }
      if (req.method === 'GET' && /^\/static\/[\w.-]+$/.test(p)) return serveFile(res, p.slice(8));
      if (!p.startsWith('/api/')) { res.writeHead(404); return res.end('not found'); }

      let body = {};
      if (req.method === 'POST') {
        try { body = await readBody(req); } catch (_) { body = null; }
        if (body === null) return send(res, 400, { error: '送られた内容を読めません' });
      }
      const r = await core.handle({
        method: req.method,
        path: p,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body,
        origin: `http://${req.headers.host}`,
      });
      send(res, r.status, r.body);
    } catch (e) {
      console.error(e);
      send(res, 500, { error: 'サーバーの不具合です' });
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

if (require.main === module) {
  start().then((s) => {
    console.log(`COMPASS 通話: http://localhost:${s.address().port}`);
    if (!process.env.MEET_API_KEY) console.log('※ MEET_API_KEY が未設定です。本番では必ず設定してください。');
  });
}

module.exports = { start };
