// COMPASS 通話 — シグナリングサーバー（依存パッケージなし・Node.js 標準のみ）
//
// 映像・音声はブラウザ同士が WebRTC で直接やりとりする。サーバーは
//   ・通話ルームの発行（予定に貼るリンクを作る API）
//   ・参加の受付（待機室 → 入室の許可）
//   ・WebRTC の接続情報（offer / answer / ICE）の中継
// だけを受け持つ。サーバー → ブラウザは SSE、ブラウザ → サーバーは POST。

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const API_KEY = process.env.MEET_API_KEY || '';
const MAX_PEERS = Number(process.env.MAX_PEERS || 6);
const ROOM_TTL_DAYS = Number(process.env.ROOM_TTL_DAYS || 30);
const ICE_SERVERS = parseIceServers(process.env.ICE_SERVERS);
const PUBLIC_CREATE = process.env.PUBLIC_CREATE !== '0';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'rooms.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function parseIceServers(raw) {
  if (!raw) return [{ urls: 'stun:stun.l.google.com:19302' }];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v;
  } catch (_) { /* fall through */ }
  console.warn('ICE_SERVERS を読めなかったので既定の STUN を使います');
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}

// ---------- ルーム ----------

/** @type {Map<string, Room>} */
const rooms = new Map();

/**
 * @typedef {{ id: string, name: string, stream: http.ServerResponse|null,
 *   state: 'waiting'|'joined', joinedAt: number, lastSeen: number }} Peer
 * @typedef {{ id: string, title: string, start: string, end: string,
 *   eventRef: string, hostName: string, lobby: boolean, createdAt: number,
 *   expiresAt: number, peers: Map<string, Peer> }} Room
 */

// Meet と同じ「abc-defg-hij」形。紛らわしい文字（l, o, 0, 1）は入れない。
const ALPHA = 'abcdefghijkmnpqrstuvwxyz';
function newRoomId() {
  const pick = (n) => Array.from(crypto.randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join('');
  let id;
  do { id = `${pick(3)}-${pick(4)}-${pick(3)}`; } while (rooms.has(id));
  return id;
}

const ROOM_ID_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

function createRoom(opts = {}) {
  const now = Date.now();
  const room = {
    id: newRoomId(),
    title: str(opts.title, 80),
    start: str(opts.start, 40),
    end: str(opts.end, 40),
    eventRef: str(opts.eventRef, 120),
    hostName: str(opts.hostName, 40),
    lobby: opts.lobby !== false,
    createdAt: now,
    expiresAt: now + ROOM_TTL_DAYS * 86400e3,
    peers: new Map(),
  };
  rooms.set(room.id, room);
  saveRooms();
  return room;
}

// ルームの中身（題名・日時・期限）だけをファイルに残す。再起動しても予定に貼ったリンクが切れない。
let saveTimer = null;
function saveRooms() {
  if (!DATA_FILE || DATA_FILE === 'none') return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const list = [...rooms.values()].map(({ peers, ...meta }) => meta);
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list));
    fs.renameSync(tmp, DATA_FILE);
  }, 200);
}

function loadRooms() {
  if (!DATA_FILE || DATA_FILE === 'none') return;
  let list;
  try { list = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) { return; }
  const now = Date.now();
  for (const meta of list) {
    if (meta && ROOM_ID_RE.test(meta.id) && meta.expiresAt > now) rooms.set(meta.id, { ...meta, peers: new Map() });
  }
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function roomUrl(req, id) {
  const base = PUBLIC_URL || `http://${req.headers.host}`;
  return `${base}/r/${id}`;
}

function roomInfo(req, room) {
  return {
    id: room.id,
    url: roomUrl(req, room.id),
    title: room.title,
    start: room.start,
    end: room.end,
    eventRef: room.eventRef,
    lobby: room.lobby,
    expiresAt: new Date(room.expiresAt).toISOString(),
    participants: [...room.peers.values()].filter((p) => p.state === 'joined').length,
  };
}

function joined(room) {
  return [...room.peers.values()].filter((p) => p.state === 'joined');
}

// ---------- SSE ----------

function send(peer, type, data) {
  if (!peer.stream) return;
  peer.stream.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(room, type, data, exceptId) {
  for (const p of joined(room)) if (p.id !== exceptId) send(p, type, data);
}

function admit(room, peer) {
  peer.state = 'joined';
  peer.joinedAt = Date.now();
  // 新しく入った人には今いる人の一覧を渡し、接続は新しい人から張る。
  const others = joined(room).filter((p) => p.id !== peer.id).map((p) => ({ id: p.id, name: p.name }));
  send(peer, 'admitted', { peers: others, room: { title: room.title, start: room.start, end: room.end } });
  broadcast(room, 'peer-joined', { id: peer.id, name: peer.name }, peer.id);
}

function removePeer(room, peerId, reason) {
  const peer = room.peers.get(peerId);
  if (!peer) return;
  room.peers.delete(peerId);
  if (peer.stream) { try { peer.stream.end(); } catch (_) {} }
  if (peer.state === 'joined') broadcast(room, 'peer-left', { id: peerId, reason });
  else broadcast(room, 'knock-cancel', { id: peerId });
}

// ---------- HTTP ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, file) {
  const p = path.join(PUBLIC_DIR, file);
  if (!p.startsWith(PUBLIC_DIR)) { res.writeHead(404); return res.end(); }
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(p)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

function apiAuthorized(req) {
  if (!API_KEY) return true;
  const h = req.headers.authorization || '';
  const given = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-api-key'] || '');
  const a = Buffer.from(String(given));
  const b = Buffer.from(API_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getPeer(room, body) {
  const peer = room.peers.get(body.peerId);
  if (!peer || peer.secret !== body.secret) return null;
  peer.lastSeen = Date.now();
  return peer;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);

  // --- 画面 ---
  if (req.method === 'GET' && url.pathname === '/') return serveFile(res, 'index.html');
  if (req.method === 'GET' && parts[0] === 'r' && parts.length === 2) {
    if (!ROOM_ID_RE.test(parts[1])) { res.writeHead(404); return res.end('not found'); }
    return serveFile(res, 'room.html');
  }
  if (req.method === 'GET' && parts[0] === 'static' && parts.length === 2) return serveFile(res, parts[1]);
  if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true, rooms: rooms.size });

  if (parts[0] !== 'api') { res.writeHead(404); return res.end('not found'); }

  // --- 設定（ブラウザが使う ICE サーバー） ---
  if (req.method === 'GET' && parts[1] === 'config') {
    return json(res, 200, { iceServers: ICE_SERVERS, maxPeers: MAX_PEERS });
  }

  // --- ルームの発行（予定に貼るリンクを作る） ---
  if (req.method === 'POST' && parts[1] === 'rooms' && parts.length === 2) {
    // PUBLIC_CREATE=0 にすると、発行は API キーを持つ仕組み（COMPASS 側）からだけになる。
    if (!PUBLIC_CREATE && !apiAuthorized(req)) return json(res, 401, { error: 'API キーが違います' });
    let body;
    try { body = await readBody(req); } catch (_) { return json(res, 400, { error: '送られた内容を読めません' }); }
    const room = createRoom(body);
    return json(res, 201, roomInfo(req, room));
  }

  if (parts[1] !== 'rooms' || !parts[2]) return json(res, 404, { error: 'not found' });
  const room = rooms.get(parts[2]);
  if (!room) return json(res, 404, { error: 'この通話は見つかりません（期限切れか、リンクの打ち間違いです）' });

  if (req.method === 'GET' && parts.length === 3) return json(res, 200, roomInfo(req, room));

  if (req.method === 'DELETE' && parts.length === 3) {
    if (!apiAuthorized(req)) return json(res, 401, { error: 'API キーが違います' });
    for (const id of [...room.peers.keys()]) removePeer(room, id, 'closed');
    rooms.delete(room.id);
    saveRooms();
    return json(res, 200, { ok: true });
  }

  // --- 入室の申し込み ---
  if (req.method === 'POST' && parts[3] === 'join') {
    let body;
    try { body = await readBody(req); } catch (_) { return json(res, 400, { error: '送られた内容を読めません' }); }
    const name = str(body.name, 40) || 'ゲスト';
    if (joined(room).length >= MAX_PEERS) return json(res, 409, { error: `この通話は満員です（${MAX_PEERS}人まで）` });
    const peer = {
      id: crypto.randomUUID(),
      secret: crypto.randomBytes(16).toString('hex'),
      name,
      stream: null,
      state: 'waiting',
      joinedAt: 0,
      lastSeen: Date.now(),
    };
    room.peers.set(peer.id, peer);
    // 待機室：誰かが中にいれば、その人の許可を待つ。誰もいなければ最初の人はそのまま入る。
    const needsKnock = room.lobby && joined(room).length > 0;
    return json(res, 200, { peerId: peer.id, secret: peer.secret, waiting: needsKnock });
  }

  // --- イベントの受信（SSE） ---
  if (req.method === 'GET' && parts[3] === 'events') {
    const peer = getPeer(room, { peerId: url.searchParams.get('peerId'), secret: url.searchParams.get('secret') });
    if (!peer) return json(res, 403, { error: '参加の手続きがされていません' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': hello\n\n');
    if (peer.stream) { try { peer.stream.end(); } catch (_) {} }
    peer.stream = res;
    req.on('close', () => {
      if (peer.stream === res) peer.stream = null;
      // 回線の瞬断は 15 秒まで待つ（再接続で戻ってくる）。
      setTimeout(() => {
        if (room.peers.get(peer.id) === peer && !peer.stream) removePeer(room, peer.id, 'disconnected');
      }, 15000).unref();
    });

    if (peer.state === 'joined') {
      // 再接続：すでに入室済み
      send(peer, 'resumed', {});
    } else if (room.lobby && joined(room).length > 0) {
      send(peer, 'waiting', {});
      broadcast(room, 'knock', { id: peer.id, name: peer.name });
    } else {
      admit(room, peer);
    }
    return;
  }

  // --- ブラウザ → サーバー ---
  if (req.method === 'POST' && parts.length === 4) {
    let body;
    try { body = await readBody(req, 256 * 1024); } catch (_) { return json(res, 400, { error: '送られた内容を読めません' }); }
    const peer = getPeer(room, body);
    if (!peer) return json(res, 403, { error: '参加の手続きがされていません' });
    const action = parts[3];

    if (action === 'leave') {
      removePeer(room, peer.id, 'left');
      return json(res, 200, { ok: true });
    }
    if (peer.state !== 'joined') return json(res, 403, { error: 'まだ入室が許可されていません' });

    if (action === 'signal') {
      const to = room.peers.get(body.to);
      if (!to || to.state !== 'joined') return json(res, 404, { error: '相手がいません' });
      send(to, 'signal', { from: peer.id, name: peer.name, data: body.data });
      return json(res, 200, { ok: true });
    }
    if (action === 'admit' || action === 'deny') {
      const w = room.peers.get(body.target);
      if (!w || w.state !== 'waiting') return json(res, 404, { error: 'もう待っていません' });
      if (action === 'admit') {
        if (joined(room).length >= MAX_PEERS) return json(res, 409, { error: '満員です' });
        admit(room, w);
      } else {
        send(w, 'denied', {});
        removePeer(room, w.id, 'denied');
      }
      broadcast(room, 'knock-cancel', { id: w.id }, w.id);
      return json(res, 200, { ok: true });
    }
    if (action === 'chat') {
      const text = str(body.text, 1000);
      if (!text) return json(res, 400, { error: '空です' });
      broadcast(room, 'chat', { from: peer.id, name: peer.name, text, at: Date.now() });
      return json(res, 200, { ok: true });
    }
    if (action === 'state') {
      // マイク・カメラの入切、画面共有中かどうか
      broadcast(room, 'peer-state', {
        id: peer.id,
        mic: !!body.mic, cam: !!body.cam, screen: !!body.screen,
      }, peer.id);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  return json(res, 404, { error: 'not found' });
}

// ---------- 後片付け ----------

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const p of room.peers.values()) {
      if (p.stream) p.stream.write(': ping\n\n');
    }
    if (room.expiresAt < now && room.peers.size === 0) { rooms.delete(room.id); saveRooms(); }
  }
}, 20000).unref();

function start(port = PORT) {
  loadRooms();
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'サーバーの不具合です' });
      else res.end();
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (require.main === module) {
  start().then((s) => {
    console.log(`COMPASS 通話: http://localhost:${s.address().port}`);
    if (!API_KEY) console.log('※ MEET_API_KEY が未設定です。本番では必ず設定してください。');
  });
}

module.exports = { start, rooms, createRoom, ROOM_ID_RE };
