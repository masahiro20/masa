// 録音：全員の声を 1 本にまとめて、主催者のパソコンに保存する（サーバーや外部には送らない）
// 途中でブラウザが落ちても失わないよう、録った分は数秒ごとにこのパソコンのブラウザ内（IndexedDB）にも書いておく。
const MIMES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
const DB = 'meet-rec';

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const db = r.result; db.createObjectStore('recs', { keyPath: 'id' }); db.createObjectStore('chunks', { keyPath: ['rec', 'seq'] }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const tx = (db, stores, mode, fn) => new Promise((res, rej) => { const t = db.transaction(stores, mode); const out = fn(t); t.oncomplete = () => res(out); t.onerror = () => rej(t.error); });
const all = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const recSupported = () => !!(window.MediaRecorder && (window.AudioContext || window.webkitAudioContext));
export const extFor = (mime) => (/mp4/.test(mime) ? 'm4a' : 'webm');

export class Recorder {
  constructor(getCtx) {
    this.getCtx = getCtx; this.active = false; this.sources = new Map(); this.startedAt = 0; this.mime = '';
  }

  async start({ title, local, remotes, bitrate = 64000, onChunk = null, meta = {} }) {
    const ctx = this.getCtx();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    this.dest = ctx.createMediaStreamDestination();
    // 何人かが同時に話しても音が割れないよう、軽く圧縮してから録る
    this.bus = ctx.createDynamicsCompressor();
    this.bus.threshold.value = -12; this.bus.knee.value = 12; this.bus.ratio.value = 4; this.bus.attack.value = 0.005; this.bus.release.value = 0.2;
    this.bus.connect(this.dest);
    this.setLocal(local);
    for (const [id, tr] of remotes) this.addTrack(id, tr);
    this.mime = MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    this.mr = new MediaRecorder(this.dest.stream, { ...(this.mime ? { mimeType: this.mime } : {}), audioBitsPerSecond: bitrate });
    this.onChunk = onChunk; this.pausedMs = 0; this.pausedAt = 0;
    this.mime = this.mr.mimeType || this.mime || 'audio/webm';
    this.chunks = []; this.seq = 0;
    this.id = `rec-${Date.now()}`; this.title = title || '打ち合わせ'; this.startedAt = Date.now();
    try { this.db = await openDb(); await tx(this.db, ['recs'], 'readwrite', (t) => t.objectStore('recs').put({ id: this.id, title: this.title, mime: this.mime, startedAt: this.startedAt, meta })); } catch (_) { this.db = null; }
    this.mr.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      this.chunks.push(e.data);
      if (this.onChunk) { try { this.onChunk(e.data); } catch (_) { /* 送れなくても録音は続ける */ } }
      const seq = this.seq++;
      if (this.db) tx(this.db, ['chunks'], 'readwrite', (t) => t.objectStore('chunks').put({ rec: this.id, seq, blob: e.data })).catch(() => {});
    };
    this.mr.start(1000); // 1 秒ごとに控えを書く（落ちても失うのは最後の 1 秒ほど）
    this.active = true;
  }

  // 自分のマイク（切り替えたら差し替える）
  setLocal(track) {
    if (!this.dest) return;
    if (this.localTrack === track) return;
    this.removeTrack('__local');
    this.localTrack = track || null;
    if (track) this.addTrack('__local', track);
  }

  addTrack(id, track) {
    if (!this.dest || !track) return;
    const cur = this.sources.get(id);
    if (cur && cur.track === track) return;
    this.removeTrack(id);
    try {
      const src = this.getCtx().createMediaStreamSource(new MediaStream([track]));
      src.connect(this.bus);
      this.sources.set(id, { src, track });
    } catch (_) { /* 取り込めない音は飛ばす */ }
  }

  removeTrack(id) {
    const cur = this.sources.get(id);
    if (cur) { try { cur.src.disconnect(); } catch (_) { /* 既に外れている */ } this.sources.delete(id); }
  }

  get elapsed() { return this.active ? (this.pausedAt || Date.now()) - this.startedAt - this.pausedMs : 0; }
  get paused() { return !!this.pausedAt; }
  pause() { if (this.active && !this.pausedAt && this.mr.state === 'recording') { this.mr.pause(); this.pausedAt = Date.now(); } }
  resume() { if (this.active && this.pausedAt) { this.mr.resume(); this.pausedMs += Date.now() - this.pausedAt; this.pausedAt = 0; } }

  // 止めて、1 つのファイルにまとめる
  stop() {
    if (this.stopping) return this.stopping; // 二重に止めても、同じ結果を返す
    this.stopping = new Promise((resolve) => {
      if (!this.active) return resolve(null);
      if (this.pausedAt) this.resume(); // 一時停止中に止めた場合も、録れた長さを正しく数える
      const durationMs = this.elapsed;
      const finish = () => {
        const blob = new Blob(this.chunks, { type: this.mime });
        for (const id of [...this.sources.keys()]) this.removeTrack(id);
        this.active = false; try { this.bus.disconnect(); } catch (_) { /* 何もしない */ } this.dest = null; this.bus = null; this.localTrack = null;
        const meta = { id: this.id, title: this.title, mime: this.mime, startedAt: this.startedAt, durationMs };
        resolve({ blob, ...meta });
      };
      // すでに止まっていた（端末が録音を止めた）場合は、録れている分でまとめる
      if (this.mr.state === 'inactive') { finish(); return; }
      this.mr.onstop = finish;
      try { this.mr.requestData(); } catch (_) { /* 何もしない */ }
      try { this.mr.stop(); } catch (_) { finish(); }
    });
    this.stopping.then(() => { this.stopping = null; });
    return this.stopping;
  }

  // 保存し終えたら、ブラウザ内の控えを消す
  async discardBackup(id) {
    try {
      const db = this.db || await openDb();
      await tx(db, ['recs', 'chunks'], 'readwrite', (t) => {
        t.objectStore('recs').delete(id);
        t.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
      });
    } catch (_) { /* 何もしない */ }
  }
}

// 前回、保存しきれなかった録音（ブラウザが落ちた等）を探す
export async function leftovers() {
  if (!window.indexedDB) return [];
  try {
    const db = await openDb();
    const recs = await tx(db, ['recs'], 'readonly', (t) => all(t.objectStore('recs').getAll()));
    const out = [];
    for (const r of await recs) {
      const chunks = await tx(db, ['chunks'], 'readonly', (t) => all(t.objectStore('chunks').getAll(IDBKeyRange.bound([r.id, 0], [r.id, Number.MAX_SAFE_INTEGER]))));
      const list = await chunks;
      if (!list.length) { await tx(db, ['recs'], 'readwrite', (t) => t.objectStore('recs').delete(r.id)); continue; }
      out.push({ ...r, blob: new Blob(list.sort((a, b) => a.seq - b.seq).map((c) => c.blob), { type: r.mime }) });
    }
    return out;
  } catch (_) { return []; }
}

export function saveFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ファイル名は英数字だけにする（日本語の名前は、ブラウザによって「download」に置き換えられてしまうため）
// 保存するファイルの名前：「打ち合わせの名前 26.11.23.m4a」（日付は録り始めた日）
export function dateTag(ts) {
  const d = new Date(ts); const p = (n) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}
export function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}
export function fileName(title, startedAt, mime) {
  return `${safeName(title) || '打ち合わせ'} ${dateTag(startedAt)}.${extFor(mime)}`;
}
