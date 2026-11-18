// Vercel で動かすときの入り口。/api/* はすべてここに来る（vercel.json の rewrites）。
'use strict';
const { createApi } = require('../lib/api');
const { storeFromEnv } = require('../lib/store');

const store = storeFromEnv();
const api = createApi({ store, env: process.env });

function send(res, status, body, extra = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // rewrites で元のパスを p に入れて渡している
  const sub = url.searchParams.get('p');
  url.searchParams.delete('p');
  const path = sub != null ? `/api/${sub}` : url.pathname;

  // Vercel 上では、伝言板（Upstash）が無いと複数のサーバー間で状態を共有できない
  if (process.env.VERCEL && store.kind !== 'upstash' && path !== '/api/healthz') {
    return send(res, 503, { error: '準備中です（データの置き場所がつながっていません）' });
  }
  if ((req.method === 'POST' || req.method === 'PUT') && !String(req.headers['content-type'] || '').startsWith('application/json')) {
    return send(res, 415, { error: 'JSON で送ってください' });
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { return send(res, 400, { error: '送られた内容を読めません' }); } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  // Vercel が付ける本当の接続元（利用者が書き換えられる x-forwarded-for の先頭は使わない）
  const ip = req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  try {
    const r = await api.handle({
      method: req.method, path, query: Object.fromEntries(url.searchParams), headers: req.headers, body,
      origin: `${proto}://${host}`, ip: String(ip).split(',')[0].trim(),
    });
    send(res, r.status, r.body, r.headers || {});
  } catch (e) {
    console.error('サーバーの不具合', e && e.message);
    send(res, 500, { error: 'サーバーの不具合です' });
  }
};
