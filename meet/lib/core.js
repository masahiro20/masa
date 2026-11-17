'use strict';
// 通話の受付の中身（手元のサーバーと Vercel の両方から使う）
//
// ブラウザは数秒おきに /poll を呼んで、自分あての合図を受け取る。
// 映像・音声そのものはブラウザ同士が WebRTC で直接やりとりするので、ここは通らない。

const crypto = require('node:crypto');

const ROOM_ID_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const ALPHA = 'abcdefghijkmnpqrstuvwxyz';
const STALE_MS = 30000; // これだけ取りに来なければ「抜けた」とみなす

function parseIceServers(raw) {
  if (raw) {
    try { const v = JSON.parse(raw); if (Array.isArray(v)) return v; } catch (_) { /* 既定へ */ }
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}

function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }

function createCore({ store, env = process.env }) {
  const API_KEY = env.MEET_API_KEY || '';
  const PUBLIC_CREATE = env.PUBLIC_CREATE !== '0';
  const MAX_PEERS = Number(env.MAX_PEERS || 6);
  const TTL = Number(env.ROOM_TTL_DAYS || 30) * 86400;
  const ICE = parseIceServers(env.ICE_SERVERS);
  const PUBLIC_URL = (env.PUBLIC_URL || '').replace(/\/$/, '');

  const ok = (body, status = 200) => ({ status, body });
  const err = (status, error) => ({ status, body: { error } });

  function newId() {
    const pick = (n) => Array.from(crypto.randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join('');
    return `${pick(3)}-${pick(4)}-${pick(3)}`;
  }

  function authorized(headers) {
    if (!API_KEY) return true;
    const h = headers.authorization || '';
    const given = h.startsWith('Bearer ') ? h.slice(7) : (headers['x-api-key'] || '');
    const a = Buffer.from(String(given));
    const b = Buffer.from(API_KEY);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function info(origin, room, peers) {
    return {
      id: room.id,
      url: `${PUBLIC_URL || origin}/r/${room.id}`,
      title: room.title, start: room.start, end: room.end, eventRef: room.eventRef,
      lobby: room.lobby,
      expiresAt: new Date(room.expiresAt).toISOString(),
      participants: peers ? Object.values(peers).filter((p) => p.state === 'joined').length : 0,
    };
  }

  // 30 秒以上来ていない人を片付けて、残りの人に知らせる
  async function sweep(roomId, peers, now) {
    const gone = Object.values(peers).filter((p) => p.lastSeen && now - p.lastSeen > STALE_MS);
    for (const p of gone) {
      delete peers[p.id];
      await store.delPeer(roomId, p.id);
      const others = Object.values(peers).filter((x) => x.state === 'joined').map((x) => x.id);
      await store.push(roomId, others, p.state === 'joined' ? { type: 'peer-left', data: { id: p.id, reason: 'disconnected' } } : { type: 'knock-cancel', data: { id: p.id } });
    }
    return peers;
  }

  const joinedIds = (peers, except) => Object.values(peers).filter((p) => p.state === 'joined' && p.id !== except).map((p) => p.id);

  async function admit(room, peers, peer) {
    peer.state = 'joined';
    await store.putPeer(room.id, peer, TTL);
    peers[peer.id] = peer;
    const others = Object.values(peers).filter((p) => p.state === 'joined' && p.id !== peer.id).map((p) => ({ id: p.id, name: p.name }));
    await store.push(room.id, [peer.id], { type: 'admitted', data: { peers: others, room: { title: room.title, start: room.start, end: room.end } } });
    await store.push(room.id, others.map((o) => o.id), { type: 'peer-joined', data: { id: peer.id, name: peer.name } });
  }

  async function handle({ method, path, query = {}, headers = {}, body = {}, origin = '' }) {
    const parts = path.split('/').filter(Boolean); // ['api', ...]
    if (parts[0] !== 'api') return err(404, 'not found');

    if (method === 'GET' && parts[1] === 'config') return ok({ iceServers: ICE, maxPeers: MAX_PEERS });
    if (method === 'GET' && parts[1] === 'healthz') return ok({ ok: true, store: store.kind });

    if (parts[1] !== 'rooms') return err(404, 'not found');

    if (method === 'POST' && parts.length === 2) {
      if (!PUBLIC_CREATE && !authorized(headers)) return err(401, 'API キーが違います');
      const now = Date.now();
      const room = {
        id: newId(),
        title: str(body.title, 80), start: str(body.start, 40), end: str(body.end, 40),
        eventRef: str(body.eventRef, 120), lobby: body.lobby !== false,
        createdAt: now, expiresAt: now + TTL * 1000,
      };
      await store.setRoom(room, TTL);
      return ok(info(origin, room, null), 201);
    }

    const roomId = parts[2];
    if (!ROOM_ID_RE.test(roomId || '')) return err(404, 'この通話は見つかりません');
    const room = await store.getRoom(roomId);
    if (!room) return err(404, 'この通話は見つかりません（期限切れか、リンクの打ち間違いです）');

    if (method === 'GET' && parts.length === 3) {
      const peers = await sweep(roomId, await store.getPeers(roomId), Date.now());
      return ok(info(origin, room, peers));
    }

    if (method === 'DELETE' && parts.length === 3) {
      if (!authorized(headers)) return err(401, 'API キーが違います');
      const peers = await store.getPeers(roomId);
      await store.push(roomId, Object.keys(peers), { type: 'closed', data: {} });
      await store.delRoom(roomId);
      return ok({ ok: true });
    }

    const action = parts[3];
    const now = Date.now();

    if (method === 'POST' && action === 'join') {
      const peers = await sweep(roomId, await store.getPeers(roomId), now);
      if (joinedIds(peers).length >= MAX_PEERS) return err(409, `この通話は満員です（${MAX_PEERS}人まで）`);
      const peer = {
        id: crypto.randomUUID(),
        secret: crypto.randomBytes(16).toString('hex'),
        name: str(body.name, 40) || 'ゲスト',
        state: 'waiting',
        lastSeen: now,
      };
      // 待機室：誰かが中にいれば、その人の許可を待つ。誰もいなければ最初の人はそのまま入る。
      const knock = room.lobby && joinedIds(peers).length > 0;
      if (knock) {
        await store.putPeer(roomId, peer, TTL);
        await store.push(roomId, [peer.id], { type: 'waiting', data: {} });
        await store.push(roomId, joinedIds(peers), { type: 'knock', data: { id: peer.id, name: peer.name } });
      } else {
        await admit(room, peers, peer);
        await store.touch(roomId, peer.id, now, TTL);
      }
      return ok({ peerId: peer.id, secret: peer.secret, waiting: knock });
    }

    // ここから先は参加者本人だけ
    const peerId = method === 'GET' ? query.peerId : body.peerId;
    const secret = method === 'GET' ? query.secret : body.secret;
    let peers = await store.getPeers(roomId);
    const me = peers[peerId];
    if (!me || me.secret !== secret) return err(403, '参加の手続きがされていません');

    if (method === 'GET' && action === 'poll') {
      await store.touch(roomId, me.id, now, TTL);
      me.lastSeen = now;
      peers = await sweep(roomId, peers, now);
      const events = await store.drain(roomId, me.id);
      return ok({
        events,
        state: me.state,
        roster: Object.values(peers).filter((p) => p.state === 'joined').map((p) => ({ id: p.id, name: p.name })),
      });
    }

    if (method !== 'POST') return err(404, 'not found');

    if (action === 'leave') {
      await store.delPeer(roomId, me.id);
      delete peers[me.id];
      await store.push(roomId, joinedIds(peers), me.state === 'joined' ? { type: 'peer-left', data: { id: me.id, reason: 'left' } } : { type: 'knock-cancel', data: { id: me.id } });
      return ok({ ok: true });
    }
    if (me.state !== 'joined') return err(403, 'まだ入室が許可されていません');

    if (action === 'signal') {
      const to = peers[body.to];
      if (!to || to.state !== 'joined') return err(404, '相手がいません');
      await store.push(roomId, [to.id], { type: 'signal', data: { from: me.id, name: me.name, data: body.data } });
      return ok({ ok: true });
    }
    if (action === 'admit' || action === 'deny') {
      const w = peers[body.target];
      if (!w || w.state !== 'waiting') return err(404, 'もう待っていません');
      if (action === 'admit') {
        if (joinedIds(peers).length >= MAX_PEERS) return err(409, '満員です');
        await admit(room, peers, w);
      } else {
        // 「断られた」状態で残しておき、本人が次に取りに来たときに知らせる（30 秒で片付く）
        w.state = 'denied';
        await store.putPeer(roomId, w, TTL);
        await store.push(roomId, [w.id], { type: 'denied', data: {} });
      }
      await store.push(roomId, joinedIds(peers, w.id), { type: 'knock-cancel', data: { id: w.id } });
      return ok({ ok: true });
    }
    if (action === 'chat') {
      const text = str(body.text, 1000);
      if (!text) return err(400, '空です');
      await store.push(roomId, joinedIds(peers), { type: 'chat', data: { from: me.id, name: me.name, text, at: now } });
      return ok({ ok: true });
    }
    if (action === 'state') {
      await store.push(roomId, joinedIds(peers, me.id), { type: 'peer-state', data: { id: me.id, mic: !!body.mic, cam: !!body.cam, screen: !!body.screen } });
      return ok({ ok: true });
    }
    return err(404, 'not found');
  }

  return { handle };
}

module.exports = { createCore, ROOM_ID_RE };
