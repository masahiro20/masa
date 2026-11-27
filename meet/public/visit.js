// 対面の打ち合わせの録音
// 録った分は約 20 秒ごとに受け渡し箱（/api/visits）へ送り、同時にこの端末のブラウザ内にも控えを書く。
// 終了すると、この端末にもファイルを保存し、サーバーから本人の Google ドライブへ置く。
// 文字起こしは端末の中だけで行う（使えない端末では表示しない。声は外に送らない）。
import { Recorder, recSupported, leftovers, saveFile } from './recorder.js';
import { Caption, captionSupport, prepareCaption } from './caption.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const KINDS = ['初回接客', '打ち合わせ', '現地調査', '契約', 'その他'];
const FLUSH_BYTES = 256 * 1024;   // これだけ溜まったら送る（保管先の 1 件の上限に余裕を持たせる）
const FLUSH_MS = 10000;           // または 10 秒ごと（電池が切れても、失うのは最後の 10 秒ほど）

let audioCtx = null;
const ctx = () => { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; };
const rec = new Recorder(ctx);
let stream = null; let micId = ''; let kind = KINDS[0];
let visit = null; let wakeLock = null; let tick = null;
// 送信の状態
let buf = []; let bufBytes = 0; let lastFlush = 0; let seq = 0;
const parts = new Map(); // seq → { bytes, sent }
let sending = Promise.resolve();
// 文字起こし・ドライブ
let capSupport = 'unavailable'; let cap = null; let driveSt = { enabled: false, connected: false };
// 途中で止まったときの続き録音
let segNo = 1; let segments = []; let restarting = false; let lastSentText = '';
const wave = []; let waveAt = 0;

function toast(msg, ms = 4000) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms);
}
function show(id) { for (const s of ['loading', 'needLogin', 'setup', 'live', 'done']) $(s).classList.toggle('hidden', s !== id); document.body.dataset.view = id; }
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
  t.addEventListener('ended', () => { if (rec.active && document.visibilityState === 'visible') healMic(); });
  micId = (t.getSettings && t.getSettings().deviceId) || id || '';
  $('vMicName').textContent = (t.label || 'マイク').replace(/^(既定|Default)\s*-\s*/i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
  if (rec.active) rec.setLocal(t);
  if (cap) cap.setTrack(t);
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
      if (rec.active && Date.now() - waveAt > 90) { waveAt = Date.now(); wave.push(rec.paused ? 0 : v); if (wave.length > 40) wave.shift(); drawWave(); }
      requestAnimationFrame(loop);
    };
    loop();
  } catch (_) { /* 表示できなくても録音はできる */ }
}
function drawWave() {
  const box = $('vWave');
  if (box.childElementCount !== 40) { box.textContent = ''; for (let i = 0; i < 40; i++) box.appendChild(document.createElement('i')); }
  const bars = box.children; const off = 40 - wave.length;
  for (let i = 0; i < 40; i++) { const lv = i < off ? 0 : wave[i - off]; bars[i].style.height = `${Math.max(3, Math.round(lv * 30))}px`; bars[i].classList.toggle('on', lv > 0.06); }
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
      const extra = { mime: rec.mime || '', elapsedMs: rec.elapsed || 0 };
      const text = cap ? cap.text() : '';
      if (text && text !== lastSentText) { extra.text = text; }
      await api(`/api/visits/${visit.id}/chunk`, { method: 'POST', body: JSON.stringify({ seq: n, data: b64(p.bytes), ...extra }) });
      if (extra.text) lastSentText = extra.text;
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
async function start(opt = {}) {
  const customer = opt.customer || $('vCustomer').value.trim();
  const title = opt.title || kind;
  if (!opt.customer) { segNo = 1; segments = []; }
  if (!customer) { $('vCustomer').focus(); return toast('お客様のお名前を入れてください'); }
  if (!recSupported() || !stream) return toast('この端末では録音できません');
  $('vStart').disabled = true;
  // 文字起こしの初回準備は、ボタンを押した流れの中で始める
  const capReady = capSupport === 'downloadable' ? prepareCaption() : Promise.resolve(capSupport === 'available' || capSupport === 'downloading');
  try {
    const r = await api('/api/visits', { method: 'POST', body: JSON.stringify({ customerName: customer, title }) });
    visit = r.visit;
  } catch (e) { $('vStart').disabled = false; return toast(e.message); }
  buf = []; bufBytes = 0; lastFlush = Date.now(); seq = 0; parts.clear(); sending = Promise.resolve(); lastSentText = '';
  try {
    await rec.start({ title: `${customer} ${kind}`, local: stream.getAudioTracks()[0], remotes: [], bitrate: 48000, onChunk, meta: { visitId: visit.id, customer, kind } });
  } catch (e) { console.error(e); $('vStart').disabled = false; return toast('録音を始められませんでした'); }
  if (opt.customer && cap) { cap.lines = []; cap.offset = 0; cap.t0 = Date.now(); cap.start(stream && stream.getAudioTracks()[0]); } else startCaption(capReady);
  $('vWho').textContent = `${customer}`; $('vKindLabel').textContent = kind;
  $('vPause').textContent = '一時停止'; $('vState').classList.remove('paused');
  show('live'); $('history').classList.add('hidden');
  updateSync();
  keepAwake();
  clearInterval(tick); tick = setInterval(() => { $('vTimer').textContent = fmt(rec.elapsed); $('dimTimer').textContent = fmt(rec.elapsed); if (Date.now() - lastFlush >= FLUSH_MS) flush(); watchdog(); }, 500);
}

function togglePause() {
  if (rec.paused) { rec.resume(); if (cap) cap.resume(); $('vPause').textContent = '一時停止'; $('vState').classList.remove('paused'); $('vState').lastChild.textContent = '録音中'; }
  else { rec.pause(); if (cap) cap.pause(); $('vPause').textContent = '再開'; $('vState').classList.add('paused'); $('vState').lastChild.textContent = '一時停止中'; }
}

// 録音を締めて、受け渡し箱・この端末・ドライブへ保存する（画面の切り替えはしない）
async function closeOut({ quiet = false } = {}) {
  clearInterval(tick);
  if (cap && !quiet) cap.stop();
  const text = cap ? cap.text() : '';
  const r = await rec.stop();
  flush();
  await sending;
  // 送れていない分を送り直す
  for (const [n, p] of parts) if (!p.sent) await sendPart(n, 4);
  let finished = null; let sentOk = false;
  try {
    const body = JSON.stringify({ chunks: parts.size, mime: r.mime, durationMs: r.durationMs, bytes: r.blob.size, text });
    let f = await api(`/api/visits/${visit.id}/finish`, { method: 'POST', body });
    if (f.status === 409 && f.missing) { for (const n of f.missing) await sendPart(n, 4); f = await api(`/api/visits/${visit.id}/finish`, { method: 'POST', body }); }
    sentOk = !!f.ok; finished = f.visit;
  } catch (_) { sentOk = false; }
  // この端末にも保存（いつでも手元に残す）
  const name = fileName(visit.customerName, kind, r.startedAt, r.mime);
  saveFile(r.blob, name);
  if (text && !sentOk) saveFile(new Blob([text], { type: 'text/plain' }), name.replace(/\.\w+$/, '.txt'));
  if (sentOk) await rec.discardBackup(r.id);
  // ドライブへ（サーバーが本人のドライブに置く）
  let dr = null;
  if (sentOk && driveSt.connected) {
    $('vSync').textContent = 'ドライブに置いています…';
    try { dr = await api(`/api/visits/${visit.id}/drive`, { method: 'POST' }); } catch (e) { dr = { ok: false, error: e.message }; }
    if (dr.visit) finished = dr.visit;
    if (dr.need === 'connect') { driveSt.connected = false; renderDrive(); }
  }
  return { r, text, name, sentOk, finished, dr, visit };
}

async function stop() {
  $('vStop').disabled = true; $('vPause').disabled = true;
  dim(false);
  const { r, text, name, sentOk, dr, finished } = await closeOut();
  releaseWake();
  const list = $('vDoneList'); list.textContent = '';
  const item = (cls, text, sub, state) => { const li = el('li', cls); const t = el('div', 'dl-t'); t.appendChild(el('b', '', text)); if (sub) t.appendChild(el('small', '', sub)); li.appendChild(t); if (state) li.appendChild(el('span', 'dl-s', state)); list.appendChild(li); };

  item('ok', 'この端末', `ダウンロードに保存：${name}`, '済');
  item(sentOk ? 'ok' : 'ng', '受け渡し箱', sentOk ? '暗号化して一時保管' : '送れませんでした。下の「最近の録音」から送り直せます（この端末の控えは残してあります）', sentOk ? '済' : '未');
  const fv = finished || {};
  if (fv.drive) item('ok', 'ドライブ', `${fv.drive.where === 'customer' ? 'お客様のフォルダ' : 'マイドライブ'}「${fv.drive.folder}」${fv.hasText ? '（文字起こしも一緒に）' : ''}`, '済');
  else if (!sentOk) item('pend', 'ドライブ', '受け渡し箱に届いてから置きます', '待ち');
  else if (!driveSt.enabled) item('pend', 'ドライブ', '自動で置く設定がまだです（管理者の設定待ち）。受け渡し箱に 14 日間残ります', '設定待ち');
  else if (!driveSt.connected) item('pend', 'ドライブ', '「ドライブにつなぐ」を押すと、この録音も自動で置きます', '未接続');
  else item('ng', 'ドライブ', `${(dr && dr.error) || '置けませんでした'}。次にこの画面を開いたとき、自動で置き直します`, '再送待ち');
  if (text) item(fv.drive && fv.hasText ? 'ok' : 'pend', '文字起こし', `${text.split('\n').length} 行（この端末の中だけで作成）`, fv.drive && fv.hasText ? '済' : '一緒に置きます');
  if (segments.length) item('ok', '分けて保存した分', `途中で録音が止まったため、ほかに ${segments.length} 本に分けて保存しました（${segments.map((x) => fmt(x.r.durationMs)).join('・')}）`, '済');
  item('pend', 'COMPASS', 'お客様の録音の置き場所（局長のパソコンの Chrome 経由）', '仕分け待ち');
  $('vStop').disabled = false; $('vPause').disabled = false; $('vStart').disabled = false;
  visit = finished || visit;
  $('vDoneSub').textContent = `${visit.customerName || ''}${kind ? ` · ${kind}` : ''} · ${fmt(r.durationMs)}`;
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
// ---------- 落ちても・画面が消えても、録った分を残す ----------
// 画面が隠れる直前に、手元の分をすぐ送る（スリープ・アプリの切り替え・電池切れの手前）
function sendNow() {
  if (!rec.active) return;
  try { if (rec.mr && rec.mr.state === 'recording') rec.mr.requestData(); } catch (_) { /* 何もしない */ }
  setTimeout(() => flush(), 120);
}
document.addEventListener('visibilitychange', () => {
  if (!rec.active) return;
  if (document.visibilityState === 'hidden') { sendNow(); return; }
  keepAwake();
  watchdog(true);
});
window.addEventListener('pagehide', sendNow);
// マイクが切れていたら付け直す（録音そのものは止めずに続ける）
let healing = false;
async function healMic() {
  if (healing || !rec.active) return; healing = true;
  try { await openMic(micId); toast('マイクがいったん切れたので、付け直しました。録音は続いています', 6000); } catch (_) { toast('マイクを付け直せませんでした。いったん終了して保存してください', 8000); }
  healing = false;
}
// 見回り：止まっていたら直す。録音自体が止まっていたら、ここまでを保存して続きを新しく録る
function watchdog(fromWake) {
  if (!rec.active || restarting || document.visibilityState !== 'visible') return;
  try { const c = ctx(); if (c.state !== 'running' && !rec.paused) c.resume().catch(() => {}); } catch (_) { /* 何もしない */ }
  const t = stream && stream.getAudioTracks()[0];
  if (!t || t.readyState === 'ended') { healMic(); }
  if (rec.mr && rec.mr.state === 'inactive') restartSegment();
  else if (fromWake && !rec.paused && rec.mr && rec.mr.state === 'paused') { try { rec.mr.resume(); } catch (_) { restartSegment(); } }
}
async function restartSegment() {
  if (restarting || !visit) return; restarting = true;
  const customer = visit.customerName; const title = `${kind}（続き${segNo + 1}）`;
  toast('画面が消えている間に録音が止まっていました。ここまでを保存して、続きを録音します', 8000);
  try {
    const done = await closeOut({ quiet: true });
    segments.push(done);
    segNo++;
    try { await openMic(micId); } catch (_) { /* 前のマイクのまま */ }
    await start({ customer, title });
  } catch (_) { toast('続きの録音を始められませんでした。録れた分は保存してあります', 8000); }
  restarting = false;
}
// 画面を暗くする（画面はついたままなので録音は続く。電池の減りを抑える）
function dim(on) {
  $('dimLayer').classList.toggle('hidden', !on);
  if (on) { keepAwake(); try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); } catch (_) { /* 何もしない */ } }
  else if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); }
}
window.addEventListener('beforeunload', (e) => { if (rec.active) { e.preventDefault(); e.returnValue = '録音が保存されていません'; } });

// ---------- 最近の録音 ----------
const STATUS = (v) => {
  if (v.status === 'recording') return ['録音中か、途中で止まった録音', 'warn'];
  if (v.status === 'filed') return ['置き終わり', 'ok'];
  if (v.drive && v.compass === 'pending') return ['ドライブ済・COMPASS待ち', 'ok'];
  if (v.driveError) return ['ドライブ再送待ち', 'warn'];
  if (!driveSt.enabled) return ['ドライブ設定待ち', 'mid'];
  if (!driveSt.connected) return ['ドライブ未接続', 'mid'];
  return ['ドライブ待ち', 'mid'];
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
      if (v.drive && v.drive.folder) left.appendChild(el('small', 'muted', `ドライブ：${v.drive.folder}${v.hasText ? '（文字起こし付き）' : ''}`));
      else if (v.driveError) left.appendChild(el('small', 'muted', v.driveError));
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
    if (rec.active) break;
    const meta = r.meta || {};
    if (!meta.visitId) {
      // オンラインの打ち合わせの録音（パソコンが落ちた等）
      const box = el('p', '', `オンラインの打ち合わせ「${r.title || ''}」（${new Date(r.startedAt).toLocaleString('ja-JP')}）の録音が、保存されないまま残っています。`);
      const ans = await modalAsk('保存されていない録音があります', box, [['捨てる', 'drop', 'ghost'], ['この端末に保存する', 'save', 'primary']]);
      if (ans === 'save') saveFile(r.blob, `COMPASS-Meet_recovered_${new Date(r.startedAt).toISOString().slice(0, 16).replace(/[-:T]/g, '')}.${/mp4/.test(r.mime) ? 'm4a' : 'webm'}`);
      await rec.discardBackup(r.id);
      continue;
    }
    const box = el('div');
    box.appendChild(el('p', '', `${meta.customer || ''}（${new Date(r.startedAt).toLocaleString('ja-JP')}）の録音が、途中で止まったまま残っています。受け渡し箱には途中まで届いています。「保存して送る」で、この端末の控え（最後まで入っているもの）に差し替えます。`));
    const ans = await modalAsk('途中で止まった録音があります', box, [['捨てる', 'drop', 'ghost'], ['この端末に保存だけ', 'save', ''], ['保存して送る', 'send', 'primary']]);
    if (ans === 'drop') { await rec.discardBackup(r.id); continue; }
    saveFile(r.blob, `COMPASS-taimen_recovered_${meta.visitId}.${/mp4/.test(r.mime) ? 'm4a' : 'webm'}`);
    if (ans === 'send') {
      try {
        // 受け渡し箱に途中まで届いている録音なら、端末の控え（最後まで入っている）で送り直す
        let nv = null;
        try { nv = (await api(`/api/visits/${meta.visitId}/reopen`, { method: 'POST' })).visit || null; } catch (_) { nv = null; }
        if (!nv || nv.status !== 'recording') nv = (await api('/api/visits', { method: 'POST', body: JSON.stringify({ customerName: meta.customer || '不明', title: `${meta.kind || '対面の打ち合わせ'}（端末の控え）` }) })).visit;
        visit = nv; parts.clear();
        const all = new Uint8Array(await r.blob.arrayBuffer());
        let n = 0; for (let i = 0; i < all.length; i += FLUSH_BYTES, n++) { parts.set(n, { bytes: all.subarray(i, i + FLUSH_BYTES), sent: false }); await sendPart(n, 4); }
        await api(`/api/visits/${nv.id}/finish`, { method: 'POST', body: JSON.stringify({ chunks: parts.size, mime: r.mime, durationMs: 0, bytes: r.blob.size }) });
        if (driveSt.connected) await api(`/api/visits/${nv.id}/drive`, { method: 'POST' }).catch(() => {});
        toast(driveSt.connected ? '受け渡し箱に送り、ドライブに置きました' : '受け渡し箱に送りました');
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

// ---------- 文字起こし ----------
function capLine(line) {
  const box = $('vCapLines');
  const p = el('p'); const s = Math.floor(line.at / 1000);
  p.appendChild(el('time', '', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`));
  p.appendChild(el('span', '', line.text));
  box.appendChild(p);
  while (box.childElementCount > 200) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}
async function startCaption(ready) {
  $('vCapLines').textContent = ''; $('vCapInterim').textContent = '';
  cap = null;
  const box = $('vCapBox');
  if (capSupport === 'unavailable') {
    box.classList.add('off');
    $('vCapNote').textContent = 'この端末では使えません';
    $('vCapInterim').textContent = 'この端末は「端末の中だけで文字にする」機能に対応していないため、文字は出ません。録音は上の波形のとおり続いています。';
    return;
  }
  box.classList.remove('off');
  $('vCapNote').textContent = capSupport === 'downloadable' ? 'はじめての準備中（日本語の認識データを端末に入れています）…' : 'この端末の中だけで処理しています';
  $('vCapInterim').textContent = '話し始めると、ここに文字が出ます';
  const okk = await ready;
  if (!rec.active) return;
  if (!okk) { box.classList.add('off'); $('vCapNote').textContent = '準備できませんでした'; $('vCapInterim').textContent = '文字起こしの準備ができませんでした。録音は続いています。'; return; }
  cap = new Caption({
    onLine: capLine,
    onInterim: (t) => { $('vCapInterim').textContent = t; },
    onState: (st, why) => {
      if (st === 'on') $('vCapNote').textContent = 'この端末の中だけで処理しています';
      if (st === 'paused') $('vCapNote').textContent = '一時停止中';
      if (st === 'error') { $('vCapNote').textContent = why === 'not-local' ? 'この端末では使えません' : '止まりました'; $('vCapInterim').textContent = '文字起こしが止まりました。録音は続いています。'; }
    },
  });
  cap.start(stream && stream.getAudioTracks()[0]);
  if (rec.paused) cap.pause();
}
async function checkCaption() {
  capSupport = await captionSupport();
  $('vCapState').textContent = {
    available: 'この端末の中だけで文字にします（声は外に送りません）',
    downloading: 'この端末の中だけで文字にします（準備中）',
    downloadable: 'この端末の中だけで文字にします（初回だけ、録音開始時に準備します）',
    unavailable: 'この端末では使えません（録音は問題なくできます）',
  }[capSupport];
  $('vCapState').classList.toggle('dim', capSupport === 'unavailable');
}

// ---------- ドライブ ----------
function renderDrive() {
  const st = $('vDriveState'); const b = $('vDriveBtn');
  b.classList.add('hidden'); st.classList.remove('dim');
  if (!driveSt.enabled) { st.textContent = 'この端末と受け渡し箱（ドライブへの自動保存は管理者の設定待ち）'; st.classList.add('dim'); return; }
  if (!driveSt.connected) { st.textContent = 'ドライブにつなぐと、終わったあと自動で置きます'; b.textContent = 'ドライブにつなぐ'; b.classList.remove('hidden'); return; }
  st.textContent = `${driveSt.email} のドライブ（お客様のフォルダ／無ければ「録音」）`;
  b.textContent = '切る'; b.classList.remove('hidden');
}
async function checkDrive() {
  try { driveSt = await api('/api/drive'); } catch (_) { driveSt = { enabled: false, connected: false }; }
  renderDrive();
  if (driveSt.connected) {
    // ドライブにまだ置いていない分を、まとめて置く
    try { const r = await api('/api/visits/sync', { method: 'POST' }); if (r.done && r.done.some((d) => d.ok)) { toast(`${r.done.filter((d) => d.ok).length} 件の録音をドライブに置きました`); loadHistory(); } } catch (_) { /* あとでまた */ }
  }
}
$('vDriveBtn').onclick = async () => {
  if (!driveSt.connected) { location.href = '/api/drive/connect'; return; }
  const box = el('p', '', `${driveSt.email} のドライブとの接続を切ります。切ったあとの録音は、受け渡し箱にだけ残ります。`);
  if (await modalAsk('ドライブとの接続を切りますか', box, [['やめる', 'no', 'ghost'], ['切る', 'yes', 'danger']]) !== 'yes') return;
  await api('/api/drive/disconnect', { method: 'POST' }).catch(() => {});
  driveSt.connected = false; renderDrive(); loadHistory();
};
function driveNotice() {
  const q = new URLSearchParams(location.search); const d = q.get('drive');
  if (!d) return;
  const msg = { ok: 'ドライブにつなぎました。これからの録音は自動でドライブに置きます', disabled: 'ドライブへの自動保存は、まだ設定されていません', login: 'ログインしてから、もう一度お試しください', error_cancelled: 'ドライブへの接続をやめました', error_domain: '会社の Google アカウントでつないでください', error_scope: 'ドライブの許可にチェックを入れて、もう一度お試しください' }[d] || 'ドライブにつなげませんでした。もう一度お試しください';
  toast(msg, 7000);
  q.delete('drive'); history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
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
  driveNotice();
  checkCaption();
  await checkDrive();
  loadHistory();
  offerLeftovers();
}

$('vStart').onclick = start;
$('vPause').onclick = togglePause;
$('vStop').onclick = stop;
$('vDim').onclick = () => dim(true);
$('dimLayer').onclick = () => dim(false);
$('vAgain').onclick = () => { show('setup'); $('vCustomer').value = ''; $('vCustomer').focus(); };
$('vMicChip').onclick = (e) => { e.stopPropagation(); micMenu(e.currentTarget); };
document.addEventListener('click', (e) => { if (!e.target.closest('.devmenu')) $('devMenu').classList.add('hidden'); });
window.__visit = { rec, parts, get cap() { return cap; } };
init();
