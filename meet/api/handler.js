// Vercel で動かすときの入り口。/api/* はすべてここに来る（vercel.json の rewrites）。
'use strict';
const { createCore } = require('../lib/core');
const { storeFromEnv } = require('../lib/store');

const store = storeFromEnv();
const core = createCore({ store, env: process.env });

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // rewrites で元のパスを p に入れて渡している
  const sub = url.searchParams.get('p');
  url.searchParams.delete('p');
  const path = sub != null ? `/api/${sub}` : url.pathname;
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const proto = req.headers['x-forwarded-proto'] || 'https';
  // Vercel は呼ばれるたびに別のサーバーで動くことがあるので、伝言板（Upstash）が無いと通話がつながらない
  if (process.env.VERCEL && store.kind !== 'upstash' && !path.startsWith('/api/healthz')) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: '準備中です（伝言板 Upstash Redis がまだつながっていません）' }));
    return;
  }
  try {
    const r = await core.handle({
      method: req.method,
      path,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      body: body || {},
      origin: `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`,
    });
    res.statusCode = r.status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(r.body));
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'サーバーの不具合です' }));
  }
};
