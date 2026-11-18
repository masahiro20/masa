'use strict';
// COMPASS Meet の API（手元のサーバーと Vercel の両方から使う）
//
// 役割
//   主催者（host） … スタッフとして本人確認できた人（ルームの持ち主・管理者）、または主催者用リンクの持ち主
//   参加者（guest）… お客様。アカウント不要。主催者が許可して初めて通話に入れる
//
// 映像・音声・書き込みはブラウザ同士が WebRTC で直接やりとりし、ここは通らない。
// ここが受け持つのは、受付（認証・許可）、合図の中継、会議記録の保存。

const crypto = require('node:crypto');
const sec = require('./secure');
const { helpers } = require('./store');
const { createLimiter } = require('./ratelimit');
const { createAuth } = require('./auth');
const { createTurn } = require('./turn');
const { createAi } = require('./ai');

const ROOM_ID_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const ALPHA = 'abcdefghijkmnpqrstuvwxyz';
const ID_RE = /^[\w:.@-]{1,64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const STALE_MS = 45000;      // これだけ取りに来なければ抜けたとみなす
const TOMBSTONE_MS = 30000;  // 断られた・外された人の記録を残す時間（本人に知らせるため）
const MIN_POLL_MS = 350;     // これより短い間隔の取りに来は断る
const MAX_WAITING = 8;
const REACTIONS = ['like', 'clap', 'ok', 'question'];
const DEFAULT_PERMS = { guestScreen: false, guestAnnotate: true, guestBoard: true, chat: true };

// 制御文字・前後の空白を落とし、長さをそろえる
function clean(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, max);
}
function cleanText(v, max) { // 改行は残す
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '').slice(0, max);
}
const bool = (v) => v === true;

function createApi({ store, env = process.env, fetchImpl = fetch }) {
  const keys = sec.loadKeys(env);
  const h = helpers(store);
  const limiter = createLimiter(store);
  const auth = createAuth({ store, env, keys, limiter });
  const turn = createTurn(env, fetchImpl);
  const ai = createAi(env, fetchImpl);
  const MAX_PEERS = Math.min(Number(env.MAX_PEERS || 6), 8);
  const RETENTION = Number(env.MEETING_RETENTION_DAYS || 180) * 86400;
  const PUBLIC_URL = (env.PUBLIC_URL || '').replace(/\/$/, '');
  const transcription = env.TRANSCRIBE_PROVIDER === 'webspeech' && env.TRANSCRIBE_EXTERNAL_APPROVED === '1' ? 'webspeech' : 'none';

  const seal = (v, aad) => sec.seal(keys.dataKey, v, aad);
  const unseal = (s, aad) => sec.open(keys.dataKey, s, aad);

  // ---------- 返事の形 ----------
  const ok = (body, status = 200, headers) => ({ status, body, headers });
  const fail = (status, error, headers) => ({ status, body: { error }, headers });
  const tooMany = (r) => fail(429, '操作が多すぎます。少し時間をおいてお試しください。', { 'Retry-After': String(Math.max(1, r.retryAfter || 30)) });

  // ---------- ルーム ----------
  function newRoomId() {
    const pick = (n) => {
      // 剰余の偏りをなくすため、24 の倍数に収まらない値は捨てて引き直す
      let s = '';
      while (s.length < n) for (const b of crypto.randomBytes(n * 2)) { if (b < 240 && s.length < n) s += ALPHA[b % 24]; }
      return s;
    };
    return `${pick(3)}-${pick(4)}-${pick(3)}`;
  }

  async function loadRoom(id) {
    const [raw, ended, locked, peersRaw, seenRaw] = await store.pipeline([
      ['GET', `room:${id}`], ['GET', `ended:${id}`], ['GET', `lock:${id}`], ['HGETALL', `peers:${id}`], ['HGETALL', `seen:${id}`],
    ]);
    if (!raw) return null;
    const room = JSON.parse(raw);
    room.ended = !!ended || room.expiresAt < Date.now();
    room.endedReason = ended ? 'ended' : (room.expiresAt < Date.now() ? 'expired' : null);
    room.locked = !!locked;
    const seen = h.pairs(seenRaw);
    const peers = {};
    for (const [pid, v] of Object.entries(h.pairs(peersRaw))) {
      try { peers[pid] = { ...JSON.parse(v), lastSeen: Number(seen[pid]) || 0 }; } catch (_) { /* 壊れた行は無視 */ }
    }
    return { room, peers };
  }

  const roomTtl = (room) => Math.max(3600, Math.ceil((room.expiresAt - Date.now()) / 1000) + 7 * 86400);
  const saveRoom = (room) => {
    const { ended, endedReason, locked, ...rest } = room;
    return store.pipeline([['SET', `room:${room.id}`, JSON.stringify(rest), 'EX', roomTtl(room)]]);
  };
  const putPeer = (room, p) => {
    const { lastSeen, ...rest } = p;
    return store.pipeline([['HSET', `peers:${room.id}`, p.id, JSON.stringify(rest)], ['EXPIRE', `peers:${room.id}`, roomTtl(room)]]);
  };
  const ids = (peers, pred) => Object.values(peers).filter(pred).map((p) => p.id);
  const joinedIds = (peers, except) => ids(peers, (p) => p.state === 'joined' && p.id !== except);
  const hostIds = (peers) => ids(peers, (p) => p.state === 'joined' && p.role === 'host');

  async function push(roomId, to, type, data = {}) {
    if (!to.length) return;
    const msg = JSON.stringify({ type, data });
    const cmds = [];
    for (const pid of to) cmds.push(['RPUSH', `inbox:${roomId}:${pid}`, msg], ['EXPIRE', `inbox:${roomId}:${pid}`, 6 * 3600]);
    await store.pipeline(cmds);
  }

  function publicPeer(p) { return { id: p.id, name: p.name, role: p.role }; }

  function roomSecret(room) { return unseal(room.sealed, `room:${room.id}`) || {}; }

  function roomForParticipants(room) {
    const s = roomSecret(room);
    return {
      title: s.title || '', start: room.start, end: room.end, ownerName: room.ownerName,
      perms: room.perms, locked: room.locked, saveChat: room.saveChat, recording: recPublic(room), transcription,
    };
  }

  function recPublic(room) {
    const r = room.recording || { state: 'off' };
    return { state: r.state, consented: Object.keys(r.consents || {}).filter((k) => r.consents[k]) };
  }

  // 会議記録（参加者の出入り・保存したチャット・文字起こしは、追記用のリストに分けて競合を避ける）
  async function logEvent(room, entry) {
    await store.pipeline([
      ['RPUSH', `mtg:${room.id}:log`, seal({ ...entry, at: Date.now() }, `log:${room.id}`)],
      ['EXPIRE', `mtg:${room.id}:log`, RETENTION],
    ]);
  }

  // 抜けた人・古い記録の片付け
  async function sweep(room, peers) {
    const now = Date.now();
    for (const p of Object.values(peers)) {
      const stale = (p.state === 'joined' || p.state === 'waiting') && p.lastSeen && now - p.lastSeen > STALE_MS;
      const oldTomb = (p.state === 'denied' || p.state === 'kicked') && now - (p.endedAt || 0) > TOMBSTONE_MS;
      if (!stale && !oldTomb) continue;
      delete peers[p.id];
      await store.pipeline([['HDEL', `peers:${room.id}`, p.id], ['HDEL', `seen:${room.id}`, p.id], ['DEL', `inbox:${room.id}:${p.id}`]]);
      if (stale && p.state === 'joined') {
        await push(room.id, joinedIds(peers), 'peer-left', { id: p.id, reason: 'disconnected' });
        await logEvent(room, { kind: 'left', name: p.name, role: p.role, reason: 'disconnected' });
        await recOnLeave(room, peers, p.id);
      } else if (stale && p.state === 'waiting') {
        await push(room.id, hostIds(peers), 'knock-cancel', { id: p.id });
      }
    }
  }

  async function admit(room, peers, p) {
    p.state = 'joined';
    p.joinedAt = Date.now();
    peers[p.id] = p;
    await putPeer(room, p);
    const others = Object.values(peers).filter((x) => x.state === 'joined' && x.id !== p.id).map(publicPeer);
    const waiting = p.role === 'host' ? Object.values(peers).filter((x) => x.state === 'waiting').map(publicPeer) : [];
    await push(room.id, [p.id], 'admitted', { you: publicPeer(p), peers: others, waiting, room: roomForParticipants(room) });
    await push(room.id, others.map((o) => o.id), 'peer-joined', publicPeer(p));
    await logEvent(room, { kind: 'joined', name: p.name, role: p.role });
    // 記録中に新しい人が入ったら、その人の同意が取れるまで止める
    const r = room.recording;
    if (r && (r.state === 'active' || r.state === 'paused' || r.state === 'requested')) {
      r.consents = r.consents || {};
      if (!r.consents[p.id]) {
        if (r.state === 'active') r.state = 'paused';
        await saveRoom(room);
        await push(room.id, joinedIds(peers), 'rec-state', recPublic(room));
        await push(room.id, [p.id], 'rec-request', { by: room.ownerName });
      }
    }
  }

  async function recOnLeave(room, peers, leftId) {
    const r = room.recording;
    if (!r || r.state === 'off') return;
    if (r.consents) delete r.consents[leftId];
    const everyone = joinedIds(peers);
    if ((r.state === 'paused' || r.state === 'requested') && everyone.length && everyone.every((id) => r.consents[id])) {
      r.state = 'active';
      await saveRoom(room);
      await push(room.id, everyone, 'rec-state', recPublic(room));
    }
  }

  // ---------- 会議記録 ----------
  async function loadMeeting(id) {
    const raw = await h.get(`mtg:${id}`);
    return raw ? unseal(raw, `mtg:${id}`) : null;
  }
  async function saveMeeting(m) {
    await store.pipeline([
      ['SET', `mtg:${m.id}`, seal(m, `mtg:${m.id}`), 'EX', RETENTION],
      ['HSET', `staffidx:${m.ownerId}`, m.id, String(m.createdAt)],
      ['EXPIRE', `staffidx:${m.ownerId}`, RETENTION],
    ]);
  }
  // 閲覧・編集・ダウンロード・削除の権限を分ける
  function can(action, staff, m) {
    if (!staff || !m) return false;
    const owner = staff.id === m.ownerId;
    const admin = staff.role === 'admin';
    switch (action) {
      case 'view': case 'download': return owner || admin;
      case 'edit': case 'confirm': return owner;
      case 'delete': return owner || admin;
      default: return false;
    }
  }

  async function readList(key, aad) {
    const items = await h.one(['LRANGE', key, 0, -1]);
    return (items || []).map((x) => unseal(x, aad)).filter(Boolean);
  }

  async function meetingFull(m) {
    const [log, chat, transcript, delRaw] = await Promise.all([
      readList(`mtg:${m.id}:log`, `log:${m.id}`),
      readList(`mtg:${m.id}:chat`, `chat:${m.id}`),
      readList(`mtg:${m.id}:tr`, `tr:${m.id}`),
      h.hgetall(`mtg:${m.id}:chatdel`),
    ]);
    return { ...m, log, chat: chat.filter((c) => !delRaw[c.id]), transcript };
  }

  // ---------- 入口 ----------
  async function handle(req) {
    const { method } = req;
    const parts = req.path.split('/').filter(Boolean);
    if (parts[0] !== 'api') return fail(404, '見つかりません');
    if (!keys.ready) return fail(503, '準備中です（サーバーの鍵が設定されていません）');

    const p1 = parts[1];
    // 参加者本人の操作（poll など）は参加者ごとの制限で見る。それ以外は回線ごとに極端な連打を止める
    const peerOp = p1 === 'rooms' && parts.length === 4 && parts[3] !== 'join' && parts[3] !== 'detail';
    if (!peerOp) {
      const g = await limiter.hit('api_ip', req.ip || 'unknown');
      if (!g.ok) return tooMany(g);
    }
    if (method === 'GET' && p1 === 'healthz') return ok({ ok: true });
    if (method === 'GET' && p1 === 'config') {
      return ok({ maxPeers: MAX_PEERS, transcription, ai: ai.enabled, staffLogin: auth.configured.password, reactions: REACTIONS });
    }

    if (p1 === 'auth') return handleAuth(req, parts);
    if (p1 === 'meetings') return handleMeetings(req, parts);
    if (p1 !== 'rooms') return fail(404, '見つかりません');

    // ルームの作成・一覧（スタッフだけ）
    if (parts.length === 2) {
      const staff = await auth.staffOf(req);
      if (!staff) return fail(401, 'ログインが必要です');
      if (method !== 'GET' && staff.cookie && !auth.sameOrigin(req)) return fail(403, '不正な送信元です');
      if (method === 'POST') return createRoom(req, staff);
      if (method === 'GET') return listRooms(staff);
      return fail(405, '使えない操作です');
    }

    const roomId = parts[2];
    if (!ROOM_ID_RE.test(roomId)) return fail(404, 'この打ち合わせは見つかりません');
    const ctx = await loadRoom(roomId);
    if (!ctx) return fail(404, 'この打ち合わせは見つかりません');
    const { room, peers } = ctx;
    const action = parts[3] || '';

    // 入室前の画面に出す最低限の情報（件名・お客様名・参加人数は出さない）
    if (method === 'GET' && !action) {
      const r = await limiter.hit('info_ip', req.ip || 'unknown');
      if (!r.ok) return tooMany(r);
      const staff = await auth.staffOf(req);
      return ok({
        status: room.ended ? room.endedReason : 'open',
        start: room.start, end: room.end, ownerName: room.ownerName,
        requiresPin: !!room.pinHash,
        youAreHost: !!(staff && (staff.id === room.ownerId || staff.role === 'admin')),
      });
    }

    // 持ち主（または管理者）によるルームの削除＝終了
    if (method === 'DELETE' && !action) {
      const staff = await auth.staffOf(req);
      if (!staff || (staff.id !== room.ownerId && staff.role !== 'admin')) return fail(403, '権限がありません');
      if (staff.cookie && !auth.sameOrigin(req)) return fail(403, '不正な送信元です');
      await endRoom(room, peers, 'deleted');
      return ok({ ok: true });
    }

    // 持ち主向けの詳細（件名などを復号して返す）
    if (method === 'GET' && action === 'detail') {
      const staff = await auth.staffOf(req);
      if (!staff || (staff.id !== room.ownerId && staff.role !== 'admin')) return fail(403, '権限がありません');
      return ok({ ...roomSecret(room), id: room.id, start: room.start, end: room.end, status: room.ended ? room.endedReason : 'open', locked: room.locked, url: urlFor(req, room.id) });
    }

    if (method === 'POST' && action === 'join') return join(req, room, peers);

    // ---- ここから先は参加者本人だけ ----
    const peerId = method === 'GET' ? req.query.peerId : req.body.peerId;
    const secret = method === 'GET' ? req.headers['x-peer-secret'] : req.body.secret;
    const me = typeof peerId === 'string' ? peers[peerId] : null;
    if (!me || !sec.safeEqual(me.sh, sec.sha256(String(secret || '')))) return fail(403, '参加の手続きがされていません');

    if (method === 'GET' && action === 'poll') return poll(room, peers, me);
    if (method === 'GET' && action === 'ice') {
      if (me.state !== 'joined' || room.ended) return fail(403, '入室が許可されていません');
      try { return ok(await turn.iceServersFor(me.id)); } catch (_) { return ok({ iceServers: turn.STUN, ttl: 0, provider: 'none', degraded: true }); }
    }
    if (method !== 'POST') return fail(405, '使えない操作です');

    if (action === 'leave') {
      delete peers[me.id];
      await store.pipeline([['HDEL', `peers:${room.id}`, me.id], ['HDEL', `seen:${room.id}`, me.id], ['DEL', `inbox:${room.id}:${me.id}`]]);
      if (me.state === 'joined') {
        await push(room.id, joinedIds(peers), 'peer-left', { id: me.id, reason: 'left' });
        await logEvent(room, { kind: 'left', name: me.name, role: me.role, reason: 'left' });
        await recOnLeave(room, peers, me.id);
      } else if (me.state === 'waiting') {
        await push(room.id, hostIds(peers), 'knock-cancel', { id: me.id });
      }
      return ok({ ok: true });
    }

    if (room.ended) return fail(410, 'この打ち合わせは終了しました');
    if (me.state !== 'joined') return fail(403, '入室が許可されていません');

    if (action === 'signal') return signal(room, peers, me, req.body);
    if (['chat', 'chat-delete', 'state', 'react', 'hand', 'rec-consent', 'transcript'].includes(action)) return participantAction(action, room, peers, me, req.body);
    if (['admit', 'deny', 'kick', 'mute', 'perms', 'lock', 'end', 'rec-request', 'rec-stop', 'stop-share'].includes(action)) {
      if (me.role !== 'host') return fail(403, '主催者だけができる操作です');
      const r = await limiter.hit('host_action', me.id);
      if (!r.ok) return tooMany(r);
      return hostAction(action, room, peers, me, req.body);
    }
    return fail(404, '見つかりません');
  }

  function urlFor(req, id) { return `${PUBLIC_URL || req.origin}/r/${id}`; }

  // ---------- 認証 ----------
  async function handleAuth(req, parts) {
    const a = parts[2];
    if (req.method === 'GET' && a === 'me') {
      const staff = await auth.staffOf(req);
      return staff ? ok({ staff: { id: staff.id, name: staff.name, role: staff.role } }) : fail(401, 'ログインしていません');
    }
    if (req.method !== 'POST') return fail(405, '使えない操作です');
    if (!auth.sameOrigin(req)) return fail(403, '不正な送信元です');
    if (a === 'login') {
      const id = clean(req.body.id, 64);
      const r = await auth.login(req, id, typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '');
      if (r.error === 429) return tooMany(r);
      if (r.error) return fail(401, '社員 ID またはパスワードが違います');
      return ok({ staff: r.staff }, 200, { 'Set-Cookie': r.cookie });
    }
    if (a === 'compass') {
      const r = await auth.exchangeCompass(req, clean(req.body.token, 4096));
      if (r.error === 429) return tooMany(r);
      if (r.error) return fail(401, 'COMPASS からの引き継ぎに失敗しました');
      return ok({ staff: r.staff }, 200, { 'Set-Cookie': r.cookie });
    }
    if (a === 'logout') {
      const staff = await auth.staffOf(req);
      return ok({ ok: true }, 200, { 'Set-Cookie': await auth.logout(staff) });
    }
    return fail(404, '見つかりません');
  }

  // ---------- ルームの作成 ----------
  async function createRoom(req, staff) {
    const r1 = await limiter.hit('create_staff', staff.id);
    const r2 = await limiter.hit('create_global', 'all');
    if (!r1.ok || !r2.ok) return tooMany(r1.ok ? r2 : r1);
    const b = req.body || {};
    const title = clean(b.title, 80) || 'オンライン打ち合わせ';
    const customerName = clean(b.customerName, 60);
    for (const k of ['customerId', 'projectId', 'eventRef']) if (b[k] != null && b[k] !== '' && !ID_RE.test(String(b[k]))) return fail(400, `${k} の形式が正しくありません`);
    for (const k of ['start', 'end']) if (b[k] != null && b[k] !== '' && (!ISO_RE.test(String(b[k])) || isNaN(Date.parse(b[k])))) return fail(400, '日時の形式が正しくありません');
    const startMs = b.start ? Date.parse(b.start) : null;
    const endMs = b.end ? Date.parse(b.end) : null;
    if (startMs && endMs && endMs <= startMs) return fail(400, '終了は開始より後にしてください');
    const now = Date.now();
    if (startMs && startMs > now + 180 * 86400e3) return fail(400, '開始日時が先すぎます');
    // リンクの有効期限：終了予定の 3 時間後まで（時刻が無ければ作成から 12 時間）。最長 30 日・最短 1 時間
    const base = endMs || (startMs ? startMs + 2 * 3600e3 : now + 9 * 3600e3);
    const expiresAt = Math.min(Math.max(base + 3 * 3600e3, now + 3600e3), now + 30 * 86400e3 + (startMs ? Math.max(0, startMs - now) : 0));

    const id = newRoomId();
    const hostToken = sec.token(32);
    const pin = b.pin === true ? String(crypto.randomInt(0, 1e6)).padStart(6, '0') : null;
    const room = {
      id, v: 2, ownerId: staff.id, ownerName: staff.name,
      start: startMs ? new Date(startMs).toISOString() : '', end: endMs ? new Date(endMs).toISOString() : '',
      createdAt: now, expiresAt,
      hostTokenHash: sec.sha256(hostToken),
      pinHash: pin ? sec.sha256(`${id}:${pin}`) : null,
      perms: { ...DEFAULT_PERMS }, saveChat: false, recording: { state: 'off', consents: {} },
      sealed: seal({ title, customerName, customerId: b.customerId || '', projectId: b.projectId || '', eventRef: b.eventRef || '' }, `room:${id}`),
    };
    await saveRoom(room);
    await saveMeeting({
      id, ownerId: staff.id, ownerName: staff.name, title, customerName,
      customerId: b.customerId || '', projectId: b.projectId || '', eventRef: b.eventRef || '',
      start: room.start, end: room.end, createdAt: now,
      notes: { body: '', decisions: '', pending: '', todos: '', updatedAt: 0, updatedBy: '' },
      minutes: { status: 'none' }, board: null,
    });
    const url = urlFor(req, id);
    return ok({ id, url, hostUrl: `${url}#host=${hostToken}`, pin, expiresAt: new Date(expiresAt).toISOString(), title }, 201);
  }

  async function listRooms(staff) {
    const idx = await h.hgetall(`staffidx:${staff.id}`);
    const list = Object.entries(idx).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 30);
    const out = [];
    for (const [id] of list) {
      const m = await loadMeeting(id);
      if (!m) continue;
      const [raw, ended] = await store.pipeline([['GET', `room:${id}`], ['GET', `ended:${id}`]]);
      const room = raw ? JSON.parse(raw) : null;
      const status = !room ? 'gone' : ended ? 'ended' : room.expiresAt < Date.now() ? 'expired' : 'open';
      out.push({ id, title: m.title, customerName: m.customerName, start: m.start, end: m.end, createdAt: m.createdAt, status, minutes: m.minutes.status, hasNotes: !!(m.notes.body || m.notes.decisions || m.notes.todos) });
    }
    return ok({ rooms: out });
  }

  // ---------- 入室 ----------
  async function join(req, room, peers) {
    if (room.ended) return fail(410, room.endedReason === 'expired' ? 'このリンクは有効期限が切れています' : 'この打ち合わせは終了しました');
    await sweep(room, peers);
    const b = req.body || {};
    const name = clean(b.name, 30);
    if (!name) return fail(400, 'お名前を入力してください');

    // 主催者かどうか：持ち主のスタッフ・管理者、または主催者用リンクの合札
    const staff = await auth.staffOf(req);
    if (staff && staff.cookie && !auth.sameOrigin(req)) return fail(403, '不正な送信元です');
    const byStaff = !!(staff && (staff.id === room.ownerId || staff.role === 'admin'));
    const byToken = typeof b.hostToken === 'string' && b.hostToken.length >= 20 && sec.safeEqual(sec.sha256(b.hostToken), room.hostTokenHash);
    const isHost = byStaff || byToken;

    if (!isHost) {
      const r1 = await limiter.hit('join_room', room.id);
      const r2 = await limiter.hit('join_room_ip', room.id, req.ip || 'unknown');
      if (!r1.ok || !r2.ok) return tooMany(r1.ok ? r2 : r1);
      if (room.locked) return fail(423, '現在、この打ち合わせへの入室は締め切られています');
      if (room.pinHash) {
        const pin = clean(b.pin, 12);
        if (!pin || !sec.safeEqual(sec.sha256(`${room.id}:${pin}`), room.pinHash)) {
          const f = await limiter.hit('pin_fail_room', room.id);
          if (!f.ok) return tooMany(f);
          return fail(403, '確認コードが違います');
        }
      }
      if (Object.values(peers).filter((p) => p.state === 'waiting').length >= MAX_WAITING) return fail(429, 'ただいま混み合っています。少し時間をおいてお試しください。');
    }
    if (joinedIds(peers).length >= MAX_PEERS) return fail(409, `この打ち合わせは満員です（${MAX_PEERS}名まで）`);

    const secret = sec.token(32);
    const p = {
      id: crypto.randomUUID(), name: isHost ? (byStaff ? staff.name : name) : name,
      role: isHost ? 'host' : 'guest', sh: sec.sha256(secret), state: 'waiting',
      staffId: byStaff ? staff.id : undefined,
      lastSeen: Date.now() - MIN_POLL_MS, // 入室の直後に取りに来ても「間隔が短すぎる」にならないように
    };
    await store.pipeline([['HSET', `seen:${room.id}`, p.id, String(p.lastSeen)], ['EXPIRE', `seen:${room.id}`, roomTtl(room)]]);
    if (isHost) {
      await admit(room, peers, p);
    } else {
      peers[p.id] = p;
      await putPeer(room, p);
      await push(room.id, [p.id], 'waiting', { hostPresent: hostIds(peers).length > 0 });
      await push(room.id, hostIds(peers), 'knock', publicPeer(p));
    }
    return ok({ peerId: p.id, secret, role: p.role, waiting: !isHost, name: p.name });
  }

  // ---------- 受け取り ----------
  async function poll(room, peers, me) {
    const now = Date.now();
    if (me.lastSeen && now - me.lastSeen < MIN_POLL_MS) return fail(429, '取得の間隔が短すぎます', { 'Retry-After': '1' });
    me.lastSeen = now;
    const [, events] = await store.multi([
      ['HSET', `seen:${room.id}`, me.id, String(now)],
      ['LRANGE', `inbox:${room.id}:${me.id}`, 0, -1],
      ['DEL', `inbox:${room.id}:${me.id}`],
    ]);
    await sweep(room, peers);
    const out = { events: (events || []).map((e) => JSON.parse(e)), state: me.state };
    if (room.ended) out.state = 'ended';
    // 一覧は入室済みの人にだけ返す（待合室の人に、中にいる人の名前を見せない）
    if (me.state === 'joined') out.roster = Object.values(peers).filter((p) => p.state === 'joined').map(publicPeer);
    if (me.state === 'waiting') out.hostPresent = hostIds(peers).length > 0;
    return ok(out);
  }

  // ---------- 合図の中継（形を確かめてから渡す） ----------
  function validSignal(d) {
    if (!d || typeof d !== 'object') return null;
    if (d.type === 'offer' || d.type === 'answer') {
      if (typeof d.sdp !== 'string' || d.sdp.length > 20000 || !d.sdp.startsWith('v=0')) return null;
      return { type: d.type, sdp: d.sdp };
    }
    if (d.type === 'ice') {
      if (!Array.isArray(d.candidates) || d.candidates.length > 40) return null;
      const list = [];
      for (const c of d.candidates) {
        if (!c || typeof c.candidate !== 'string' || c.candidate.length > 800) return null;
        list.push({ candidate: c.candidate, sdpMid: typeof c.sdpMid === 'string' ? c.sdpMid.slice(0, 16) : null, sdpMLineIndex: Number.isInteger(c.sdpMLineIndex) ? c.sdpMLineIndex : null });
      }
      return { type: 'ice', candidates: list };
    }
    if (d.type === 'resync' || d.type === 'restart') return { type: d.type };
    return null;
  }

  async function signal(room, peers, me, b) {
    const r = await limiter.hit('signal_peer', me.id);
    if (!r.ok) return tooMany(r);
    const to = peers[b.to];
    if (!to || to.state !== 'joined' || to.id === me.id) return fail(404, '相手が見つかりません');
    const data = validSignal(b.data);
    if (!data) return fail(400, '合図の形式が正しくありません');
    await push(room.id, [to.id], 'signal', { from: me.id, data });
    return ok({ ok: true });
  }

  // ---------- 参加者の操作 ----------
  async function participantAction(action, room, peers, me, b) {
    const lim = await limiter.hit(action === 'chat' ? 'chat_peer' : 'action_peer', me.id);
    if (!lim.ok) return tooMany(lim);
    const everyone = joinedIds(peers);

    if (action === 'chat') {
      if (!room.perms.chat && me.role !== 'host') return fail(403, 'チャットは主催者により止められています');
      const text = cleanText(b.text, 1000).trim();
      if (!text) return fail(400, 'メッセージが空です');
      const msg = { id: sec.token(9), from: me.id, name: me.name, role: me.role, text, at: Date.now() };
      if (room.saveChat) {
        await store.pipeline([['RPUSH', `mtg:${room.id}:chat`, seal(msg, `chat:${room.id}`)], ['EXPIRE', `mtg:${room.id}:chat`, RETENTION]]);
      }
      await push(room.id, everyone, 'chat', { ...msg, saved: !!room.saveChat });
      return ok({ ok: true, id: msg.id });
    }
    if (action === 'chat-delete') {
      // 本人か主催者だけ。誰のメッセージかは、配った時に覚えている送信者 ID で確かめる
      const msgId = clean(b.id, 20);
      const from = clean(b.from, 64);
      if (!msgId) return fail(400, '対象がありません');
      if (me.role !== 'host' && from !== me.id) return fail(403, '自分のメッセージだけ削除できます');
      if (me.role !== 'host') {
        // 保存されているなら、送信者が本人かを保存側でも確かめる
        const saved = room.saveChat ? (await readList(`mtg:${room.id}:chat`, `chat:${room.id}`)).find((m) => m.id === msgId) : null;
        if (saved && saved.from !== me.id) return fail(403, '自分のメッセージだけ削除できます');
      }
      await store.pipeline([['HSET', `mtg:${room.id}:chatdel`, msgId, '1'], ['EXPIRE', `mtg:${room.id}:chatdel`, RETENTION]]);
      await push(room.id, everyone, 'chat-delete', { id: msgId, by: me.id });
      return ok({ ok: true });
    }
    if (action === 'state') {
      const screen = bool(b.screen);
      if (screen && me.role !== 'host' && !room.perms.guestScreen) return fail(403, '画面共有は主催者の許可が必要です');
      await push(room.id, joinedIds(peers, me.id), 'peer-state', { id: me.id, mic: bool(b.mic), cam: bool(b.cam), screen });
      return ok({ ok: true });
    }
    if (action === 'react') {
      if (!REACTIONS.includes(b.kind)) return fail(400, '使えないリアクションです');
      await push(room.id, everyone, 'react', { id: me.id, name: me.name, kind: b.kind });
      return ok({ ok: true });
    }
    if (action === 'hand') {
      await push(room.id, everyone, 'hand', { id: me.id, name: me.name, up: bool(b.up) });
      return ok({ ok: true });
    }
    if (action === 'rec-consent') {
      const r = room.recording;
      if (!r || r.state === 'off') return fail(409, '記録の依頼はありません');
      r.consents = r.consents || {};
      if (!bool(b.accept)) {
        // 一人でも断ったら記録しない
        room.recording = { state: 'off', consents: {} };
        await saveRoom(room);
        await push(room.id, everyone, 'rec-state', { ...recPublic(room), declinedBy: me.name });
        await logEvent(room, { kind: 'rec-declined', name: me.name });
        return ok({ ok: true });
      }
      r.consents[me.id] = true;
      if (everyone.every((id) => r.consents[id])) r.state = 'active';
      await saveRoom(room);
      await push(room.id, everyone, 'rec-state', recPublic(room));
      await logEvent(room, { kind: 'rec-consent', name: me.name });
      return ok({ ok: true });
    }
    if (action === 'transcript') {
      const r = room.recording;
      if (!r || r.state !== 'active' || !r.consents || !r.consents[me.id]) return fail(409, '記録は開始されていません（全員の同意が必要です）');
      const segs = Array.isArray(b.segments) ? b.segments.slice(0, 20) : [];
      const cmds = [];
      for (const s of segs) {
        const text = cleanText(s && s.text, 2000).trim();
        if (!text) continue;
        cmds.push(['RPUSH', `mtg:${room.id}:tr`, seal({ id: sec.token(6), name: me.name, role: me.role, text, at: Date.now() }, `tr:${room.id}`)]);
      }
      if (cmds.length) { cmds.push(['EXPIRE', `mtg:${room.id}:tr`, RETENTION]); await store.pipeline(cmds); }
      return ok({ ok: true, saved: cmds.length ? cmds.length - 1 : 0 });
    }
    return fail(404, '見つかりません');
  }

  // ---------- 主催者の操作 ----------
  async function hostAction(action, room, peers, me, b) {
    const everyone = joinedIds(peers);
    const target = typeof b.target === 'string' ? peers[b.target] : null;

    if (action === 'admit' || action === 'deny') {
      if (!target || target.state !== 'waiting') return fail(404, 'その方は待合室にいません');
      if (action === 'admit') {
        if (joinedIds(peers).length >= MAX_PEERS) return fail(409, '満員です');
        await admit(room, peers, target);
      } else {
        target.state = 'denied';
        target.endedAt = Date.now();
        await putPeer(room, target);
        await push(room.id, [target.id], 'denied', {});
      }
      await push(room.id, hostIds(peers).filter((x) => x !== target.id), 'knock-cancel', { id: target.id });
      return ok({ ok: true });
    }
    if (action === 'kick') {
      if (!target || target.state !== 'joined' || target.id === me.id) return fail(404, '対象の方が見つかりません');
      if (target.role === 'host') return fail(403, '主催者は退出させられません');
      // 合言葉を無効にし（状態を kicked に）、本人に知らせ、ほかの全員に接続を切ってもらう
      // 状態を kicked にすると、以後の操作（合図・チャット・入室の再利用）はすべて断られる。
      // 合言葉はそのままにして、本人が次に取りに来たときに「退出させられた」と知らせ、30 秒で消す。
      target.state = 'kicked';
      target.endedAt = Date.now();
      await putPeer(room, target);
      await push(room.id, [target.id], 'kicked', { by: me.name });
      await push(room.id, joinedIds(peers, target.id), 'peer-left', { id: target.id, reason: 'kicked' });
      await logEvent(room, { kind: 'kicked', name: target.name, by: me.name });
      await recOnLeave(room, peers, target.id);
      return ok({ ok: true });
    }
    if (action === 'mute') {
      const to = b.target === 'all' ? joinedIds(peers, me.id).filter((id) => peers[id].role !== 'host') : (target && target.state === 'joined' ? [target.id] : []);
      if (!to.length) return fail(404, '対象の方が見つかりません');
      await push(room.id, to, 'muted', { by: me.name });
      return ok({ ok: true });
    }
    if (action === 'stop-share') {
      if (!target || target.state !== 'joined') return fail(404, '対象の方が見つかりません');
      await push(room.id, [target.id], 'stop-share', { by: me.name });
      return ok({ ok: true });
    }
    if (action === 'perms') {
      const next = { ...room.perms };
      for (const k of Object.keys(DEFAULT_PERMS)) if (typeof b[k] === 'boolean') next[k] = b[k];
      room.perms = next;
      if (typeof b.saveChat === 'boolean') room.saveChat = b.saveChat;
      await saveRoom(room);
      await push(room.id, everyone, 'perms', { perms: room.perms, saveChat: room.saveChat });
      // 画面共有の許可を取り消したら、共有中のお客様には止めてもらう
      if (b.guestScreen === false) await push(room.id, ids(peers, (p) => p.state === 'joined' && p.role === 'guest'), 'stop-share', { by: me.name });
      return ok({ ok: true, perms: room.perms, saveChat: room.saveChat });
    }
    if (action === 'lock') {
      const locked = bool(b.locked);
      await store.pipeline(locked ? [['SET', `lock:${room.id}`, 1, 'EX', roomTtl(room)]] : [['DEL', `lock:${room.id}`]]);
      await push(room.id, everyone, 'locked', { locked });
      return ok({ ok: true, locked });
    }
    if (action === 'end') {
      await endRoom(room, peers, 'ended');
      return ok({ ok: true });
    }
    if (action === 'rec-request') {
      if (transcription === 'none' && !(env.ALLOW_REC_DRYRUN === '1' && bool(b.dryRun))) return fail(409, '文字起こしは未設定です（外部サービスへの音声送信の承認が必要です）');
      room.recording = { state: 'requested', consents: { [me.id]: true }, by: me.name, at: Date.now() };
      if (everyone.length === 1) room.recording.state = 'active';
      await saveRoom(room);
      await push(room.id, joinedIds(peers, me.id), 'rec-request', { by: me.name });
      await push(room.id, everyone, 'rec-state', recPublic(room));
      await logEvent(room, { kind: 'rec-request', name: me.name });
      return ok({ ok: true, recording: recPublic(room) });
    }
    if (action === 'rec-stop') {
      room.recording = { state: 'off', consents: {} };
      await saveRoom(room);
      await push(room.id, everyone, 'rec-state', recPublic(room));
      await logEvent(room, { kind: 'rec-stop', name: me.name });
      return ok({ ok: true });
    }
    return fail(404, '見つかりません');
  }

  async function endRoom(room, peers, reason) {
    // 終了の印は別のキーに置く（ほかの更新で上書きされて「終了」が取り消されることがないように）
    await store.pipeline([['SET', `ended:${room.id}`, reason, 'EX', roomTtl(room)], ['DEL', `lock:${room.id}`]]);
    await push(room.id, Object.keys(peers), 'closed', { reason });
    // 参加者の合言葉はすべて無効にする（以後は何もできない）
    const cmds = [['DEL', `peers:${room.id}`]];
    for (const pid of Object.keys(peers)) cmds.push(['EXPIRE', `inbox:${room.id}:${pid}`, 120]);
    // 最後の「終了しました」だけは届くよう、受け箱は 2 分残し、参加者表は「終了」状態で 2 分だけ残す
    const tomb = {};
    for (const p of Object.values(peers)) tomb[p.id] = JSON.stringify({ id: p.id, name: p.name, role: p.role, sh: p.sh, state: 'ended', endedAt: Date.now() });
    const flat = Object.entries(tomb).flat();
    if (flat.length) cmds.push(['HSET', `peers:${room.id}`, ...flat], ['EXPIRE', `peers:${room.id}`, 120]);
    await store.pipeline(cmds);
    room.recording = { state: 'off', consents: {} };
    await saveRoom(room);
    await logEvent(room, { kind: 'ended', reason });
  }

  // ---------- 会議記録の API（スタッフだけ） ----------
  async function handleMeetings(req, parts) {
    const staff = await auth.staffOf(req);
    if (!staff) return fail(401, 'ログインが必要です');
    if (req.method !== 'GET' && staff.cookie && !auth.sameOrigin(req)) return fail(403, '不正な送信元です');
    const id = parts[2];
    if (!id) {
      if (req.method !== 'GET') return fail(405, '使えない操作です');
      return listRooms(staff);
    }
    if (!ROOM_ID_RE.test(id)) return fail(404, '記録が見つかりません');
    const m = await loadMeeting(id);
    // 権限が無い場合も「見つからない」と返す（他人の記録があるかどうかを推測させない）
    if (!m || !can('view', staff, m)) return fail(404, '記録が見つかりません');
    const sub = parts[3] || '';

    if (req.method === 'GET' && !sub) return ok({ meeting: await meetingFull(m), can: { edit: can('edit', staff, m), delete: can('delete', staff, m), download: can('download', staff, m) }, ai: ai.enabled });
    if (req.method === 'GET' && sub === 'export') {
      if (!can('download', staff, m)) return fail(404, '記録が見つかりません');
      const full = await meetingFull(m);
      return ok({ filename: `打ち合わせ記録_${id}.md`, markdown: toMarkdown(full) });
    }
    if (req.method === 'PUT' && sub === 'notes') {
      if (!can('edit', staff, m)) return fail(403, '編集する権限がありません');
      const n = req.body || {};
      m.notes = {
        body: cleanText(n.body, 20000), decisions: cleanText(n.decisions, 5000), pending: cleanText(n.pending, 5000), todos: cleanText(n.todos, 5000),
        updatedAt: Date.now(), updatedBy: staff.name,
      };
      for (const k of ['customerName']) if (typeof n[k] === 'string') m[k] = clean(n[k], 60);
      for (const k of ['customerId', 'projectId']) if (typeof n[k] === 'string') { if (n[k] && !ID_RE.test(n[k])) return fail(400, `${k} の形式が正しくありません`); m[k] = n[k]; }
      await saveMeeting(m);
      return ok({ ok: true, notes: m.notes });
    }
    if (req.method === 'PUT' && sub === 'board') {
      if (!can('edit', staff, m)) return fail(403, '編集する権限がありません');
      const raw = JSON.stringify(req.body && req.body.board || null);
      if (raw.length > 700000) return fail(413, 'ホワイトボードが大きすぎます（画像を減らしてください）');
      m.board = { data: req.body.board, savedAt: Date.now(), savedBy: staff.name };
      await saveMeeting(m);
      return ok({ ok: true });
    }
    if (req.method === 'PUT' && sub === 'minutes') {
      if (!can('confirm', staff, m)) return fail(403, '編集する権限がありません');
      const content = ai.sanitizeMinutes(req.body && req.body.content);
      if (!content) return fail(400, '議事録の形式が正しくありません');
      const confirm = bool(req.body.confirm);
      m.minutes = { ...m.minutes, status: confirm ? 'confirmed' : (m.minutes.status === 'confirmed' ? 'confirmed' : (m.minutes.status === 'ai_draft' ? 'ai_draft' : 'manual')), content, updatedAt: Date.now(), updatedBy: staff.name, ...(confirm ? { confirmedAt: Date.now(), confirmedBy: staff.name } : {}) };
      await saveMeeting(m);
      return ok({ ok: true, minutes: m.minutes });
    }
    if (req.method === 'POST' && sub === 'summarize') {
      if (!can('edit', staff, m)) return fail(403, '編集する権限がありません');
      if (!ai.enabled) return fail(409, 'AI 要約は未設定です（外部 AI への送信の承認が必要です）');
      const full = await meetingFull(m);
      if (!full.transcript.length && !full.notes.body) return fail(409, '要約する材料（文字起こし・メモ）がありません');
      let draft;
      try { draft = await ai.summarize(full); } catch (_) { return fail(502, 'AI 要約に失敗しました'); }
      m.minutes = { status: 'ai_draft', content: draft, generatedAt: Date.now(), generatedBy: staff.name, model: ai.model };
      await saveMeeting(m);
      return ok({ ok: true, minutes: m.minutes });
    }
    if (req.method === 'DELETE' && !sub) {
      if (!can('delete', staff, m)) return fail(403, '削除する権限がありません');
      await store.pipeline([
        ['DEL', `mtg:${id}`, `mtg:${id}:log`, `mtg:${id}:chat`, `mtg:${id}:chatdel`, `mtg:${id}:tr`],
        ['HDEL', `staffidx:${m.ownerId}`, id],
      ]);
      return ok({ ok: true });
    }
    return fail(404, '見つかりません');
  }

  function toMarkdown(m) {
    const d = (t) => (t ? new Date(t).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '');
    const lines = [`# ${m.title}`, '', `- 日時：${d(m.start) || d(m.createdAt)}${m.end ? ` 〜 ${d(m.end)}` : ''}`, `- 担当：${m.ownerName}`];
    if (m.customerName) lines.push(`- お客様：${m.customerName}`);
    if (m.customerId) lines.push(`- 顧客 ID：${m.customerId}`);
    if (m.projectId) lines.push(`- 案件 ID：${m.projectId}`);
    const names = [...new Set(m.log.filter((e) => e.kind === 'joined').map((e) => `${e.name}${e.role === 'host' ? '（担当）' : ''}`))];
    if (names.length) lines.push(`- 参加者：${names.join('、')}`);
    lines.push('', '## メモ', m.notes.body || '（なし）', '', '## 決定事項', m.notes.decisions || '（なし）', '', '## 未決定事項', m.notes.pending || '（なし）', '', '## 次回までの確認事項', m.notes.todos || '（なし）');
    if (m.minutes && m.minutes.content) {
      lines.push('', `## 議事録（${m.minutes.status === 'confirmed' ? '確認済み' : m.minutes.status === 'ai_draft' ? 'AI 生成・確認前' : '手入力'}）`, ai.minutesToMarkdown(m.minutes.content));
    }
    if (m.chat.length) {
      lines.push('', '## チャット');
      for (const c of m.chat) lines.push(`- ${new Date(c.at).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })} ${c.name}：${c.text.replace(/\n/g, ' ')}`);
    }
    if (m.transcript.length) {
      lines.push('', '## 文字起こし');
      for (const t of m.transcript) lines.push(`- [${t.id}] ${t.name}：${t.text}`);
    }
    return lines.join('\n') + '\n';
  }

  return { handle, keys, auth };
}

module.exports = { createApi, ROOM_ID_RE, clean };
