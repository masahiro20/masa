// 対面の打ち合わせの録音
// 録った分は約 20 秒ごとに受け渡し箱（/api/visits）へ送り、同時にこの端末のブラウザ内にも控えを書く。
// 終了すると、この端末にもファイルを保存する。ドライブ・COMPASS への仕分けは局長の Claude が行う。
import { Recorder, recSupported, leftovers, saveFile } from './recorder.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const KINDS = ['初回接客', '打ち合わせ', '現地調査', '契約', 'その他'];
const FLUSH_BYTES = 360 * 1024;   // これだけ溜まったら送る
const FLUSH_MS = 20000;           // または 20 秒ごと

let audioCtx = null;
const ctx = () => { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; };
const rec = new Recorder(ctx);
let stream = null; let micId = ''; let kind = KINDS[0];
let visit = null; let wakeLock = null; let tick = null;
// 送信の状態
let buf = []; let bufBytes = 0; let lastFlush = 0; let seq = 0;
const parts = new Map(); // seq → { bytes, sent }
let sending = Promise.resolve();

function toast(msg, ms = 4000) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms);
}
function show(id) { for (const s of ['loading', 'needLogin', 'setup', 'live', 'done']) $(s).classList.toggle('hidden', s !== id); }
const fmt = (ms) => { const t = Math.floor(ms / 1000); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = t % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
const api = async (path, opts = {}) => {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 409) throw Object.assign(new Error(j.error || `エラー（${r.status}）`), { status: r.status });
  return { status: r.status, ...j };
};
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- マイク ----------
async function openMic(id) {
  const c = { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1, ...(id ? { deviceId: { exact: id } } : {}) };
  const s = await navigator.mediaDevices.getUserMedia({ audio: c });
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = s;
  const t = s.getAudioTracks()[0];
  micId = (t.getSettings && t.getSettings().deviceId) || id || '';
  $('vMicName').textContent = (t.label || 'マイク').replace(/^(既定|Default)\s*-\s*/i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
  if (rec.active) rec.setLocal(t);
  meter($('vMeter'), t);
  try { localStorage.setItem('meet.visit.mic', micId); } catch (_) { /* 何もしない */ }
}
function meter(bar, track) {
  try {
    const c = ctx(); if (c.state === 'suspended') c.resume().catch(() => {});
    const src = c.createMediaStreamSource(new MediaStream([track]));
    const an = c.createAnalyser(); an.fftSize = 512; src.connect(an);
    const data = new Uint8Array(an.fftSize); let lv = 0;
    const loop = () => {
      if (!stream || stream.getAudioTracks()[0] !== track) { src.disconnect(); return; }
      an.getByteTimeDomainData(data); let p = 0; for (const x of data) p = Math.max(p, Math.abs(x - 128));
      lv = Math.max(p / 64, lv * 0.86); const v = Math.min(1, lv);
      bar.style.setProperty('--lv', rec.paused ? 0 : v.toFixed(3));
      $('vRing').style.setProperty('--lv', rec.paused ? 0 : v.toFixed(3));
      requestAnimationFrame(loop);
    };
    loop();
  } catch (_) { /* 表示できなくても録音はできる */ }
}
async function micMenu(anchor) {
  const m = $('devMenu');
  if (!m.classList.contains('hidden')) { m.classList.add('hidden'); return; }
  m.textContent = '';
  const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const head = el('div', 'dm-head'); head.appendChild(el('span', 'dm-title', 'マイク')); m.appendChild(head);
  for (const d of list) {
    const b = el('button', 'dm-item'); b.type = 'button'; b.classList.toggle('on', d.deviceId === micId);
    b.appendChild(el('span', 'dm-radio')); b.appendChild(el('span', 'dm-label', (d.label || 'マイク').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')));
    b.onclick = async () => { m.classList.add('hidden'); try { await openMic(d.deviceId); } catch (_) { toast('そのマイクは使えませんでした'); } };
    m.appendChild(b);
  }
  m.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.left))}px`;
  m.style.top = `${Math.min(innerHeight - m.offsetHeight - 8, r.bottom + 8)}px`; m.style.bottom = '';
}

// ---------- 送信（受け渡し箱）----------
function onChunk(blob) {
  buf.push(blob); bufBytes += blob.size;
  if (bufBytes >= FLUSH_BYTES || Date.now() - lastFlush >= FLUSH_MS) flush();
}
function flush() {
  if (!buf.length || !visit) return sending;
  const blobs = buf; buf = []; bufBytes = 0; lastFlush = Date.now();
  const mySeq = seq++;
  sending = sending.then(async () => {
    const bytes = new Uint8Array(await new Blob(blobs).arrayBuffer());
    parts.set(mySeq, { bytes, sent: false });
    await sendPart(mySeq);
    updateSync();
  });
  return sending;
}
async function sendPart(n, tries = 3) {
  const p = parts.get(n); if (!p || p.sent) return true;
  for (let i = 0; i < tries; i++) {
    try {
      await api(`/api/visits/${visit.id}/chunk`, { method: 'POST', body: JSON.stringify({ seq: n, data: b64(p.bytes) }) });
      p.sent = true; return true;
    } catch (e) {
      if (e.status && e.status < 500 && e.status !== 429) break;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return false;
}
function updateSync() {
  const total = parts.size; const sent = [...parts.values()].filter((p) => p.sent).length;
  $('vSync').textContent = total === 0 ? '受け渡し箱へ送信の準備中…' : sent === total ? `受け渡し箱へ送信済み（${sent} 件）・この端末にも控えあり` : `受け渡し箱へ送信中（${sent} / ${total}）・送れなかった分は終了時に送り直します`;
  $('vSync').classList.toggle('warn', sent !== total);
}

// ---------- 録音 ----------
async function start() {
  const customer = $('vCustomer').value.trim();
  if (!customer) { $('vCustomer').focus(); return toast('お客様のお名前を入れてください'); }
  if (!recSupported() || !stream) return toast('この端末では録音できません');
  $('vStart').disabled = true;
  try {
    const r = await api('/api/visits', { method: 'POST', body: JSON.stringify({ customerName: customer, title: kind }) });
    visit = r.visit;
  } catch (e) { $('vStart').disabled = false; return toast(e.message); }
  buf = []; bufBytes = 0; lastFlush = Date.now(); seq = 0; parts.clear(); sending = Promise.resolve();
  try {
    await rec.start({ title: `${customer} ${kind}`, local: stream.getAudioTracks()[0], remotes: [], bitrate: 48000, onChunk, meta: { visitId: visit.id, customer, kind } });
  } catch (e) { console.error(e); $('vStart').disabled = false; return toast('録音を始められませんでした'); }
  $('vWho').textContent = `${customer}`; $('vKindLabel').textContent = kind;
  $('vPause').textContent = '一時停止'; $('vState').classList.remove('paused');
  show('live'); $('history').classList.add('hidden');
  updateSync();
  keepAwake();
  clearInterval(tick); tick = setInterval(() => { $('vTimer').textContent = fmt(rec.elapsed); if (Date.now() - lastFlush >= FLUSH_MS) flush(); }, 500);
}

function togglePause() {
  if (rec.paused) { rec.resume(); $('vPause').textContent = '一時停止'; $('vState').classList.remove('paused'); $('vState').lastChild.textContent = '録音中'; }
  else { rec.pause(); $('vPause').textContent = '再開'; $('vState').classList.add('paused'); $('vState').lastChild.textContent = '一時停止中'; }
}

async function stop() {
  $('vStop').disabled = true; $('vPause').disabled = true;
  clearInterval(tick);
  const r = await rec.stop();
  flush();
  await sending;
  // 送れていない分を送り直す
  for (const [n, p] of parts) if (!p.sent) await sendPart(n, 4);
  let finished = null; let sentOk = false;
  try {
    let f = await api(`/api/visits/${visit.id}/finish`, { method: 'POST', body: JSON.stringify({ chunks: parts.size, mime: r.mime, durationMs: r.durationMs, bytes: r.blob.size }) });
    if (f.status === 409 && f.missing) { for (const n of f.missing) await sendPart(n, 4); f = await api(`/api/visits/${visit.id}/finish`, { method: 'POST', body: JSON.stringify({ chunks: parts.size, mime: r.mime, durationMs: r.durationMs, bytes: r.blob.size }) }); }
    sentOk = !!f.ok; finished = f.visit;
  } catch (_) { sentOk = false; }
  // この端末にも保存（いつでも手元に残す）
  const name = fileName(visit.customerName, kind, r.startedAt, r.mime);
  saveFile(r.blob, name);
  if (sentOk) await rec.discardBackup(r.id);
  releaseWake();
  const list = $('vDoneList'); list.textContent = '';
  const item = (okk, text, sub) => { const li = el('li', okk ? 'ok' : 'ng'); li.appendChild(el('b', '', text)); if (sub) li.appendChild(el('small', '', sub)); list.appendChild(li); };
  item(true, `この端末に保存（${fmt(r.durationMs)}）`, `ブラウザの「ダウンロード」：${name}`);
  item(sentOk, sentOk ? '受け渡し箱に送りました' : '受け渡し箱に送れませんでした', sentOk ? 'お客様のドライブのフォルダ（無ければ マイドライブ「録音」）と COMPASS に、局長の Claude が置きます' : '回線を確かめて、下の「最近の録音」から送り直せます。この端末の控えは残してあります');
  $('vStop').disabled = false; $('vPause').disabled = false; $('vStart').disabled = false;
  visit = finished || visit;
  show('done');
  loadHistory();
}

// ファイル名：英数字だけ（日本語の名前はブラウザによって「download」になるため）。お客様名は受け渡し箱の記録に残る
function fileName(_customer, _kind, startedAt, mime) {
  const d = new Date(startedAt); const p = (n) => String(n).padStart(2, '0');
  return `COMPASS-taimen_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}_${visit.id}.${/mp4/.test(mime) ? 'm4a' : 'webm'}`;
}

// 画面が消えると録音が止まる端末があるので、録音中は画面をつけたままにする
async function keepAwake() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (_) { /* 対応していない */ } }
function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (_) { /* 何もしない */ } wakeLock = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && rec.active) { keepAwake(); if (rec.mr && rec.mr.state === 'inactive') toast('画面が閉じている間に録音が止まった可能性があります。止まっていたら、いったん終了して保存してください', 8000); }
});
window.addEventListener('beforeunload', (e) => { if (rec.active) { e.preventDefault(); e.returnValue = '録音が保存されていません'; } });

// ---------- 最近の録音 ----------
const STATUS = (v) => {
  if (v.status === 'recording') return ['録音中か、途中で止まった録音', 'warn'];
  if (v.status === 'filed') return ['置き終わり', 'ok'];
  if (v.drive && v.compass === 'pending') return ['ドライブ済・COMPASS待ち', 'mid'];
  return ['仕分け待ち', 'mid'];
};
async function loadHistory() {
  try {
    const { visits } = await api('/api/visits');
    const box = $('vList'); box.textContent = '';
    if (!visits.length) { box.appendChild(el('p', 'muted small', 'まだありません。')); }
    const names = new Set();
    for (const v of visits) {
      names.add(v.customerName);
      const row = el('div', 'vrow');
      const left = el('div', 'vrow-main');
      left.appendChild(el('b', '', `${v.customerName}`));
      left.appendChild(el('small', 'muted', `${new Date(v.startedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}・${v.title}${v.durationMs ? `・${fmt(v.durationMs)}` : ''}`));
      if (v.drive && v.drive.folder) left.appendChild(el('small', 'muted', `ドライブ：${v.drive.folder}`));
      row.appendChild(left);
      const [label, cls] = STATUS(v);
      row.appendChild(el('span', `vpill ${cls}`, label));
      box.appendChild(row);
    }
    const dl = $('vCustomers'); dl.textContent = '';
    for (const n of names) { const o = document.createElement('option'); o.value = n; dl.appendChild(o); }
    $('history').classList.remove('hidden');
  } catch (_) { /* 一覧が読めなくても録音はできる */ }
}

// 前回、送り切れなかった録音（ブラウザが落ちた等）
async function offerLeftovers() {
  for (const r of await leftovers()) {
    const meta = r.meta || {};
    if (!meta.visitId) continue;
    const box = el('div');
    box.appendChild(el('p', '', `${meta.customer || ''}（${new Date(r.startedAt).toLocaleString('ja-JP')}）の録音が、送り切れずに残っています。`));
    const ans = await modalAsk('送り切れなかった録音があります', box, [['捨てる', 'drop', 'ghost'], ['この端末に保存だけ', 'save', ''], ['保存して送る', 'send', 'primary']]);
    if (ans === 'drop') { await rec.discardBackup(r.id); continue; }
    saveFile(r.blob, `COMPASS-taimen_recovered_${meta.visitId}.${/mp4/.test(r.mime) ? 'm4a' : 'webm'}`);
    if (ans === 'send') {
      try {
        const nv = (await api('/api/visits', { method: 'POST', body: JSON.stringify({ customerName: meta.customer || '不明', title: meta.kind || '対面の打ち合わせ' }) })).visit;
        visit = nv; parts.clear();
        const all = new Uint8Array(await r.blob.arrayBuffer());
        let n = 0; for (let i = 0; i < all.length; i += FLUSH_BYTES, n++) { parts.set(n, { bytes: all.subarray(i, i + FLUSH_BYTES), sent: false }); await sendPart(n, 4); }
        await api(`/api/visits/${nv.id}/finish`, { method: 'POST', body: JSON.stringify({ chunks: parts.size, mime: r.mime, durationMs: 0, bytes: r.blob.size }) });
        toast('受け渡し箱に送りました');
      } catch (_) { toast('送れませんでした。この端末には保存してあります'); continue; }
    }
    await rec.discardBackup(r.id);
  }
  loadHistory();
}
function modalAsk(title, body, actions) {
  return new Promise((resolve) => {
    $('modalTitle').textContent = title; const b = $('modalBody'); b.textContent = ''; b.appendChild(body);
    const box = $('modalActions'); box.textContent = '';
    for (const [label, value, cls] of actions) { const x = el('button', `btn ${cls || ''}`, label); x.onclick = () => { $('modal').classList.add('hidden'); resolve(value); }; box.appendChild(x); }
    $('modal').classList.remove('hidden');
  });
}

// ---------- はじめ ----------
async function init() {
  const me = await fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!me || !me.staff || me.staff.mustChange) return show('needLogin');
  const kinds = $('vKinds');
  for (const k of KINDS) {
    const b = el('button', 'chip', k); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(k === kind)); b.classList.toggle('on', k === kind);
    b.onclick = () => { kind = k; kinds.querySelectorAll('.chip').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); };
    kinds.appendChild(b);
  }
  // 「?customer=〇〇」で開けば、お客様のお名前が入った状態で始められる（COMPASS などから呼ぶ用）
  const q = new URLSearchParams(location.search);
  if (q.get('customer')) $('vCustomer').value = q.get('customer').slice(0, 60);
  show('setup');
  $('vPhoneHint').classList.toggle('hidden', !/Android|iPhone|iPad/.test(navigator.userAgent));
  let saved = ''; try { saved = localStorage.getItem('meet.visit.mic') || ''; } catch (_) { /* 何もしない */ }
  try { await openMic(saved); } catch (_) {
    try { await openMic(''); } catch (e2) { $('vMicName').textContent = 'マイクが使えません'; $('vMicHint').textContent = 'ブラウザのアドレス欄の左にある鍵のマークから、マイクを許可してください。'; $('vStart').disabled = true; }
  }
  loadHistory();
  offerLeftovers();
}

$('vStart').onclick = start;
$('vPause').onclick = togglePause;
$('vStop').onclick = stop;
$('vAgain').onclick = () => { show('setup'); $('vCustomer').value = ''; $('vCustomer').focus(); };
$('vMicChip').onclick = (e) => { e.stopPropagation(); micMenu(e.currentTarget); };
document.addEventListener('click', (e) => { if (!e.target.closest('.devmenu')) $('devMenu').classList.add('hidden'); });
window.__visit = { rec, parts };
init();
