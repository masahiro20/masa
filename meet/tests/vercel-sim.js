'use strict';
// vercel.json の rewrites と Vercel の関数の呼ばれ方をまねた、試験用の小さなサーバー。
// api/handler.js が Vercel 上と同じ形で動くかを手元で確かめる。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const handler = require('../api/handler.js');

function start(port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = url.pathname;
    if (p.startsWith('/api/')) {
      const sub = p.slice(5);
      url.searchParams.set('p', sub);
      req.url = `/api/handler?${url.searchParams}`;
      req.headers['x-forwarded-proto'] = 'http'; // Vercel は必ず付けてくる
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        req.body = raw ? JSON.parse(raw) : undefined; // Vercel は JSON を読んで渡す
        await handler(req, res);
      });
      return;
    }
    for (const r of cfg.rewrites) {
      if (r.source === '/r/:id' && /^\/r\/[^/]+$/.test(p)) p = r.destination;
      if (r.source === '/static/:file' && p.startsWith('/static/')) p = '/' + p.slice(8);
    }
    if (p === '/') p = '/index.html';
    const file = path.join(root, cfg.outputDirectory, p);
    fs.readFile(file, (e, buf) => {
      if (e) { res.writeHead(404); return res.end(); }
      const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)];
      res.writeHead(200, { 'Content-Type': type });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
module.exports = { start };
