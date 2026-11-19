// COMPASS Meet — 通話画面
// 映像・音声・書き込みは WebRTC で参加者どうしを直接つなぐ（少人数向けの全員接続）。
// 各接続には最初から「音声・映像の枠」と「書き込み用のデータチャネル」を用意し、
// カメラ⇔画面共有の切り替えは枠の中身を差し替えるだけにしている（つなぎ直しが要らない）。
import { Board, COLORS, WIDTHS, fileToDataUrl, pdfToDataUrl } from './board.js';

const $ = (id) => document.getElementById(id);
const roomId = location.pathname.split('/').pop();
const api = (p) => `/api/rooms/${roomId}${p}`;
const STORE_KEY = `meet:${roomId}`;

const I = (d) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = {
  mic: I('M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z'),
  micOff: I('M19 11h-2c0 .74-.16 1.43-.43 2.06l1.47 1.47A6.9 6.9 0 0 0 19 11Zm-4 .17V5a3 3 0 0 0-5.91-.7L15 10.17ZM4.27 3 3 4.27l6 6V11a3 3 0 0 0 4.52 2.6l1.48 1.48A5 5 0 0 1 7 11H5a7 7 0 0 0 6 6.92V21h2v-3.08a6.9 6.9 0 0 0 2.97-1.06L19.73 21 21 19.73 4.27 3Z'),
  cam: I('M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z'),
  camOff: I('M21 6.5l-4 4V7a1 1 0 0 0-1-1H9.82L21 17.18V6.5ZM3.27 2 2 3.27 4.73 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2Z'),
  screen: I('M20 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6v2H8v2h8v-2h-2v-2h6a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 12H4V6h16v10Zm-8-9-4 4h3v3h2v-3h3l-4-4Z'),
  pen: I('M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z'),
  board: I('M19 3H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h4l-2 3h2l2-3h2l2 3h2l-2-3h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 13H5V5h14v11ZM7 12l3-3 2 2 4-4 1 1-5 5-2-2-2 2-1-1Z'),
  smile: I('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm-3.5-9A1.5 1.5 0 1 0 8.5 8a1.5 1.5 0 0 0 0 3Zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 17.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5Z'),
  leave: I('M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a1 1 0 0 1-1.41-.02L.29 13.08a1 1 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67a1 1 0 0 1 0 1.41l-2.48 2.48a1 1 0 0 1-1.41.02 11.3 11.3 0 0 0-2.67-1.85 1 1 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9Z'),
  people: I('M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05A4.2 4.2 0 0 1 17 16.5V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z'),
  chat: I('M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm0 14H5.17L4 17.17V4h16v12Z'),
  notes: I('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm2 16H8v-2h8v2Zm0-4H8v-2h8v2Zm-3-5V3.5L18.5 9H13Z'),
  more: I('M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z'),
  gear: I('M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.84a.5.5 0 0 0-.49.42l-.36 2.54a7 7 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.67 8.48a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.61.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.54c.05.24.25.42.49.42h3.84c.24 0 .44-.18.49-.42l.36-2.54a7 7 0 0 0 1.62-.94l2.39.96c.22.08.48 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z'),
  hand: I('M21 7a2 2 0 0 0-4 0v4h-1V4a2 2 0 0 0-4 0v7h-1V5a2 2 0 0 0-4 0v8.5l-1.6-2.4a2 2 0 0 0-3.3 2.3l3.6 5.4A7 7 0 0 0 11.5 22H14a7 7 0 0 0 7-7V7Z'),
};
const REACT_LABEL = { like: 'いいね', clap: '拍手', ok: '了解', question: '質問' };

// ---------- 状態 ----------
const me = { peerId: null, secret: null, role: 'guest', name: '' };
let config = {};
let pub = null;
let room = { perms: { guestScreen: false, guestAnnotate: true, guestBoard: true, chat: true }, saveChat: false, recording: { state: 'off' }, transcription: 'none', locked: false, title: '' };
let iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
let camStream = null; let screenStream = null;
let micOn = true; let camOn = true;
let inCall = false; let polling = false; let lastActivity = 0; let failCount = 0;
let unread = 0; let sideTab = null; let handUp = false; let hostToken = null; let staff = null;
let wbOpen = false; let annOn = false; let sharerId = null;
let audioCtx = null;
const peers = new Map();
const waiting = new Map();
const devices = { mic: '', cam: '', speaker: '' };
const rosterInfo = new Map();

// ---------- 小物 ----------
function toast(text, actions, ms) {
  const box = $('toast');
  box.textContent = '';
  const span = document.createElement('span'); span.textContent = text; box.appendChild(span);
  for (const [label, fn] of actions || []) {
    const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = label;
    b.onclick = () => { box.classList.add('hidden'); fn(); };
    box.appendChild(b);
  }
  box.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => box.classList.add('hidden'), ms || (actions ? 15000 : 3200));
}

function show(id) { for (const s of ['loading', 'fatal', 'lobby', 'call']) $(s).classList.toggle('hidden', s !== id); }

function fatal(title, text, actions = [['トップへ戻る', '/']]) {
  $('fatalTitle').textContent = title;
  $('fatalText').textContent = text || '';
  const box = $('fatalActions'); box.textContent = '';
  for (const [label, href, primary] of actions) {
    const a = document.createElement('a'); a.className = `btn${primary ? ' primary' : ''}`; a.textContent = label; a.href = href; box.appendChild(a);
  }
  show('fatal');
}

async function post(action, body) {
  const r = await fetch(api(`/${action}`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ peerId: me.peerId, secret: me.secret, ...body }),
  });
  let j = {};
  try { j = await r.json(); } catch (_) { /* 空 */ }
  if (!r.ok) throw new Error(j.error || '送れませんでした');
  return j;
}

const initial = (name) => (name || '?').trim().slice(0, 1).toUpperCase();
const isHost = () => me.role === 'host';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function fmtWhen(start, end) {
  if (!start) return '';
  const s = new Date(start); if (isNaN(s)) return '';
  const hm = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  let t = `${s.getMonth() + 1}月${s.getDate()}日（${'日月火水木金土'[s.getDay()]}）${hm(s)}`;
  const e = end ? new Date(end) : null;
  if (e && !isNaN(e)) t += `〜${hm(e)}`;
  return t;
}

function setRound(btn, on, iconOn, iconOff) { btn.innerHTML = on ? iconOn : iconOff; btn.classList.toggle('off', !on); btn.setAttribute('aria-pressed', String(on)); }

function modal(title, bodyNode, actions) {
  return new Promise((resolve) => {
    $('modalTitle').textContent = title;
    const body = $('modalBody'); body.textContent = '';
    if (typeof bodyNode === 'string') body.appendChild(el('p', '', bodyNode)); else body.appendChild(bodyNode);
    const box = $('modalActions'); box.textContent = '';
    for (const [label, value, cls] of actions) {
      const b = el('button', `btn ${cls || ''}`, label);
      b.onclick = () => { $('modal').classList.add('hidden'); resolve(value); };
      box.appendChild(b);
    }
    $('modal').classList.remove('hidden');
    if (box.lastChild) box.lastChild.focus();
  });
}

// ---------- 端末（カメラ・マイク・スピーカー） ----------
async function openDevices() {
  const notice = $('mediaNotice');
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(devices.mic ? { deviceId: { exact: devices.mic } } : {}) };
  const video = { width: { ideal: 1280 }, height: { ideal: 720 }, ...(devices.cam ? { deviceId: { exact: devices.cam } } : { facingMode: 'user' }) };
  const old = camStream;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ audio, video });
    notice.classList.add('hidden');
  } catch (e) {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ audio });
      camOn = false;
      notice.textContent = 'カメラが使えないため、音声だけで参加します。';
      notice.classList.remove('hidden', 'error');
    } catch (e2) {
      camStream = new MediaStream();
      micOn = false; camOn = false;
      notice.textContent = 'カメラとマイクが使えません。ブラウザのアドレス欄の左にある鍵のマークから許可すると使えます。このまま見る・聞くだけで参加することもできます。';
      notice.classList.add('error');
      notice.classList.remove('hidden');
    }
  }
  if (old) old.getTracks().forEach((t) => t.stop());
  $('preview').srcObject = camStream;
  const a = audioTrack(); const v = camTrack();
  $('micName').textContent = a ? (a.label || '使用できます').replace(/\s*\(.*?\)\s*$/, '') : '使えません';
  $('camName').textContent = v ? (v.label || '使用できます').replace(/\s*\(.*?\)\s*$/, '') : '使えません';
  $('micChip').classList.toggle('ng', !a); $('camChip').classList.toggle('ng', !v);
  startMeter();
  refreshLocal();
}

function startMeter() {
  const a = audioTrack();
  if (!a) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(new MediaStream([a]));
    const an = audioCtx.createAnalyser(); an.fftSize = 256; src.connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    const loop = () => {
      if (!$('lobby').classList.contains('hidden')) {
        an.getByteFrequencyData(buf);
        const v = Math.min(100, buf.reduce((x, y) => x + y, 0) / buf.length * 1.6);
        $('meterBar').style.width = `${micOn ? v : 0}%`;
        requestAnimationFrame(loop);
      }
    };
    loop();
  } catch (_) { /* 音量の表示は無くても動く */ }
}

const audioTrack = () => (camStream && camStream.getAudioTracks()[0]) || null;
const camTrack = () => (camStream && camStream.getVideoTracks()[0]) || null;
function outgoingVideo() { if (screenStream) return screenStream.getVideoTracks()[0] || null; return camOn ? camTrack() : null; }

function refreshLocal() {
  const a = audioTrack(); if (a) a.enabled = micOn;
  const v = camTrack(); if (v) v.enabled = camOn;
  setRound($('pMic'), micOn, ICON.mic, ICON.micOff);
  setRound($('pCam'), camOn, ICON.cam, ICON.camOff);
  setRound($('mic'), micOn, ICON.mic, ICON.micOff);
  setRound($('cam'), camOn, ICON.cam, ICON.camOff);
  $('pMic').disabled = $('mic').disabled = !a;
  $('pCam').disabled = $('cam').disabled = !v;
  $('previewOff').classList.toggle('hidden', camOn && !!v);
  $('screen').classList.toggle('on', !!screenStream);
  $('screen').disabled = !isHost() && !room.perms.guestScreen;
  $('screen').title = $('screen').disabled ? '画面共有は担当者の許可が必要です' : '画面を共有';
  if (!inCall) return;
  for (const p of peers.values()) {
    for (const t of p.pc.getTransceivers()) {
      const kind = t.receiver.track && t.receiver.track.kind;
      if (kind === 'video') t.sender.replaceTrack(outgoingVideo()).catch(() => {});
      if (kind === 'audio') t.sender.replaceTrack(audioTrack()).catch(() => {});
    }
  }
  updateSelfTile();
  post('state', { mic: micOn, cam: camOn && !!v, screen: !!screenStream }).catch(() => {});
}

async function deviceDialog() {
  const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const wrap = el('div');
  const mk = (label, kind, key) => {
    const f = el('div', 'field');
    const s = document.createElement('select'); s.dataset.key = key;
    const opts = list.filter((d) => d.kind === kind);
    if (!opts.length) { s.appendChild(el('option', '', '見つかりません')); s.disabled = true; }
    opts.forEach((d, i) => { const o = el('option', '', d.label || `${label} ${i + 1}`); o.value = d.deviceId; if (d.deviceId === devices[key]) o.selected = true; s.appendChild(o); });
    f.append(el('label', '', label), s); wrap.appendChild(f);
  };
  mk('マイク', 'audioinput', 'mic');
  mk('カメラ', 'videoinput', 'cam');
  const canSink = 'setSinkId' in HTMLMediaElement.prototype;
  if (canSink) mk('スピーカー', 'audiooutput', 'speaker');
  else wrap.appendChild(el('p', 'muted small', 'この端末では、スピーカーは端末の設定で切り替えてください。'));
  const ok = await modal('カメラ・マイクの設定', wrap, [['やめる', false, 'ghost'], ['反映する', true, 'primary']]);
  if (!ok) return;
  for (const s of wrap.querySelectorAll('select')) if (!s.disabled) devices[s.dataset.key] = s.value;
  await openDevices();
  if (canSink && devices.speaker) for (const v of document.querySelectorAll('.tile video')) v.setSinkId(devices.speaker).catch(() => {});
}

// ---------- 画面の並び ----------
function makeTile(id, name, role, isSelf) {
  const tile = el('div', 'tile' + (isSelf ? ' self' : ''));
  tile.dataset.id = id;
  tile.innerHTML = '<video autoplay playsinline></video><div class="avatar"><span></span></div><div class="name"><span class="mic"></span><span class="nm"></span><span class="role"></span><span class="hand hidden"></span></div><div class="q" title="回線"></div><div class="status hidden"></div>';
  tile.querySelector('.avatar span').textContent = initial(name);
  tile.querySelector('.nm').textContent = isSelf ? `${name}（あなた）` : name;
  if (role === 'host') tile.querySelector('.role').textContent = '担当';
  tile.querySelector('.hand').innerHTML = ICON.hand;
  if (isSelf) tile.querySelector('video').muted = true;
  else if (devices.speaker && tile.querySelector('video').setSinkId) tile.querySelector('video').setSinkId(devices.speaker).catch(() => {});
  tile.addEventListener('dblclick', () => togglePin(tile));
  $('stage').appendChild(tile);
  layout();
  return tile;
}

function togglePin(tile) {
  const was = tile.classList.contains('pinned');
  document.querySelectorAll('.tile.pinned').forEach((t) => t.classList.remove('pinned'));
  if (!was) tile.classList.add('pinned');
  layout();
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
  const featured = tiles.find((t) => t.classList.contains('pinned'))
    || tiles.find((t) => t.classList.contains('screen') && !t.classList.contains('self'))
    || tiles.find((t) => t.classList.contains('screen'));
  tiles.forEach((t) => t.classList.toggle('featured', t === featured && tiles.length > 1));
  stage.className = `stage n${n}` + (featured && tiles.length > 1 ? ' spotlight' : '') + (wbOpen ? ' strip' : '');
  if (featured && tiles.length > 1) stage.prepend(featured);
  // 画面共有している人（書き込みの対象）
  const shareTile = tiles.find((t) => t.classList.contains('screen') && !t.classList.contains('self'))
    || tiles.find((t) => t.classList.contains('screen'));
  const newSharer = shareTile ? shareTile.dataset.id : null;
  if (newSharer !== sharerId) {
    // 共有が止まった・別の人に替わったときだけ書き込みを消す。
    // 「共有が始まった」の知らせより先に書き込みが届くことがあるので、始まったときは消さない
    if (sharerId && typeof annBoard !== 'undefined') { annBoard.shapes = []; annBoard.dirty = true; }
    sharerId = newSharer;
    if (!sharerId && annOn) setAnn(false);
  }
  $('annBtn').classList.toggle('hidden', !sharerId);
  updateAlone();
}

function updateAlone() {
  const alone = inCall && peers.size === 0 && !wbOpen;
  $('alone').classList.toggle('hidden', !alone);
  if (!alone) return;
  if (isHost()) {
    $('aloneTitle').textContent = waiting.size ? `${waiting.size} 名が入室を待っています` : 'お客様の入室を待っています';
    $('aloneText').textContent = 'お客様がリンクを開いて「参加する」を押すと、右上に通知が出ます。';
    $('aloneUrl').textContent = `${location.host}/r/${roomId}`;
  } else {
    $('aloneTitle').textContent = 'まもなく始まります';
    $('aloneText').textContent = 'ほかの参加者が入室すると、ここに映像が表示されます。';
  }
}

// ---------- 接続（WebRTC） ----------
function createPeer(id, name, role, initiator) {
  const pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 2 });
  const stream = new MediaStream();
  const tile = makeTile(id, name, role, false);
  tile.querySelector('video').srcObject = stream;
  const peer = { pc, name, role, stream, tile, pending: [], state: { mic: true, cam: true, screen: false }, initiator, queue: [], stats: {} };
  peers.set(id, peer);

  // 書き込み用のデータチャネル（両者が同じ番号で作るので、待ち合わせが要らない）
  const dc = pc.createDataChannel('board', { negotiated: true, id: 0, ordered: true });
  peer.dc = dc;
  dc.onopen = () => {
    if (isHost()) { // 主催者は、後から入った人にいまの書き込みを渡す
      for (const op of wbBoard.assetOps()) sendTo(peer, { k: 'wb', ...op });
      sendTo(peer, { k: 'wb', ...wbBoard.snapshot() });
      sendTo(peer, { k: 'ann', ...annBoard.snapshot() });
      if (wbShownToAll) sendTo(peer, { k: 'wb', op: 'show' });
    }
  };
  dc.onmessage = (e) => onData(id, e.data);
  dc.bufferedAmountLowThreshold = 256 * 1024;
  dc.onbufferedamountlow = () => pump(peer);

  let iceBuf = []; let iceTimer = null;
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    iceBuf.push(e.candidate.toJSON ? e.candidate.toJSON() : e.candidate);
    if (!iceTimer) iceTimer = setTimeout(() => { const list = iceBuf; iceBuf = []; iceTimer = null; post('signal', { to: id, data: { type: 'ice', candidates: list } }).catch(() => {}); }, 150);
  };
  pc.ontrack = (e) => {
    stream.getTracks().filter((t) => t.kind === e.track.kind).forEach((t) => stream.removeTrack(t));
    stream.addTrack(e.track);
    const v = tile.querySelector('video'); v.srcObject = stream; v.play().catch(() => {});
    if (e.track.kind === 'audio') watchSpeaking(peer, e.track);
  };
  pc.onconnectionstatechange = () => {
    const st = tile.querySelector('.status');
    const s = pc.connectionState;
    st.classList.toggle('hidden', s === 'connected');
    st.textContent = s === 'failed' ? 'つなぎ直しています' : s === 'disconnected' ? '回線が不安定です' : '接続中';
    if (s === 'failed') restartWith(id);
    if (s === 'disconnected') setTimeout(() => { if (pc.connectionState === 'disconnected') restartWith(id); }, 4000);
  };

  if (initiator) {
    pc.addTransceiver('audio', { direction: 'sendrecv' }).sender.replaceTrack(audioTrack());
    pc.addTransceiver('video', { direction: 'sendrecv' }).sender.replaceTrack(outgoingVideo());
    makeOffer(id).catch(() => {});
  }
  return peer;
}

async function makeOffer(id, opts) {
  const p = peers.get(id); if (!p) return;
  const offer = await p.pc.createOffer(opts);
  await p.pc.setLocalDescription(offer);
  await post('signal', { to: id, data: { type: 'offer', sdp: p.pc.localDescription.sdp } });
}

// 接続が切れたら、最初に offer を出した側が ICE をやり直す（相手側からは依頼だけ出す）
async function restartWith(id) {
  const p = peers.get(id); if (!p) return;
  if (Date.now() - (p.lastRestart || 0) < 5000) return;
  p.lastRestart = Date.now();
  await refreshIce();
  try { p.pc.setConfiguration({ iceServers }); } catch (_) { /* 古いブラウザ */ }
  if (p.initiator) makeOffer(id, { iceRestart: true }).catch(() => {});
  else post('signal', { to: id, data: { type: 'restart' } }).catch(() => {});
}

async function onSignal({ from, data }) {
  let p = peers.get(from);
  if (data.type === 'resync') {
    // 相手がページを開き直した：古い接続を捨てて、相手からの offer を待つ
    const info = rosterInfo.get(from) || (p && { name: p.name, role: p.role }) || { name: '参加者', role: 'guest' };
    if (p) dropPeer(from, true);
    createPeer(from, info.name, info.role, false);
    return;
  }
  if (data.type === 'restart') { if (p && p.initiator) makeOffer(from, { iceRestart: true }).catch(() => {}); return; }
  if (data.type === 'offer') {
    if (!p) { const info = rosterInfo.get(from) || { name: '参加者', role: 'guest' }; p = createPeer(from, info.name, info.role, false); }
    await p.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
    for (const t of p.pc.getTransceivers()) {
      if (t.stopped) continue;
      t.direction = 'sendrecv';
      const kind = t.receiver.track && t.receiver.track.kind;
      await t.sender.replaceTrack(kind === 'audio' ? audioTrack() : outgoingVideo());
    }
    await flushIce(p);
    await p.pc.setLocalDescription(await p.pc.createAnswer());
    await post('signal', { to: from, data: { type: 'answer', sdp: p.pc.localDescription.sdp } });
  } else if (data.type === 'answer' && p) {
    if (p.pc.signalingState === 'have-local-offer') await p.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
    await flushIce(p);
  } else if (data.type === 'ice' && p) {
    for (const c of data.candidates || []) {
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(c).catch(() => {});
      else p.pending.push(c);
    }
  }
}

async function flushIce(p) { for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {}); }

function dropPeer(id, quiet) {
  const p = peers.get(id); if (!p) return;
  try { if (p.dc) p.dc.close(); } catch (_) { /* 既に閉じている */ }
  p.pc.close(); p.tile.remove(); peers.delete(id);
  layout();
  if (!quiet) renderPeople();
}

async function refreshIce() {
  if (!me.peerId) return;
  try {
    const r = await fetch(api(`/ice?peerId=${encodeURIComponent(me.peerId)}`), { headers: { 'X-Peer-Secret': me.secret } });
    if (r.ok) { const j = await r.json(); if (Array.isArray(j.iceServers)) iceServers = j.iceServers; }
  } catch (_) { /* STUN だけで続ける */ }
}

// ---------- 話している人の強調・回線の状態 ----------
function watchSpeaking(peer, track) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(new MediaStream([track]));
    const an = audioCtx.createAnalyser(); an.fftSize = 512; src.connect(an);
    peer.analyser = an;
  } catch (_) { /* 強調表示は無くても動く */ }
}

setInterval(() => {
  const buf = new Uint8Array(256);
  for (const p of peers.values()) {
    if (!p.analyser) continue;
    p.analyser.getByteFrequencyData(buf);
    const v = buf.reduce((x, y) => x + y, 0) / buf.length;
    p.tile.classList.toggle('speaking', v > 18 && p.state.mic !== false);
  }
}, 300);

// 3 秒ごとに、往復時間と取りこぼしから回線の状態を判定する
setInterval(async () => {
  if (!inCall) return;
  let worst = 0;
  for (const p of peers.values()) {
    if (p.pc.connectionState !== 'connected') continue;
    try {
      const st = await p.pc.getStats();
      let rtt = 0; let lost = 0; let recv = 0; let relay = false;
      const byId = new Map(); st.forEach((r) => byId.set(r.id, r));
      st.forEach((r) => {
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) {
          rtt = r.currentRoundTripTime || rtt;
          const lc = byId.get(r.localCandidateId); if (lc && lc.candidateType === 'relay') relay = true;
        }
        if (r.type === 'inbound-rtp' && !r.isRemote) { lost += r.packetsLost || 0; recv += r.packetsReceived || 0; }
      });
      const prev = p.stats;
      const dl = lost - (prev.lost || 0); const dr = recv - (prev.recv || 0);
      const lossRate = dr + dl > 0 ? dl / (dr + dl) : 0;
      p.stats = { lost, recv, rtt, lossRate, relay };
      const level = rtt > 0.45 || lossRate > 0.08 ? 2 : rtt > 0.25 || lossRate > 0.03 ? 1 : 0;
      worst = Math.max(worst, level);
      const q = p.tile.querySelector('.q');
      q.className = `q l${level}`;
      q.title = `往復 ${Math.round(rtt * 1000)}ms・取りこぼし ${(lossRate * 100).toFixed(1)}%${relay ? '・中継サーバー経由' : ''}`;
    } catch (_) { /* 統計が取れないブラウザ */ }
  }
  const nb = $('netBadge');
  nb.textContent = peers.size ? ['回線 良好', '回線 やや不安定', '回線 不安定'][worst] : '';
  nb.className = `net l${worst}`;
}, 3000);

window.addEventListener('online', () => { if (!inCall) return; for (const id of peers.keys()) restartWith(id); toast('ネットワークが戻りました。つなぎ直しています'); });
window.addEventListener('offline', () => { if (inCall) toast('ネットワークが切れました。戻ると自動でつなぎ直します', null, 6000); });

// ---------- データチャネル（書き込み） ----------
function sendTo(peer, obj) {
  if (!peer.dc || peer.dc.readyState !== 'open') return;
  const s = JSON.stringify(obj);
  const max = Math.max(16000, Math.min(60000, ((peer.pc.sctp && peer.pc.sctp.maxMessageSize) || 65536) - 2000));
  if (s.length <= max) peer.queue.push(s);
  else if (obj.op === 'asset') { // 大きな画像は分けて送る
    const size = max - 500;
    const n = Math.ceil(obj.data.length / size);
    for (let i = 0; i < n; i++) peer.queue.push(JSON.stringify({ k: obj.k, op: 'asset-chunk', id: obj.id, i, n, data: obj.data.slice(i * size, (i + 1) * size) }));
  } else return;
  pump(peer);
}
function pump(peer) { while (peer.queue.length && peer.dc.readyState === 'open' && peer.dc.bufferedAmount < 1024 * 1024) peer.dc.send(peer.queue.shift()); }
function broadcast(obj) { for (const p of peers.values()) sendTo(p, obj); }

function onData(fromId, raw) {
  if (typeof raw !== 'string' || raw.length > 200000) return;
  let m; try { m = JSON.parse(raw); } catch (_) { return; }
  const p = peers.get(fromId); if (!p) return;
  const from = { id: fromId, role: p.role }; // 役割はサーバーが知らせたものを使う（相手の自己申告は信じない）
  if (m.k === 'ann') annBoard.receive(m, from, from.role === 'host' || room.perms.guestAnnotate);
  if (m.k === 'wb') {
    if (m.op === 'show') { if (from.role === 'host' && !wbOpen) { setWb(true); toast(`${p.name} さんがホワイトボードを開きました`); } return; }
    wbBoard.receive(m, from, from.role === 'host' || room.perms.guestBoard);
  }
}

// ---------- 書き込みの道具 ----------
function stageRelRect(node) {
  const c = $('annCanvas').getBoundingClientRect();
  const r = node.getBoundingClientRect();
  return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
}
function shareVideo() {
  const t = sharerId && document.querySelector(`.tile[data-id="${CSS.escape(sharerId)}"]`);
  return t ? t.querySelector('video') : null;
}
// 共有映像が実際に映っている枠（object-fit: contain の黒帯を除いた部分）
function annRect() {
  const v = shareVideo();
  if (!v) return { x: 0, y: 0, w: 1, h: 1 };
  const r = stageRelRect(v);
  const vw = v.videoWidth || 16; const vh = v.videoHeight || 9;
  const s = Math.min(r.w / vw, r.h / vh);
  return { x: r.x + (r.w - vw * s) / 2, y: r.y + (r.h - vh * s) / 2, w: vw * s, h: vh * s };
}
function wbRect() {
  const cv = $('wbCanvas');
  const W = cv.clientWidth; const H = cv.clientHeight;
  const bg = wbBoard && wbBoard.background && wbBoard.images.get(wbBoard.background);
  const aspect = bg ? bg.width / bg.height : 1.6;
  const pad = 12;
  const s = Math.max(1, Math.min((W - pad * 2) / aspect, H - pad * 2));
  return { x: (W - s * aspect) / 2, y: (H - s) / 2, w: s * aspect, h: s };
}

const meInfo = () => ({ id: me.peerId, name: me.name, role: me.role });
const annBoard = new Board({
  canvas: $('annCanvas'), layer: 'ann', me: meInfo,
  canDraw: () => isHost() || room.perms.guestAnnotate, canEditOthers: () => true,
  send: (op) => broadcast({ k: 'ann', ...op }), getRect: annRect, onAuthors: (a) => renderAuthors(a, 'ann'),
});
const wbBoard = new Board({
  canvas: $('wbCanvas'), layer: 'wb', me: meInfo,
  canDraw: () => isHost() || room.perms.guestBoard, canEditOthers: () => true,
  send: (op) => broadcast({ k: 'wb', ...op }), getRect: wbRect, onAuthors: (a) => renderAuthors(a, 'wb'),
});
let wbShownToAll = false;
const activeBoard = () => (wbOpen ? wbBoard : annBoard);

function renderAuthors(list, layer) {
  if ((layer === 'wb') !== wbOpen) return;
  const box = $('authors'); box.textContent = '';
  for (const a of list) {
    const s = el('span', 'author');
    const dot = el('i'); dot.style.background = a.color;
    s.append(dot, document.createTextNode(a.name));
    box.appendChild(s);
  }
}

const TOOL_LABELS = [['pen', 'ペン'], ['arrow', '矢印'], ['rect', '四角'], ['ellipse', '丸'], ['text', '文字'], ['note', '付箋'], ['eraser', '消しゴム'], ['move', '移動']];
function buildToolbar() {
  for (const [t, label] of TOOL_LABELS) {
    const b = el('button', 'tbtn', label); b.dataset.tool = t;
    if (t === 'note' || t === 'move') b.classList.add('wb-only');
    b.onclick = () => { activeBoard().tool = t; syncToolbar(); };
    $('tools').appendChild(b);
  }
  for (const c of COLORS) {
    const b = el('button', 'swatch'); b.dataset.color = c; b.style.background = c; b.setAttribute('aria-label', `色 ${c}`);
    b.onclick = () => { annBoard.color = c; wbBoard.color = c; syncToolbar(); };
    $('colors').appendChild(b);
  }
  WIDTHS.forEach((w, i) => {
    const b = el('button', 'tbtn wbtn', ['細', '中', '太'][i]); b.dataset.width = w;
    b.onclick = () => { annBoard.width = w; wbBoard.width = w; syncToolbar(); };
    $('widths').appendChild(b);
  });
  $('tUndo').onclick = () => activeBoard().undo();
  $('tClear').onclick = async () => {
    if (isHost()) {
      const v = await modal('書き込みを消去', '全員の書き込みを消しますか？自分の書き込みだけを消すこともできます。', [['やめる', null, 'ghost'], ['自分の分だけ', 'mine'], ['全員の分', 'all', 'danger']]);
      if (v) activeBoard().clear(v);
    } else activeBoard().clear('mine');
  };
  $('tSave').onclick = () => {
    const url = activeBoard().exportPng(wbOpen ? null : shareVideo());
    const a = document.createElement('a'); a.href = url; a.download = `${wbOpen ? 'ホワイトボード' : '書き込み'}_${new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '')}.png`; a.click();
    if (wbOpen && isHost() && staff) saveBoardToRecord();
  };
  $('tImage').onclick = () => $('fileImage').click();
  $('tBg').onclick = () => $('fileBg').click();
  $('fileImage').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadFile(f, false); };
  $('fileBg').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadFile(f, true); };
  $('tShow').onclick = () => { wbShownToAll = true; broadcast({ k: 'wb', op: 'show' }); toast('全員の画面にホワイトボードを開きました'); };
}

async function loadFile(f, asBg) {
  try {
    const { dataUrl, aspect } = f.type === 'application/pdf' ? await pdfToDataUrl(f) : await fileToDataUrl(f);
    if (asBg) wbBoard.setBackground(dataUrl); else wbBoard.addImage(dataUrl, aspect);
  } catch (e) { toast(e.message, null, 6000); }
}

async function saveBoardToRecord() {
  const r = await fetch(`/api/meetings/${roomId}/board`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board: wbBoard.toJSON() }) }).catch(() => null);
  if (r && r.ok) toast('ホワイトボードを打ち合わせ記録にも保存しました');
}

function syncToolbar() {
  const b = activeBoard();
  for (const n of document.querySelectorAll('#tools .tbtn')) n.classList.toggle('on', n.dataset.tool === b.tool);
  for (const n of document.querySelectorAll('#colors .swatch')) n.classList.toggle('on', n.dataset.color === b.color);
  for (const n of document.querySelectorAll('#widths .tbtn')) n.classList.toggle('on', Number(n.dataset.width) === b.width);
  const tb = $('toolbar');
  tb.classList.toggle('hidden', !(annOn || wbOpen));
  tb.classList.toggle('is-wb', wbOpen);
  tb.classList.toggle('as-host', isHost());
  tb.classList.toggle('readonly', wbOpen && !isHost() && !room.perms.guestBoard);
}

function setAnn(on) {
  annOn = !!on && !!sharerId && (isHost() || room.perms.guestAnnotate);
  if (on && !annOn && sharerId) toast('書き込みは担当者の許可が必要です');
  if (annOn && wbOpen) setWb(false);
  annBoard.setEnabled(annOn);
  $('annBtn').classList.toggle('on', annOn);
  if (annBoard.tool === 'note' || annBoard.tool === 'move') annBoard.tool = 'pen';
  syncToolbar();
}

function setWb(on) {
  wbOpen = !!on;
  if (wbOpen) { annOn = false; annBoard.setEnabled(false); $('annBtn').classList.remove('on'); }
  $('wb').classList.toggle('hidden', !wbOpen);
  $('wbBtn').classList.toggle('on', wbOpen);
  wbBoard.setEnabled(wbOpen && (isHost() || room.perms.guestBoard));
  wbBoard.dirty = true;
  layout(); syncToolbar(); wbBoard._authors();
}

// ---------- 入室 ----------
async function join() {
  me.name = $('name').value.trim();
  if (!me.name) { $('name').focus(); return toast('お名前を入力してください'); }
  try { localStorage.setItem('meet.name', me.name); } catch (_) { /* 保存できなくても続ける */ }
  $('joinBtn').disabled = true;
  try {
    const res = await fetch(api('/join'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: me.name, pin: $('pin').value.trim() || undefined, hostToken: hostToken || undefined }),
    });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || '参加できませんでした');
    Object.assign(me, { peerId: r.peerId, secret: r.secret, role: r.role, name: r.name });
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ peerId: me.peerId, secret: me.secret, role: me.role, name: me.name })); } catch (_) { /* 保存できなくても続ける */ }
    if (r.waiting) showWaiting(null);
    listen();
  } catch (e) {
    $('joinBtn').disabled = false;
    toast(e.message, null, 6000);
  }
}

function showWaiting(hostPresent) {
  $('waitBox').classList.remove('hidden');
  $('joinBtn').classList.add('hidden');
  $('waitText').textContent = hostPresent === false
    ? '担当者はまだ入室していません。担当者が入室すると、あなたの参加を許可します。このままお待ちください。'
    : '担当者が入室を許可するまで、このままお待ちください。';
}

const handlers = {
  waiting: (d) => showWaiting(d.hostPresent),
  denied: () => { stopAll(); fatal('入室できませんでした', '担当者が入室をお断りしました。お心当たりがない場合は、担当者に直接ご連絡ください。'); },
  kicked: () => { stopAll(); fatal('打ち合わせから退出しました', '担当者によって退出の操作がされました。'); },
  closed: (d) => endedScreen(d.reason),
  admitted: (d) => enterCall(d),
  'peer-joined': ({ id, name, role }) => {
    rosterInfo.set(id, { name, role });
    toast(`${name} さんが参加しました`);
    if (!peers.has(id)) createPeer(id, name, role, false);
    waiting.delete(id);
    renderPeople();
    post('state', { mic: micOn, cam: camOn && !!camTrack(), screen: !!screenStream }).catch(() => {});
  },
  'peer-left': ({ id, reason }) => {
    const p = peers.get(id);
    if (p) toast(reason === 'kicked' ? `${p.name} さんを退出させました` : `${p.name} さんが退出しました`);
    dropPeer(id);
  },
  'peer-state': (s) => { const p = peers.get(s.id); if (!p) return; p.state = s; setTileState(p.tile, s); renderPeople(); },
  signal: (d) => onSignal(d),
  chat: (d) => addChat(d),
  'chat-delete': ({ id, by }) => {
    const node = document.querySelector(`.msg[data-id="${CSS.escape(id)}"]`);
    if (!node) return;
    const byRole = by === me.peerId ? me.role : (peers.get(by) || {}).role;
    if (node.dataset.from === by || byRole === 'host') node.remove();
  },
  knock: (k) => {
    waiting.set(k.id, k); renderPeople();
    beep();
  },
  'knock-cancel': ({ id }) => { waiting.delete(id); renderPeople(); },
  perms: ({ perms, saveChat }) => {
    room.perms = perms; room.saveChat = saveChat;
    if (!isHost() && !perms.guestScreen && screenStream) stopScreen();
    if (!isHost() && !perms.guestAnnotate && annOn) setAnn(false);
    if (!isHost()) wbBoard.setEnabled(wbOpen && perms.guestBoard);
    refreshLocal(); renderPeople(); syncToolbar(); updateChatNote();
  },
  locked: ({ locked }) => { room.locked = locked; $('lockBadge').classList.toggle('hidden', !locked); renderPeople(); },
  muted: ({ by }) => { if (micOn) { micOn = false; refreshLocal(); } toast(`${by} さんがあなたのマイクをオフにしました。話すときはマイクのボタンを押してください。`, null, 6000); },
  'stop-share': ({ by }) => { if (screenStream) { stopScreen(); toast(`${by} さんの操作で画面共有を止めました`); } },
  react: ({ id, name, kind }) => floatReaction(name, kind, id),
  hand: ({ id, name, up }) => {
    const t = id === me.peerId ? selfTile : (peers.get(id) || {}).tile;
    if (t) t.querySelector('.hand').classList.toggle('hidden', !up);
    if (up && id !== me.peerId) toast(`${name} さんが手を挙げています`);
  },
  'rec-request': ({ by }) => askConsent(by),
  'rec-state': (r) => { room.recording = r; updateRec(); if (r.declinedBy) toast(`${r.declinedBy} さんが同意されなかったため、文字起こしは行いません`, null, 6000); },
};

function nextDelay() {
  const idle = Date.now() - lastActivity;
  if (!inCall) return 1200;
  if (idle < 15000) return 600;
  const connecting = [...peers.values()].some((p) => p.pc.connectionState !== 'connected');
  return connecting ? 800 : 2500;
}

async function listen() {
  if (polling) return;
  polling = true; lastActivity = Date.now();
  while (polling && me.peerId) {
    try {
      const r = await fetch(api(`/poll?peerId=${encodeURIComponent(me.peerId)}`), { cache: 'no-store', headers: { 'X-Peer-Secret': me.secret } });
      if (r.status === 403 || r.status === 404) {
        polling = false;
        if (inCall) { stopAll(); fatal('通話から外れました', '回線が長く途切れたため、通話から外れました。もう一度参加してください。', [['もう一度参加する', location.pathname, true]]); } else fatal('参加できませんでした', '時間がたちすぎたか、打ち合わせが終了しました。リンクを開き直してください。');
        break;
      }
      if (r.status === 429) { await sleep(1200); continue; }
      const j = await r.json();
      if (failCount >= 3 && inCall) toast('サーバーとの接続が戻りました');
      failCount = 0;
      if (j.events.length) lastActivity = Date.now();
      for (const ev of j.events) {
        const h = handlers[ev.type];
        if (h) { try { await h(ev.data); } catch (e) { console.error(e); } }
        if (!polling) break;
      }
      if (!polling) break;
      if (j.state === 'ended') { endedScreen('ended'); break; }
      if (j.state === 'denied' || j.state === 'kicked') { handlers[j.state](); break; }
      if (j.roster) {
        for (const x of j.roster) rosterInfo.set(x.id, { name: x.name, role: x.role });
        if (inCall) { const present = new Set(j.roster.map((x) => x.id)); for (const id of [...peers.keys()]) if (!present.has(id)) dropPeer(id); }
      }
      if (j.state === 'waiting' && typeof j.hostPresent === 'boolean') showWaiting(j.hostPresent);
    } catch (e) {
      failCount++;
      if (failCount === 3 && inCall) toast('サーバーとの接続を立て直しています', null, 5000);
    }
    await sleep(failCount ? Math.min(5000, 1000 * failCount) : nextDelay());
  }
}

async function enterCall({ you, peers: others, waiting: w, room: r }, resumed) {
  if (inCall) return;
  inCall = true;
  callStart = Date.now();
  document.body.classList.add('in-call');
  if (you) Object.assign(me, { role: you.role, name: you.name });
  if (r) room = { ...room, ...r };
  document.body.classList.toggle('is-host', isHost());
  $('waitBox').classList.add('hidden');
  $('cTitle').textContent = room.title || 'オンライン打ち合わせ';
  document.title = `${room.title || 'オンライン打ち合わせ'} | COMPASS Meet`;
  $('lockBadge').classList.toggle('hidden', !room.locked);
  show('call');
  await refreshIce();
  selfTile = makeTile('self', me.name, me.role, true);
  updateSelfTile();
  for (const x of w || []) waiting.set(x.id, x);
  for (const o of others || []) {
    rosterInfo.set(o.id, { name: o.name, role: o.role });
    if (resumed) await post('signal', { to: o.id, data: { type: 'resync' } }).catch(() => {});
    createPeer(o.id, o.name, o.role, true);
  }
  refreshLocal(); renderPeople(); updateRec(); updateChatNote(); syncToolbar(); tick();
  if (isHost()) loadNotes();
  renderKnockCards();
}

async function decide(id, ok) {
  try { await post(ok ? 'admit' : 'deny', { target: id }); } catch (e) { toast(e.message); }
  waiting.delete(id); renderPeople();
}

function stopAll() {
  polling = false;
  for (const id of [...peers.keys()]) dropPeer(id, true);
  for (const s of [camStream, screenStream]) if (s) s.getTracks().forEach((t) => t.stop());
  stopTranscription();
  inCall = false;
  document.body.classList.remove('in-call');
  try { sessionStorage.removeItem(STORE_KEY); } catch (_) { /* 何もしない */ }
}

function leave() {
  if (me.peerId) navigator.sendBeacon(api('/leave'), new Blob([JSON.stringify({ peerId: me.peerId, secret: me.secret })], { type: 'application/json' }));
  const host = isHost();
  stopAll();
  me.peerId = null;
  fatal('退出しました', 'ご参加ありがとうございました。', host ? [['打ち合わせ記録を開く', `/records#${roomId}`, true], ['もう一度参加する', location.pathname]] : [['もう一度参加する', location.pathname, true]]);
}

function endedScreen(reason) {
  const host = isHost();
  stopAll();
  fatal('打ち合わせは終了しました', reason === 'deleted' ? 'この打ち合わせは担当者によって取り消されました。' : 'ご参加ありがとうございました。', host ? [['打ち合わせ記録を開く', `/records#${roomId}`, true]] : []);
}

async function endForAll() {
  const ok = await modal('打ち合わせを終了', '全員の通話を終了し、このリンクを使えなくします。よろしいですか？', [['やめる', false, 'ghost'], ['全員の通話を終了', true, 'danger']]);
  if (!ok) return;
  try { await post('end', {}); } catch (e) { return toast(e.message); }
  endedScreen('ended');
}

// ---------- 画面共有 ----------
async function toggleScreen() {
  if (screenStream) return stopScreen();
  if (!isHost() && !room.perms.guestScreen) return toast('画面共有は担当者の許可が必要です');
  if (!navigator.mediaDevices.getDisplayMedia) return toast('この端末のブラウザでは画面を共有できません。パソコンの Chrome・Edge・Safari をお使いください。', null, 6000);
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
  } catch (_) { return; }
  const t = screenStream.getVideoTracks()[0];
  if ('contentHint' in t) t.contentHint = 'detail'; // 図面の細い線をつぶさない
  t.onended = stopScreen;
  refreshLocal();
}
function stopScreen() { if (!screenStream) return; screenStream.getTracks().forEach((t) => t.stop()); screenStream = null; refreshLocal(); }

// ---------- 横の欄 ----------
function openSide(tab, keep) {
  // 下のボタンは開く・閉じるの切り替え。欄の中のタブは切り替えるだけ
  if (!keep && sideTab === tab && !$('side').classList.contains('hidden')) return closeSide();
  sideTab = tab;
  $('side').classList.remove('hidden');
  for (const b of document.querySelectorAll('.tab')) { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); }
  $('peoplePane').classList.toggle('hidden', tab !== 'people');
  $('chatPane').classList.toggle('hidden', tab !== 'chat');
  $('chatFoot').classList.toggle('hidden', tab !== 'chat');
  $('notesPane').classList.toggle('hidden', tab !== 'notes');
  if (tab === 'chat') { unread = 0; badge(); $('chatInput').focus(); }
  renderPeople();
  setTimeout(() => { annBoard.dirty = true; wbBoard.dirty = true; }, 50);
}
function closeSide() { sideTab = null; $('side').classList.add('hidden'); setTimeout(() => { annBoard.dirty = true; wbBoard.dirty = true; }, 50); }

function renderPeople() {
  const pane = $('peoplePane'); pane.textContent = '';
  if (isHost() && waiting.size) {
    pane.appendChild(el('div', 'sect', `入室を待っている方（${waiting.size}）`));
    for (const k of waiting.values()) {
      const box = el('div', 'knock');
      box.appendChild(el('div', 'nm', `${k.name} さん`));
      const row = el('div', 'row');
      const ok = el('button', 'btn primary sm', '許可'); ok.onclick = () => decide(k.id, true);
      const ng = el('button', 'btn sm', 'お断り'); ng.onclick = () => decide(k.id, false);
      row.append(ok, ng); box.appendChild(row); pane.appendChild(box);
    }
  }
  const list = [{ id: me.peerId, name: `${me.name}（あなた）`, role: me.role, mic: micOn, self: true }, ...[...peers.entries()].map(([id, p]) => ({ id, name: p.name, role: p.role, mic: p.state.mic !== false, screen: p.state.screen }))];
  pane.appendChild(el('div', 'sect', `参加中（${list.length}）`));
  for (const x of list) {
    const row = el('div', 'person');
    row.appendChild(el('div', 'dot', initial(x.name)));
    const nm = el('div', 'nm', x.name);
    if (x.role === 'host') nm.appendChild(el('span', 'role', '担当'));
    row.appendChild(nm);
    const m = el('div', 'm'); m.innerHTML = x.mic ? '' : ICON.micOff; row.appendChild(m);
    if (isHost() && !x.self && x.role !== 'host') {
      const menu = el('div', 'acts');
      const mute = el('button', 'btn sm ghost', 'ミュート'); mute.onclick = () => post('mute', { target: x.id }).catch((e) => toast(e.message));
      menu.appendChild(mute);
      if (x.screen) { const ss = el('button', 'btn sm ghost', '共有停止'); ss.onclick = () => post('stop-share', { target: x.id }).catch((e) => toast(e.message)); menu.appendChild(ss); }
      const kick = el('button', 'btn sm ghost danger-text', '退出'); kick.dataset.kick = x.id;
      kick.onclick = async () => {
        const ok = await modal('退出させる', `${x.name} さんを打ち合わせから退出させますか？`, [['やめる', false, 'ghost'], ['退出させる', true, 'danger']]);
        if (ok) post('kick', { target: x.id }).catch((e) => toast(e.message));
      };
      menu.appendChild(kick);
      row.appendChild(menu);
    }
    pane.appendChild(row);
  }
  if (isHost()) {
    pane.appendChild(el('div', 'sect', 'お客様にできること'));
    const toggle = (label, key, val, desc) => {
      const lab = el('label', 'switch');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!val; cb.dataset.perm = key;
      cb.onchange = () => post('perms', { [key]: cb.checked }).then((r) => { room.perms = r.perms; room.saveChat = r.saveChat; updateChatNote(); }).catch((e) => { cb.checked = !cb.checked; toast(e.message); });
      const t = el('span', 'lbl', label); if (desc) t.appendChild(el('small', '', desc));
      lab.append(cb, el('span', 'knob'), t); pane.appendChild(lab);
    };
    toggle('画面共有', 'guestScreen', room.perms.guestScreen);
    toggle('画面共有への書き込み', 'guestAnnotate', room.perms.guestAnnotate);
    toggle('ホワイトボードへの書き込み', 'guestBoard', room.perms.guestBoard);
    toggle('チャット', 'chat', room.perms.chat);
    toggle('チャットを記録に保存', 'saveChat', room.saveChat, '保存すると、打ち合わせ記録に残ります');
    pane.appendChild(el('div', 'sect', '打ち合わせの管理'));
    const row = el('div', 'row wrap');
    const lock = el('button', 'btn sm', room.locked ? '入室の締切を解除' : '入室を締め切る');
    lock.onclick = () => post('lock', { locked: !room.locked }).then((r) => { room.locked = r.locked; $('lockBadge').classList.toggle('hidden', !r.locked); renderPeople(); }).catch((e) => toast(e.message));
    const muteAll = el('button', 'btn sm', '全員のマイクをオフ'); muteAll.onclick = () => post('mute', { target: 'all' }).then(() => toast('お客様のマイクをオフにしました')).catch((e) => toast(e.message));
    const end = el('button', 'btn sm danger', '全員の通話を終了'); end.id = 'endAll'; end.onclick = endForAll;
    row.append(lock, muteAll, end); pane.appendChild(row);
  }
  $('peopleBtn').innerHTML = ICON.people + (waiting.size ? `<span class="badge">${waiting.size}</span>` : '');
  renderKnockCards();
  updateAlone();
}

function renderKnockCards() {
  const box = $('kcards'); box.textContent = '';
  if (!isHost() || !inCall) return;
  for (const k of [...waiting.values()].slice(0, 4)) {
    const c = el('div', 'kcard');
    c.appendChild(el('span', 'kc-avatar', initial(k.name)));
    const t = el('div', 'kc-text');
    t.appendChild(el('b', '', `${k.name} さん`));
    t.appendChild(el('small', '', '入室を待っています'));
    const ok = el('button', 'btn sm primary', '許可'); ok.onclick = () => decide(k.id, true);
    const ng = el('button', 'btn sm ghost', 'お断り'); ng.onclick = () => decide(k.id, false);
    c.append(t, ng, ok);
    box.appendChild(c);
  }
  if (waiting.size > 4) box.appendChild(el('div', 'kmore', `ほか ${waiting.size - 4} 名`));
}

// ---------- チャット ----------
function linkify(parent, text) {
  // URL はリンクに。http/https だけを許し、文字はすべて textContent で入れる（埋め込み攻撃の防止）
  const re = /https?:\/\/[^\s<>"'）」]+/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    try {
      const u = new URL(m[0]);
      const a = el('a', '', m[0]); a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      parent.appendChild(a);
    } catch (_) { parent.appendChild(document.createTextNode(m[0])); }
    last = m.index + m[0].length;
  }
  parent.appendChild(document.createTextNode(text.slice(last)));
}

function addChat({ id, from, name, role, text, at, saved }) {
  $('chatEmpty').classList.add('hidden');
  const box = el('div', 'msg'); box.dataset.id = id; box.dataset.from = from;
  const t = new Date(at);
  const who = el('div', 'who');
  who.appendChild(el('span', 'nm', from === me.peerId ? 'あなた' : name));
  if (role === 'host') who.appendChild(el('span', 'role', '担当'));
  who.appendChild(el('span', 'time', `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`));
  if (saved) who.appendChild(el('span', 'saved', '保存'));
  const txt = el('div', 'text'); linkify(txt, text);
  const acts = el('div', 'acts');
  const copy = el('button', 'link', 'コピー'); copy.onclick = () => navigator.clipboard.writeText(text).then(() => toast('コピーしました')).catch(() => {});
  acts.appendChild(copy);
  if (from === me.peerId || isHost()) { const del = el('button', 'link', '削除'); del.onclick = () => post('chat-delete', { id, from }).catch((e) => toast(e.message)); acts.appendChild(del); }
  box.append(who, txt, acts);
  $('chatList').appendChild(box);
  $('chatPane').scrollTop = $('chatPane').scrollHeight;
  if (sideTab !== 'chat' && from !== me.peerId) { unread++; badge(); toast(`${name}：${text.slice(0, 40)}`); }
}
function badge() { $('chatBtn').innerHTML = ICON.chat + (unread ? `<span class="badge">${unread}</span>` : ''); }
function updateChatNote() {
  $('chatEmpty').textContent = room.saveChat ? 'このチャットは打ち合わせ記録に保存されます。' : 'メッセージは参加中の方にだけ表示され、通話が終わると残りません。';
  $('chatInput').disabled = !isHost() && !room.perms.chat;
  $('chatInput').placeholder = $('chatInput').disabled ? 'チャットは現在使えません' : 'メッセージを入力';
}
async function sendChat() {
  const text = $('chatInput').value.trim(); if (!text) return;
  $('chatInput').value = '';
  try { await post('chat', { text }); } catch (e) { toast(e.message); }
}

// ---------- メモ（主催者） ----------
let notesTimer = null; let notesReady = false;
async function loadNotes() {
  const r = await fetch(`/api/meetings/${roomId}`).catch(() => null);
  if (!r || !r.ok) {
    $('notesStatus').textContent = 'メモを保存するには、社員としてログインしてから入室してください。';
    for (const id of ['nCustomer', 'nProject', 'nBody', 'nDecisions', 'nPending', 'nTodos']) $(id).disabled = true;
    return;
  }
  const { meeting: m } = await r.json();
  $('nCustomer').value = m.customerName || ''; $('nProject').value = m.projectId || ''; $('nOwner').value = m.ownerName;
  $('nBody').value = m.notes.body; $('nDecisions').value = m.notes.decisions; $('nPending').value = m.notes.pending; $('nTodos').value = m.notes.todos;
  if (m.board && m.board.data) { try { wbBoard.loadJSON(m.board.data); } catch (_) { /* 読めなければ空のまま */ } }
  notesReady = true;
}
function scheduleNotes() {
  if (!notesReady) return;
  $('notesStatus').textContent = '保存しています…';
  clearTimeout(notesTimer);
  notesTimer = setTimeout(async () => {
    const r = await fetch(`/api/meetings/${roomId}/notes`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName: $('nCustomer').value, projectId: $('nProject').value.trim(), body: $('nBody').value, decisions: $('nDecisions').value, pending: $('nPending').value, todos: $('nTodos').value }),
    }).catch(() => null);
    const t = new Date();
    if (r && r.ok) $('notesStatus').textContent = `保存しました（${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}）`;
    else $('notesStatus').textContent = r ? ((await r.json().catch(() => ({}))).error || '保存できませんでした') : '保存できませんでした（回線をご確認ください）';
  }, 1200);
}

// ---------- リアクション・挙手 ----------
function floatReaction(name, kind, id) {
  const e = el('div', `react k-${kind}`);
  e.appendChild(el('b', '', REACT_LABEL[kind] || kind));
  e.appendChild(el('span', '', id === me.peerId ? 'あなた' : name));
  e.style.left = `${10 + Math.random() * 60}%`;
  $('reactionLayer').appendChild(e);
  setTimeout(() => e.remove(), 3200);
}
function buildReactMenu() {
  const m = $('reactMenu');
  for (const k of config.reactions || Object.keys(REACT_LABEL)) {
    const b = el('button', 'menu-item', REACT_LABEL[k] || k);
    b.onclick = () => { m.classList.add('hidden'); post('react', { kind: k }).catch((e) => toast(e.message)); };
    m.appendChild(b);
  }
  const h = el('button', 'menu-item', '手を挙げる'); h.id = 'handItem';
  h.onclick = () => { m.classList.add('hidden'); handUp = !handUp; h.textContent = handUp ? '手を下げる' : '手を挙げる'; post('hand', { up: handUp }).catch((e) => toast(e.message)); };
  m.appendChild(h);
}

function buildMoreMenu() {
  const m = $('moreMenu'); m.textContent = '';
  const add = (label, fn, cls) => { const b = el('button', `menu-item ${cls || ''}`, label); b.onclick = () => { m.classList.add('hidden'); fn(); }; m.appendChild(b); };
  if (window.matchMedia('(max-width: 720px)').matches) {
    // スマートフォンでは、リアクション・挙手をこのメニューに入れる（ボタンが画面からはみ出さないように）
    for (const k of config.reactions || Object.keys(REACT_LABEL)) add(`リアクション：${REACT_LABEL[k] || k}`, () => post('react', { kind: k }).catch((e) => toast(e.message)));
    add(handUp ? '手を下げる' : '手を挙げる', () => { handUp = !handUp; post('hand', { up: handUp }).catch((e) => toast(e.message)); });
  }
  add('カメラ・マイクの設定', deviceDialog);
  if (/Android|iPhone|iPad/.test(navigator.userAgent)) add('カメラを切り替える（前・後）', flipCamera);
  add('全画面表示', () => { const s = $('stagewrap'); if (document.fullscreenElement) document.exitFullscreen(); else if (s.requestFullscreen) s.requestFullscreen().catch(() => {}); });
  if (isHost()) {
    add('お客様用のリンクをコピー', () => navigator.clipboard.writeText(`${location.origin}/r/${roomId}`).then(() => toast('お客様用のリンクをコピーしました')).catch(() => {}));
    add(room.recording.state === 'off' ? '文字起こしを依頼する' : '文字起こしを止める', recToggle);
    add('全員の通話を終了', endForAll, 'danger-text');
  }
}

async function flipCamera() {
  const cur = camTrack();
  const facing = cur && cur.getSettings().facingMode === 'environment' ? 'user' : 'environment';
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facing } } });
    const nt = s.getVideoTracks()[0];
    if (cur) { camStream.removeTrack(cur); cur.stop(); }
    camStream.addTrack(nt); refreshLocal();
  } catch (_) { toast('カメラを切り替えられませんでした'); }
}

// ---------- 文字起こしの同意 ----------
function updateRec() {
  const st = room.recording ? room.recording.state : 'off';
  $('recBadge').classList.toggle('hidden', st === 'off');
  $('recBadge').textContent = st === 'active' ? '● 文字起こし中' : st === 'paused' ? '文字起こし一時停止（同意待ち）' : st === 'requested' ? '文字起こしの同意を確認中' : '';
  const consented = (room.recording.consented || []).includes(me.peerId);
  if (st === 'active' && consented) startTranscription(); else stopTranscription();
}

async function askConsent(by) {
  const body = el('div');
  body.appendChild(el('p', '', `${by} さんが、この打ち合わせの文字起こし（音声を文字にして記録すること）を希望しています。`));
  const ul = el('ul', 'small');
  const lines = ['目的：打ち合わせ内容の記録と、議事録の作成のためです。', '同意されない場合、文字起こしは行いません。打ち合わせはそのまま続けられます。', '文字にした内容は、担当者が打ち合わせ記録として保管します。映像は記録しません。'];
  if (config.transcription === 'webspeech') lines.push('文字起こしには、お使いのブラウザの音声認識機能を使います（音声がブラウザ提供元のサーバーに送られる場合があります）。');
  for (const t of lines) ul.appendChild(el('li', '', t));
  body.appendChild(ul);
  const ok = await modal('文字起こしへの同意のお願い', body, [['同意しない', false, 'ghost'], ['同意する', true, 'primary']]);
  post('rec-consent', { accept: ok }).catch((e) => toast(e.message));
}

async function recToggle() {
  if (room.recording.state !== 'off') { post('rec-stop', {}).catch((e) => toast(e.message)); return; }
  if (config.transcription === 'none') {
    modal('文字起こしは準備中です', '文字起こしを使うには、音声を外部のサービスに送ることについて、社内での承認と設定が必要です。設定が済むまでは使えません。', [['閉じる', true, 'primary']]);
    return;
  }
  const ok = await modal('文字起こしを依頼', '参加者全員に同意をお願いします。全員が同意したときだけ文字起こしを始めます。', [['やめる', false, 'ghost'], ['依頼する', true, 'primary']]);
  if (ok) post('rec-request', {}).catch((e) => toast(e.message));
}

let recog = null;
function startTranscription() {
  if (recog || config.transcription !== 'webspeech') return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('このブラウザでは文字起こしができません'); return; }
  recog = new SR(); recog.lang = 'ja-JP'; recog.continuous = true; recog.interimResults = false;
  recog.onresult = (e) => {
    const segs = [];
    for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal && micOn) segs.push({ text: e.results[i][0].transcript });
    if (segs.length) post('transcript', { segments: segs }).catch(() => {});
  };
  recog.onend = () => { if (recog) try { recog.start(); } catch (_) { /* すでに開始済み */ } };
  try { recog.start(); } catch (_) { recog = null; }
}
function stopTranscription() { if (recog) { const r = recog; recog = null; try { r.stop(); } catch (_) { /* 停止済み */ } } }

function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.frequency.value = 880; g.gain.value = 0.04; o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.15);
  } catch (_) { /* 音が出せなくても続ける */ }
}

let callStart = 0;
function tick() {
  if (!inCall) return;
  const sec = Math.floor((Date.now() - callStart) / 1000);
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s2 = sec % 60;
  $('elapsed').textContent = h ? `${h}:${String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')}` : `${m}:${String(s2).padStart(2, '0')}`;
  setTimeout(tick, 1000 - (Date.now() % 1000));
}

// ---------- 起動 ----------
async function boot() {
  if (!/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(roomId)) return fatal('リンクが正しくありません', '送られてきたリンクをもう一度ご確認ください。');
  // 主催者用リンクの合札（#host=...）は読み取ったらアドレス欄から消す（画面共有や履歴に残さない）
  const hm = location.hash.match(/host=([\w-]{20,})/);
  if (hm) { hostToken = hm[1]; history.replaceState(null, '', location.pathname); }
  try {
    const [cfg, info] = await Promise.all([
      fetch('/api/config').then((r) => r.json()),
      fetch(api('')).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; }),
    ]);
    config = cfg; pub = info;
  } catch (e) { return fatal('この打ち合わせは見つかりません', e.message || 'リンクをもう一度ご確認ください。'); }
  if (pub.status === 'ended') return fatal('この打ち合わせは終了しました', 'ご参加ありがとうございました。');
  if (pub.status === 'expired') return fatal('このリンクは有効期限が切れています', '担当者に新しいリンクをお尋ねください。');
  if (pub.youAreHost) { try { const r = await fetch('/api/auth/me'); if (r.ok) staff = (await r.json()).staff; } catch (_) { /* ゲストとして続ける */ } }

  if (!window.RTCPeerConnection || !navigator.mediaDevices) return fatal('このブラウザでは参加できません', 'Chrome・Safari・Edge の新しい版でお開きください。LINE などのアプリの中で開いた場合は、右上のメニューから「ブラウザで開く」を選んでください。');

  for (const [id, icon] of [['screen', ICON.screen], ['annBtn', ICON.pen], ['wbBtn', ICON.board], ['reactBtn', ICON.smile], ['leave', ICON.leave], ['peopleBtn', ICON.people], ['chatBtn', ICON.chat], ['notesBtn', ICON.notes], ['moreBtn', ICON.more], ['pSettings', ICON.gear]]) $(id).innerHTML = icon;
  for (const b of document.querySelectorAll('.round[aria-label]')) b.dataset.tip = b.getAttribute('aria-label');
  buildToolbar(); buildReactMenu(); syncToolbar();
  // 画面共有ができない端末（スマートフォンなど）では、共有のボタンを出さない
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) $('screen').classList.add('hidden');

  // ページを開き直した場合：前の参加を続ける
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null'); } catch (_) { /* 無ければ新規 */ }
  if (saved && saved.peerId) {
    Object.assign(me, saved);
    const resumePoll = () => fetch(api(`/poll?peerId=${encodeURIComponent(me.peerId)}`), { headers: { 'X-Peer-Secret': me.secret } }).catch(() => null);
    await sleep(400); // 開き直す前のページの取得と重ならないように少し待つ
    let r = await resumePoll();
    if (r && r.status === 429) { await sleep(1000); r = await resumePoll(); }
    if (r && r.ok) {
      const j = await r.json();
      if (j.state === 'joined') {
        await openDevices();
        const others = (j.roster || []).filter((x) => x.id !== me.peerId);
        const admitted = j.events.find((e) => e.type === 'admitted');
        await enterCall(admitted ? admitted.data : { you: { role: me.role, name: me.name }, peers: others, room: {} }, true);
        for (const ev of j.events) if (ev.type !== 'admitted' && ev.type !== 'signal' && handlers[ev.type]) handlers[ev.type](ev.data);
        await sleep(400);
        listen();
        return;
      }
      if (j.state === 'waiting') { show('lobby'); await openDevices(); $('name').value = me.name; showWaiting(j.hostPresent); await sleep(400); listen(); return; }
    }
    try { sessionStorage.removeItem(STORE_KEY); } catch (_) { /* 何もしない */ }
    Object.assign(me, { peerId: null, secret: null, role: 'guest' });
  }

  $('lWhen').textContent = fmtWhen(pub.start, pub.end);
  $('hcName').textContent = pub.ownerName;
  $('hcAvatar').textContent = initial(pub.ownerName);
  const asHost = !!(staff || hostToken);
  $('pinField').classList.toggle('hidden', !pub.requiresPin || asHost);
  $('hostNote').classList.toggle('hidden', !asHost);
  if (!asHost && config.googleLogin) {
    $('staffLogin').href = `/api/auth/google/start?returnTo=${encodeURIComponent(location.pathname)}`;
    $('staffLogin').classList.remove('hidden');
  }
  let name = '';
  try { name = localStorage.getItem('meet.name') || ''; } catch (_) { /* 無ければ空 */ }
  $('name').value = staff ? staff.name : name;
  if (staff) $('name').disabled = true;
  const syncName = () => { const n = $('name').value.trim(); $('previewName').textContent = n; $('pvAvatar').textContent = initial(n); };
  $('name').addEventListener('input', syncName); syncName();
  show('lobby');
  await openDevices();
}

$('pMic').onclick = $('mic').onclick = () => { micOn = !micOn; refreshLocal(); renderPeople(); };
$('pCam').onclick = $('cam').onclick = () => { camOn = !camOn; refreshLocal(); };
$('pSettings').onclick = deviceDialog;
$('micChip').onclick = deviceDialog;
$('camChip').onclick = deviceDialog;
$('aloneCopy').onclick = () => navigator.clipboard.writeText(`${location.origin}/r/${roomId}`).then(() => toast('お客様用のリンクをコピーしました')).catch(() => {});
$('screen').onclick = toggleScreen;
$('annBtn').onclick = () => setAnn(!annOn);
$('wbBtn').onclick = () => setWb(!wbOpen);
$('leave').onclick = leave;
$('joinBtn').onclick = join;
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) join(); });
$('peopleBtn').onclick = () => openSide('people');
$('chatBtn').onclick = () => openSide('chat');
$('notesBtn').onclick = () => openSide('notes');
for (const b of document.querySelectorAll('.tab')) b.onclick = () => openSide(b.dataset.tab, true);
$('sideClose').onclick = closeSide;
$('chatSend').onclick = sendChat;
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) sendChat(); });
for (const id of ['nCustomer', 'nProject', 'nBody', 'nDecisions', 'nPending', 'nTodos']) $(id).addEventListener('input', scheduleNotes);
$('reactBtn').onclick = (e) => { e.stopPropagation(); $('moreMenu').classList.add('hidden'); $('reactMenu').classList.toggle('hidden'); };
$('moreBtn').onclick = (e) => { e.stopPropagation(); $('reactMenu').classList.add('hidden'); buildMoreMenu(); $('moreMenu').classList.toggle('hidden'); };
document.addEventListener('click', (e) => { if (!e.target.closest('.popover')) { $('reactMenu').classList.add('hidden'); $('moreMenu').classList.add('hidden'); } });
document.addEventListener('keydown', (e) => {
  if (!inCall || !(e.ctrlKey || e.metaKey)) return;
  if (e.key === 'd') { e.preventDefault(); $('mic').click(); }
  if (e.key === 'e') { e.preventDefault(); $('cam').click(); }
});

// 試験から中の様子を確かめるための窓口（画面の動作には使わない）
window.__meet = { annBoard, wbBoard, peers, me, room: () => room, annRect, wbRect };

boot();
