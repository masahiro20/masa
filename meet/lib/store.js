'use strict';
// 置き場所（Redis の命令をそのまま使う）
//   ・手元／試験 … メモリ上の小さな Redis もどき（createMemoryStore）
//   ・Vercel    … Upstash Redis の REST API（createUpstashStore）
// どちらも pipeline(cmds) と multi(cmds)（まとめて・途中に割り込まれずに実行）を持つ。
// 使う命令: GET SET(EX/NX) DEL INCR EXPIRE HGET HSET HDEL HGETALL HLEN RPUSH LRANGE LLEN LTRIM

function createMemoryStore() {
  const data = new Map(); // key -> { v, exp }
  const now = () => Date.now();
  const live = (k) => {
    const e = data.get(k);
    if (!e) return undefined;
    if (e.exp && e.exp <= now()) { data.delete(k); return undefined; }
    return e;
  };
  const ensure = (k, make) => { let e = live(k); if (!e) { e = { v: make(), exp: 0 }; data.set(k, e); } return e; };

  function run([cmd, ...a]) {
    switch (String(cmd).toUpperCase()) {
      case 'GET': { const e = live(a[0]); return e ? e.v : null; }
      case 'SET': {
        const [k, v, ...opt] = a;
        const up = opt.map((x) => String(x).toUpperCase());
        if (up.includes('NX') && live(k)) return null;
        const exI = up.indexOf('EX');
        data.set(k, { v: String(v), exp: exI >= 0 ? now() + Number(opt[exI + 1]) * 1000 : 0 });
        return 'OK';
      }
      case 'EXISTS': { let n = 0; for (const k of a) if (live(k)) n++; return n; }
      case 'DEL': { let n = 0; for (const k of a) if (live(k)) { data.delete(k); n++; } return n; }
      case 'INCR': { const e = ensure(a[0], () => '0'); e.v = String(Number(e.v) + 1); return Number(e.v); }
      case 'EXPIRE': { const e = live(a[0]); if (!e) return 0; e.exp = now() + Number(a[1]) * 1000; return 1; }
      case 'HGET': { const e = live(a[0]); return e && e.v.has(a[1]) ? e.v.get(a[1]) : null; }
      case 'HSET': { const e = ensure(a[0], () => new Map()); for (let i = 1; i < a.length; i += 2) e.v.set(a[i], String(a[i + 1])); return 1; }
      case 'HDEL': { const e = live(a[0]); if (!e) return 0; let n = 0; for (const f of a.slice(1)) if (e.v.delete(f)) n++; return n; }
      case 'HGETALL': { const e = live(a[0]); if (!e) return []; return [...e.v].flat(); }
      case 'HLEN': { const e = live(a[0]); return e ? e.v.size : 0; }
      case 'RPUSH': { const e = ensure(a[0], () => []); e.v.push(...a.slice(1).map(String)); return e.v.length; }
      case 'LRANGE': {
        const e = live(a[0]); if (!e) return [];
        const len = e.v.length; let s = Number(a[1]); let t = Number(a[2]);
        if (s < 0) s = Math.max(0, len + s); if (t < 0) t = len + t;
        return e.v.slice(s, t + 1);
      }
      case 'LLEN': { const e = live(a[0]); return e ? e.v.length : 0; }
      case 'LTRIM': {
        const e = live(a[0]); if (!e) return 'OK';
        const len = e.v.length; let s = Number(a[1]); let t = Number(a[2]);
        if (s < 0) s = Math.max(0, len + s); if (t < 0) t = len + t;
        e.v = e.v.slice(s, t + 1); return 'OK';
      }
      default: throw new Error(`memory store: ${cmd} は未対応`);
    }
  }
  const exec = async (cmds) => cmds.map(run);
  return { kind: 'memory', pipeline: exec, multi: exec, _data: data };
}

function createUpstashStore({ url, token, fetchImpl = fetch }) {
  const base = url.replace(/\/$/, '');
  async function send(path, cmds) {
    const r = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds.map((c) => c.map(String))),
    });
    if (!r.ok) throw new Error(`Upstash の応答が異常です（${r.status}）`); // 本文はログに出さない（中身を含みうるため）
    const out = await r.json();
    const list = Array.isArray(out) ? out : out.result;
    for (const x of list) if (x && x.error) throw new Error('Upstash の命令が失敗しました');
    return list.map((x) => x.result);
  }
  return {
    kind: 'upstash',
    pipeline: (cmds) => (cmds.length ? send('/pipeline', cmds) : Promise.resolve([])),
    multi: (cmds) => (cmds.length ? send('/multi-exec', cmds) : Promise.resolve([])),
  };
}

function storeFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return createUpstashStore({ url, token });
  return createMemoryStore();
}

// よく使う形をまとめた小物
function helpers(store) {
  const one = async (cmd) => (await store.pipeline([cmd]))[0];
  const pairs = (arr) => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
  return {
    one,
    pairs,
    get: (k) => one(['GET', k]),
    setEx: (k, v, sec) => one(['SET', k, v, 'EX', sec]),
    del: (...ks) => one(['DEL', ...ks]),
    hgetall: async (k) => pairs(await one(['HGETALL', k])),
    // 読むと同時に消す（間に届いたものを取りこぼさない）
    drain: async (k) => (await store.multi([['LRANGE', k, 0, -1], ['DEL', k]]))[0] || [],
  };
}

module.exports = { createMemoryStore, createUpstashStore, storeFromEnv, helpers };
