// COMPASS 通話 — ブラウザ側
// 映像・音声は WebRTC で参加者どうしを直接つなぐ（少人数向けの全員接続）。
// 各接続には最初から「音声 1 本・映像 1 本」の枠を作り、カメラ ⇔ 画面共有の切り替えは
// 枠の中身を差し替えるだけにしている（つなぎ直しが要らない）。
'use strict';

const $ = (id) => document.getElementById(id);
const roomId = location.pathname.split('/').pop();
const api = (p) => `/api/rooms/${roomId}${p}`;

const ICON = {
  mic: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-2c0 .74-.16 1.43-.43 2.06l1.47 1.47A6.9 6.9 0 0 0 19 11Zm-4 .17V5a3 3 0 0 0-5.91-.7L15 10.17ZM4.27 3 3 4.27l6 6V11a3 3 0 0 0 4.52 2.6l1.48 1.48A5 5 0 0 1 7 11H5a7 7 0 0 0 6 6.92V21h2v-3.08a6.9 6.9 0 0 0 2.97-1.06L19.73 21 21 19.73 4.27 3Z"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z"/></svg>',
  camOff: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 6.5l-4 4V7a1 1 0 0 0-1-1H9.82L21 17.18V6.5ZM3.27 2 2 3.27 4.73 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2Z"/></svg>',
  screen: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6v2H8v2h8v-2h-2v-2h6a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 12H4V6h16v10Zm-8-9-4 4h3v3h2v-3h3l-4-4Z"/></svg>',
  leave: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a1 1 0 0 1-1.41-.02L.29 13.08a1 1 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67a1 1 0 0 1 0 1.41l-2.48 2.48a1 1 0 0 1-1.41.02 11.3 11.3 0 0 0-2.67-1.85 1 1 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9Z"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05A4.2 4.2 0 0 1 17 16.5V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm0 14H5.17L4 17.17V4h16v12Z"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12A3.1 3.1 0 0 1 7 8.9h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12ZM8 13h8v-2H8v2Zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10Z"/></svg>',
};

// ---------- 状態 ----------
const me = { peerId: null, secret: null, name: '' };
let config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let roomMeta = null;
let camStream = null;     // カメラ＋マイク
let screenStream = null;  // 画面共有
let micOn = true;
let camOn = true;
let inCall = false;
let unread = 0;
let callStart = 0;
/** @type {Map<string, {pc: RTCPeerConnection, name: string, stream: MediaStream, tile: HTMLElement, pending: RTCIceCandidateInit[], state: any, polite: boolean}>} */
const peers = new Map();
const knocks = new Map();

// ---------- 小物 ----------
function toast(text, actions) {
  const el = $('toast');
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = text;
  el.appendChild(span);
  for (const [label, fn] of actions || []) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.onclick = () => { el.classList.add('hidden'); fn(); };
    el.appendChild(b);
  }
  el.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add('hidden'), actions ? 15000 : 3000);
}

function show(id) {
  for (const s of ['loading', 'fatal', 'lobby', 'call']) $(s).classList.toggle('hidden', s !== id);
}

function fatal(title, text) {
  $('fatalTitle').textContent = title;
  $('fatalText').textContent = text || '';
  show('fatal');
}

async function post(action, body) {
  const r = await fetch(api(`/${action}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ peerId: me.peerId, secret: me.secret, ...body }),
  });
  if (!r.ok) {
    let msg = '送れませんでした';
    try { msg = (await r.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}

function initial(name) { return (name || '?').trim().slice(0, 1).toUpperCase(); }

function fmtWhen(start, end) {
  if (!start) return '';
  const s = new Date(start);
  if (isNaN(s)) return '';
  const w = '日月火水木金土'[s.getDay()];
  const hm = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  let t = `${s.getMonth() + 1}月${s.getDate()}日（${w}）${hm(s)}`;
  const e = end ? new Date(end) : null;
  if (e && !isNaN(e)) t += `〜${hm(e)}`;
  return t;
}

function setRound(btn, on, iconOn, iconOff) {
  btn.innerHTML = on ? iconOn : iconOff;
  btn.classList.toggle('off', !on);
}

// ---------- 端末（カメラ・マイク） ----------
async function openDevices() {
  const notice = $('mediaNotice');
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
    });
  } catch (e) {
    // カメラが無い・断られた → 音声だけでも試す
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      camOn = false;
      notice.textContent = 'カメラが使えないため、音声だけで参加します。';
      notice.classList.remove('hidden');
    } catch (e2) {
      camStream = new MediaStream();
      micOn = false; camOn = false;
      notice.textContent = 'カメラとマイクが使えません。ブラウザの設定で許可すると、話したり映ったりできます。このまま見る・聞くだけで参加することもできます。';
      notice.classList.add('error');
      notice.classList.remove('hidden');
    }
  }
  $('preview').srcObject = camStream;
  refreshLocal();
}

function audioTrack() { return camStream && camStream.getAudioTracks()[0] || null; }
function camTrack() { return camStream && camStream.getVideoTracks()[0] || null; }
function outgoingVideo() {
  if (screenStream) return screenStream.getVideoTracks()[0] || null;
  return camOn ? camTrack() : null;
}

function refreshLocal() {
  const a = audioTrack();
  if (a) a.enabled = micOn;
  const v = camTrack();
  if (v) v.enabled = camOn;
  setRound($('pMic'), micOn, ICON.mic, ICON.micOff);
  setRound($('pCam'), camOn, ICON.cam, ICON.camOff);
  setRound($('mic'), micOn, ICON.mic, ICON.micOff);
  setRound($('cam'), camOn, ICON.cam, ICON.camOff);
  $('pMic').disabled = $('mic').disabled = !a;
  $('pCam').disabled = $('cam').disabled = !v;
  $('previewOff').classList.toggle('hidden', camOn && !!v);
  $('screen').classList.toggle('on', !!screenStream);
  if (inCall) {
    // 送る映像を差し替え（カメラを切ったときは何も送らない＝相手側は名前の丸を出す）
    for (const p of peers.values()) {
      const t = p.pc.getTransceivers().find((x) => x.receiver.track.kind === 'video');
      if (t) t.sender.replaceTrack(outgoingVideo()).catch(() => {});
    }
    updateSelfTile();
    post('state', { mic: micOn, cam: camOn && !!v, screen: !!screenStream }).catch(() => {});
  }
}

// ---------- 画面の並び ----------
function makeTile(id, name, isSelf) {
  const tile = document.createElement('div');
  tile.className = 'tile' + (isSelf ? ' self' : '');
  tile.dataset.id = id;
  tile.innerHTML = '<video autoplay playsinline></video><div class="avatar"><span></span></div><div class="name"><span class="mic"></span><span class="nm"></span></div><div class="status hidden"></div>';
  tile.querySelector('.avatar span').textContent = initial(name);
  tile.querySelector('.nm').textContent = isSelf ? `${name}（あなた）` : name;
  if (isSelf) tile.querySelector('video').muted = true;
  $('stage').appendChild(tile);
  layout();
  return tile;
}

function setTileState(tile, { mic, cam, screen }) {
  tile.querySelector('.avatar').classList.toggle('hidden', !!(cam || screen));
  tile.querySelector('.mic').innerHTML = mic ? '' : ICON.micOff;
  tile.classList.toggle('screen', !!screen);
  layout();
}

let selfTile = null;
function updateSelfTile() {
  if (!selfTile) return;
  const v = selfTile.querySelector('video');
  const stream = screenStream || camStream;
  if (v.srcObject !== stream) v.srcObject = stream;
  setTileState(selfTile, { mic: micOn, cam: camOn && !!camTrack(), screen: !!screenStream });
}

function layout() {
  const stage = $('stage');
  const tiles = [...stage.children];
  const n = Math.min(tiles.length, 6);
  const featured = tiles.find((t) => t.classList.contains('screen') && !t.classList.contains('self'))
    || tiles.find((t) => t.classList.contains('screen'));
  tiles.forEach((t) => t.classList.toggle('featured', t === featured && tiles.length > 1));
  stage.className = `stage n${n}` + (featured && tiles.length > 1 ? ' spotlight' : '');
  if (featured && tiles.length > 1) stage.prepend(featured);
}

// ---------- 接続（WebRTC） ----------
function createPeer(id, name, initiator) {
  const pc = new RTCPeerConnection({ iceServers: config.iceServers });
  const stream = new MediaStream();
  const tile = makeTile(id, name, false);
  tile.querySelector('video').srcObject = stream;
  const peer = { pc, name, stream, tile, pending: [], state: { mic: true, cam: true, screen: false }, polite: !initiator };
  peers.set(id, peer);

  // 接続の候補はまとめて送る（1 件ずつ送ると往復が増える）
  let iceBuf = [];
  let iceTimer = null;
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    iceBuf.push(e.candidate.toJSON ? e.candidate.toJSON() : e.candidate);
    if (!iceTimer) iceTimer = setTimeout(() => {
      const list = iceBuf; iceBuf = []; iceTimer = null;
      post('signal', { to: id, data: { type: 'ice', candidates: list } }).catch(() => {});
    }, 150);
  };
  pc.ontrack = (e) => {
    stream.getTracks().filter((t) => t.kind === e.track.kind).forEach((t) => stream.removeTrack(t));
    stream.addTrack(e.track);
    const v = tile.querySelector('video');
    v.srcObject = stream;
    v.play().catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    const st = tile.querySelector('.status');
    const s = pc.connectionState;
    st.classList.toggle('hidden', s === 'connected');
    st.textContent = s === 'failed' ? 'つながりません' : s === 'disconnected' ? '回線が不安定です' : '接続中…';
    if (s === 'failed' && initiator) restartIce(id);
  };

  if (initiator) {
    const a = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const v = pc.addTransceiver('video', { direction: 'sendrecv' });
    a.sender.replaceTrack(audioTrack());
    v.sender.replaceTrack(outgoingVideo());
    makeOffer(id);
  }
  return peer;
}

async function makeOffer(id, opts) {
  const p = peers.get(id);
  if (!p) return;
  const offer = await p.pc.createOffer(opts);
  await p.pc.setLocalDescription(offer);
  await post('signal', { to: id, data: { type: 'offer', sdp: p.pc.localDescription.sdp } });
}

async function restartIce(id) {
  try { await makeOffer(id, { iceRestart: true }); } catch (_) {}
}

async function onSignal({ from, name, data }) {
  let p = peers.get(from);
  if (data.type === 'offer') {
    if (!p) p = createPeer(from, name, false);
    await p.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
    for (const t of p.pc.getTransceivers()) {
      t.direction = 'sendrecv';
      const kind = t.receiver.track.kind;
      await t.sender.replaceTrack(kind === 'audio' ? audioTrack() : outgoingVideo());
    }
    await flushIce(p);
    const answer = await p.pc.createAnswer();
    await p.pc.setLocalDescription(answer);
    await post('signal', { to: from, data: { type: 'answer', sdp: p.pc.localDescription.sdp } });
  } else if (data.type === 'answer' && p) {
    await p.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
    await flushIce(p);
  } else if (data.type === 'ice' && p) {
    for (const c of data.candidates || [data.candidate]) {
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(c).catch(() => {});
      else p.pending.push(c);
    }
  }
}

async function flushIce(p) {
  const list = p.pending.splice(0);
  for (const c of list) await p.pc.addIceCandidate(c).catch(() => {});
}

function dropPeer(id) {
  const p = peers.get(id);
  if (!p) return;
  p.pc.close();
  p.tile.remove();
  peers.delete(id);
  layout();
  renderPeople();
}

// ---------- 入室 ----------
async function join() {
  me.name = $('name').value.trim();
  if (!me.name) { $('name').focus(); return toast('お名前を入れてください'); }
  try { localStorage.setItem('meet.name', me.name); } catch (_) {}
  $('joinBtn').disabled = true;
  let r;
  try {
    const res = await fetch(api('/join'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: me.name }) });
    r = await res.json();
    if (!res.ok) throw new Error(r.error || '参加できませんでした');
  } catch (e) {
    $('joinBtn').disabled = false;
    return toast(e.message);
  }
  me.peerId = r.peerId;
  me.secret = r.secret;
  if (r.waiting) $('waitBox').classList.remove('hidden');
  listen();
}

// サーバーに数秒おきに「自分あての合図」を取りに行く。
// 接続を張っている最中や何か届いた直後は短い間隔、静かなときは間隔をのばす（伝言板の利用回数を節約）。
let polling = false;
let lastActivity = 0;
let failCount = 0;

const handlers = {
  waiting: () => $('waitBox').classList.remove('hidden'),
  denied: () => {
    polling = false;
    fatal('入室できませんでした', '担当者に入室を断られました。お心当たりがない場合は、担当者にご連絡ください。');
  },
  closed: () => { polling = false; leave(); fatal('この通話は終了しました', ''); },
  admitted: (d) => enterCall(d),
  'peer-joined': ({ id, name }) => {
    // 新しく入った人が offer を送ってくるので、ここでは受け皿を作って待つ
    toast(`${name} さんが参加しました`);
    if (!peers.has(id)) createPeer(id, name, false);
    renderPeople();
    // 新しい人に自分のマイク・カメラの状態を知らせ直す
    post('state', { mic: micOn, cam: camOn && !!camTrack(), screen: !!screenStream }).catch(() => {});
  },
  'peer-left': ({ id }) => {
    const p = peers.get(id);
    if (p) toast(`${p.name} さんが退出しました`);
    dropPeer(id);
  },
  'peer-state': (s) => {
    const p = peers.get(s.id);
    if (!p) return;
    p.state = s;
    setTileState(p.tile, s);
    renderPeople();
  },
  signal: (d) => onSignal(d),
  chat: (d) => addChat(d),
  knock: (k) => {
    knocks.set(k.id, k);
    renderPeople();
    toast(`${k.name} さんが参加を求めています`, [['許可', () => decide(k.id, true)], ['参加者を見る', () => openSide('people')]]);
  },
  'knock-cancel': ({ id }) => { knocks.delete(id); renderPeople(); },
};

function nextDelay() {
  const idle = Date.now() - lastActivity;
  if (!inCall) return 1000;                 // 待機室
  if (idle < 15000) return 600;             // つなぎ始め・やりとりの直後
  const connecting = [...peers.values()].some((p) => p.pc.connectionState !== 'connected');
  return connecting ? 800 : 2500;
}

async function listen() {
  polling = true;
  lastActivity = Date.now();
  while (polling && me.peerId) {
    try {
      const r = await fetch(api(`/poll?peerId=${encodeURIComponent(me.peerId)}`), {
        cache: 'no-store',
        headers: { 'X-Peer-Secret': me.secret },
      });
      if (r.status === 403 || r.status === 404) {
        polling = false;
        if (inCall) { toast('通話から外れました。もう一度参加してください。'); leave(); }
        else fatal('参加できませんでした', '時間がたちすぎたか、通話が終了しました。リンクを開き直してください。');
        break;
      }
      const j = await r.json();
      if (failCount >= 3 && inCall) toast('サーバーとの接続が戻りました');
      failCount = 0;
      if (j.events.length) lastActivity = Date.now();
      for (const ev of j.events) {
        const h = handlers[ev.type];
        if (h) { try { await h(ev.data); } catch (e) { console.error(e); } }
      }
      if (j.state === 'denied' && polling) handlers.denied();
      // 一覧にいない人は抜けたとみなす（回線が切れた場合の後始末）
      if (inCall && j.roster) {
        const present = new Set(j.roster.map((x) => x.id));
        for (const id of [...peers.keys()]) if (!present.has(id)) dropPeer(id);
      }
    } catch (e) {
      failCount++;
      if (failCount === 3 && inCall) toast('サーバーとの接続を立て直しています…');
    }
    await new Promise((res) => setTimeout(res, failCount ? Math.min(5000, 1000 * failCount) : nextDelay()));
  }
}

function enterCall({ peers: others, room }) {
  if (inCall) return;
  inCall = true;
  callStart = Date.now();
  $('waitBox').classList.add('hidden');
  $('cTitle').textContent = (room && room.title) || roomMeta.title || roomId;
  show('call');
  selfTile = makeTile('self', me.name, true);
  updateSelfTile();
  for (const o of others) createPeer(o.id, o.name, true);
  refreshLocal();
  renderPeople();
  tick();
}

async function decide(id, ok) {
  try { await post(ok ? 'admit' : 'deny', { target: id }); }
  catch (e) { toast(e.message); }
  knocks.delete(id);
  renderPeople();
}

function leave() {
  if (me.peerId) {
    const body = JSON.stringify({ peerId: me.peerId, secret: me.secret });
    navigator.sendBeacon(api('/leave'), new Blob([body], { type: 'application/json' }));
  }
  polling = false;
  for (const id of [...peers.keys()]) dropPeer(id);
  for (const s of [camStream, screenStream]) if (s) s.getTracks().forEach((t) => t.stop());
  inCall = false;
  me.peerId = null;
  $('fatalTitle').textContent = '退出しました';
  $('fatalText').textContent = 'おつかれさまでした。';
  const again = document.createElement('a');
  again.className = 'btn primary';
  again.textContent = 'もう一度参加する';
  again.href = location.pathname;
  const acts = $('fatalActions');
  acts.insertBefore(again, acts.firstChild);
  show('fatal');
}

// ---------- 画面共有 ----------
async function toggleScreen() {
  if (screenStream) return stopScreen();
  if (!navigator.mediaDevices.getDisplayMedia) return toast('この端末では画面の共有ができません');
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
  } catch (_) { return; }
  const t = screenStream.getVideoTracks()[0];
  if ('contentHint' in t) t.contentHint = 'detail'; // 図面の細かい線をつぶさない
  t.onended = stopScreen;
  refreshLocal();
}

function stopScreen() {
  if (!screenStream) return;
  screenStream.getTracks().forEach((t) => t.stop());
  screenStream = null;
  refreshLocal();
}

// ---------- 横の欄（参加者・チャット） ----------
let sideMode = null;
function openSide(mode) {
  if (sideMode === mode) return closeSide();
  sideMode = mode;
  $('side').classList.remove('hidden');
  $('sideTitle').textContent = mode === 'chat' ? 'チャット' : '参加者';
  $('chatPane').classList.toggle('hidden', mode !== 'chat');
  $('chatFoot').classList.toggle('hidden', mode !== 'chat');
  $('peoplePane').classList.toggle('hidden', mode !== 'people');
  if (mode === 'chat') { unread = 0; badge(); $('chatInput').focus(); }
  renderPeople();
}
function closeSide() { sideMode = null; $('side').classList.add('hidden'); }

function renderPeople() {
  const pane = $('peoplePane');
  pane.innerHTML = '';
  for (const k of knocks.values()) {
    const box = document.createElement('div');
    box.className = 'knock';
    box.innerHTML = '<div><strong></strong> さんが参加を求めています</div><div class="row"><button class="btn primary">許可</button><button class="btn">断る</button></div>';
    box.querySelector('strong').textContent = k.name;
    const [ok, ng] = box.querySelectorAll('button');
    ok.onclick = () => decide(k.id, true);
    ng.onclick = () => decide(k.id, false);
    pane.appendChild(box);
  }
  const list = [{ name: `${me.name}（あなた）`, mic: micOn }, ...[...peers.values()].map((p) => ({ name: p.name, mic: p.state.mic }))];
  const h = document.createElement('div');
  h.className = 'muted';
  h.textContent = `通話中 ${list.length}人`;
  pane.appendChild(h);
  for (const x of list) {
    const row = document.createElement('div');
    row.className = 'person';
    row.innerHTML = '<div class="dot"></div><div class="nm"></div><div class="m"></div>';
    row.querySelector('.dot').textContent = initial(x.name);
    row.querySelector('.nm').textContent = x.name;
    row.querySelector(".m").innerHTML = x.mic ? "" : ICON.micOff;
    pane.appendChild(row);
  }
  const pb = $('peopleBtn');
  pb.innerHTML = ICON.people + (knocks.size ? `<span class="badge">${knocks.size}</span>` : '');
}

function addChat({ from, name, text, at }) {
  $('chatEmpty').classList.add('hidden');
  const box = document.createElement('div');
  box.className = 'msg';
  const t = new Date(at);
  box.innerHTML = '<div class="who"></div><div class="text"></div>';
  box.querySelector('.who').textContent = `${from === me.peerId ? 'あなた' : name}　${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
  box.querySelector('.text').textContent = text;
  $('chatPane').appendChild(box);
  $('chatPane').scrollTop = $('chatPane').scrollHeight;
  if (sideMode !== 'chat' && from !== me.peerId) { unread++; badge(); toast(`${name}: ${text.slice(0, 40)}`); }
}
function badge() { $('chatBtn').innerHTML = ICON.chat + (unread ? `<span class="badge">${unread}</span>` : ''); }

async function sendChat() {
  const text = $('chatInput').value.trim();
  if (!text) return;
  $('chatInput').value = '';
  try { await post('chat', { text }); } catch (e) { toast(e.message); }
}

function tick() {
  if (!inCall) return;
  const d = new Date();
  $('clock').textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  setTimeout(tick, 15000 - (Date.now() % 15000));
}

// ---------- 起動 ----------
async function boot() {
  if (!/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(roomId)) return fatal('リンクが正しくありません', '送られてきたリンクをもう一度ご確認ください。');
  try {
    const [cfg, info] = await Promise.all([
      fetch('/api/config').then((r) => r.json()),
      fetch(api('')).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; }),
    ]);
    config = cfg;
    roomMeta = info;
  } catch (e) {
    return fatal('この通話は見つかりません', e.message);
  }
  document.title = `${roomMeta.title || 'オンライン打ち合わせ'} | COMPASS Meet`;
  $('lTitle').textContent = roomMeta.title || 'オンライン打ち合わせ';
  const when = $('lWhen');
  when.textContent = '';
  const w = fmtWhen(roomMeta.start, roomMeta.end);
  if (w) { const s1 = document.createElement('span'); s1.textContent = w; when.appendChild(s1); }
  const live = document.createElement('span');
  live.className = 'live' + (roomMeta.participants ? '' : ' empty');
  live.textContent = roomMeta.participants ? `${roomMeta.participants}名が参加中` : 'まだどなたも参加していません';
  when.appendChild(live);
  const q = new URLSearchParams(location.search);
  let saved = '';
  try { saved = localStorage.getItem('meet.name') || ''; } catch (_) {}
  $('name').value = q.get('name') || saved;

  for (const [id, icon] of [['screen', ICON.screen], ['leave', ICON.leave], ['peopleBtn', ICON.people], ['chatBtn', ICON.chat], ['linkBtn', ICON.link]]) $(id).innerHTML = icon;
  show('lobby');
  if (!window.RTCPeerConnection || !navigator.mediaDevices) {
    return fatal('このブラウザでは通話できません', 'Chrome・Safari・Edge の新しい版でお開きください。LINE などのアプリ内ブラウザでは動かないことがあります。');
  }
  await openDevices();
}

$('pMic').onclick = $('mic').onclick = () => { micOn = !micOn; refreshLocal(); renderPeople(); };
$('pCam').onclick = $('cam').onclick = () => { camOn = !camOn; refreshLocal(); };
$('screen').onclick = toggleScreen;
$('leave').onclick = leave;
$('joinBtn').onclick = join;
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
$('peopleBtn').onclick = () => openSide('people');
$('chatBtn').onclick = () => openSide('chat');
$('sideClose').onclick = closeSide;
$('chatSend').onclick = sendChat;
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) sendChat(); });
$('linkBtn').onclick = async () => {
  const url = `${location.origin}/r/${roomId}`;
  try { await navigator.clipboard.writeText(url); toast('招待リンクをコピーしました'); }
  catch (_) { prompt('コピーしてください', url); }
};
document.addEventListener('keydown', (e) => {
  if (!inCall || !(e.ctrlKey || e.metaKey)) return;
  if (e.key === 'd') { e.preventDefault(); $('mic').click(); }
  if (e.key === 'e') { e.preventDefault(); $('cam').click(); }
});
window.addEventListener('pagehide', () => { if (inCall) leave(); });

boot();
