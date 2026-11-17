'use strict';
// 通話の状態の置き場所。
//   ・手元で動かすとき／テスト … メモリ（createMemoryStore）
//   ・Vercel で動かすとき       … Upstash Redis（createUpstashStore）
// どちらも同じ形の関数を持つ。
//
// 置くもの（Redis のキー）
//   room:<id>          ルームの題名・日時など（JSON、期限つき）
//   peers:<id>         参加者 peerId → {name, secret, state}（ハッシュ）
//   seen:<id>          参加者 peerId → 最後に取りに来た時刻（ハッシュ。状態と分けて上書き事故を防ぐ）
//   inbox:<id>:<peer>  その人あての合図・チャット（リスト）

const INBOX_TTL = 6 * 3600;

function createMemoryStore() {
  const kv = new Map();      // key -> {value, exp}
  const now = () => Date.now();
  const live = (k) => {
    const e = kv.get(k);
    if (!e) return undefined;
    if (e.exp && e.exp < now()) { kv.delete(k); return undefined; }
    return e;
  };
  const hash = (k) => {
    let e = live(k);
    if (!e) { e = { value: new Map(), exp: 0 }; kv.set(k, e); }
    return e;
  };
  return {
    kind: 'memory',
    async getRoom(id) { const e = live(`room:${id}`); return e ? JSON.parse(e.value) : null; },
    async setRoom(room, ttlSec) { kv.set(`room:${room.id}`, { value: JSON.stringify(room), exp: now() + ttlSec * 1000 }); },
    async delRoom(id) { for (const k of [...kv.keys()]) if (k === `room:${id}` || k === `peers:${id}` || k === `seen:${id}` || k.startsWith(`inbox:${id}:`)) kv.delete(k); },
    async getPeers(id) {
      const p = live(`peers:${id}`);
      const s = live(`seen:${id}`);
      const out = {};
      if (p) for (const [pid, v] of p.value) out[pid] = { ...JSON.parse(v), lastSeen: Number(s && s.value.get(pid)) || 0 };
      return out;
    },
    async putPeer(id, peer, ttlSec) {
      const { lastSeen, ...rest } = peer;
      const p = hash(`peers:${id}`); p.value.set(peer.id, JSON.stringify(rest)); p.exp = now() + ttlSec * 1000;
      if (lastSeen) await this.touch(id, peer.id, lastSeen, ttlSec);
    },
    async delPeer(id, peerId) {
      const p = live(`peers:${id}`); if (p) p.value.delete(peerId);
      const s = live(`seen:${id}`); if (s) s.value.delete(peerId);
      kv.delete(`inbox:${id}:${peerId}`);
    },
    async touch(id, peerId, ts, ttlSec) { const s = hash(`seen:${id}`); s.value.set(peerId, String(ts)); s.exp = now() + ttlSec * 1000; },
    async push(id, peerIds, event) {
      const msg = JSON.stringify(event);
      for (const pid of peerIds) {
        const k = `inbox:${id}:${pid}`;
        let e = live(k);
        if (!e) { e = { value: [], exp: 0 }; kv.set(k, e); }
        e.value.push(msg); e.exp = now() + INBOX_TTL * 1000;
      }
    },
    async drain(id, peerId) {
      const k = `inbox:${id}:${peerId}`;
      const e = live(k);
      kv.delete(k);
      return e ? e.value.map((m) => JSON.parse(m)) : [];
    },
  };
}

function createUpstashStore({ url, token, fetchImpl = fetch }) {
  const base = url.replace(/\/$/, '');
  async function send(path, commands) {
    const r = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    });
    if (!r.ok) throw new Error(`Upstash ${r.status}: ${await r.text()}`);
    const out = await r.json();
    // multi-exec は {result: [...]}、pipeline は [...] で返る
    const list = Array.isArray(out) ? out : out.result;
    for (const x of list) if (x && x.error) throw new Error(`Upstash: ${x.error}`);
    return list.map((x) => x.result);
  }
  const pipeline = (cmds) => send('/pipeline', cmds);
  const multi = (cmds) => send('/multi-exec', cmds);
  const pairs = (arr) => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };

  return {
    kind: 'upstash',
    async getRoom(id) { const [v] = await pipeline([['GET', `room:${id}`]]); return v ? JSON.parse(v) : null; },
    async setRoom(room, ttlSec) { await pipeline([['SET', `room:${room.id}`, JSON.stringify(room), 'EX', String(ttlSec)]]); },
    async delRoom(id) { await pipeline([['DEL', `room:${id}`, `peers:${id}`, `seen:${id}`]]); },
    async getPeers(id) {
      const [p, s] = await pipeline([['HGETALL', `peers:${id}`], ['HGETALL', `seen:${id}`]]);
      const peers = pairs(p);
      const seen = pairs(s);
      const out = {};
      for (const [pid, v] of Object.entries(peers)) out[pid] = { ...JSON.parse(v), lastSeen: Number(seen[pid]) || 0 };
      return out;
    },
    async putPeer(id, peer, ttlSec) {
      const { lastSeen, ...rest } = peer;
      const cmds = [['HSET', `peers:${id}`, peer.id, JSON.stringify(rest)], ['EXPIRE', `peers:${id}`, String(ttlSec)]];
      if (lastSeen) cmds.push(['HSET', `seen:${id}`, peer.id, String(lastSeen)], ['EXPIRE', `seen:${id}`, String(ttlSec)]);
      await pipeline(cmds);
    },
    async delPeer(id, peerId) {
      await pipeline([['HDEL', `peers:${id}`, peerId], ['HDEL', `seen:${id}`, peerId], ['DEL', `inbox:${id}:${peerId}`]]);
    },
    async touch(id, peerId, ts, ttlSec) {
      await pipeline([['HSET', `seen:${id}`, peerId, String(ts)], ['EXPIRE', `seen:${id}`, String(ttlSec)]]);
    },
    async push(id, peerIds, event) {
      if (!peerIds.length) return;
      const msg = JSON.stringify(event);
      const cmds = [];
      for (const pid of peerIds) cmds.push(['RPUSH', `inbox:${id}:${pid}`, msg], ['EXPIRE', `inbox:${id}:${pid}`, String(INBOX_TTL)]);
      await pipeline(cmds);
    },
    async drain(id, peerId) {
      // 読むと消すを同時に（間に届いた合図を取りこぼさない）
      const [list] = await multi([['LRANGE', `inbox:${id}:${peerId}`, '0', '-1'], ['DEL', `inbox:${id}:${peerId}`]]);
      return (list || []).map((m) => JSON.parse(m));
    },
  };
}

function storeFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return createUpstashStore({ url, token });
  return createMemoryStore();
}

module.exports = { createMemoryStore, createUpstashStore, storeFromEnv };
