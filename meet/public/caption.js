// 端末の中だけで行う文字起こし（声を外に送らない）
// Chrome の「端末内の音声認識」（processLocally）が使えるときだけ動かす。
// 使えない端末では動かさない（クラウドの音声認識には切り替えない）。

const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const LANG = 'ja-JP';

// 返り値：'available'（すぐ使える）/ 'downloadable'（初回だけ準備が要る）/ 'downloading' / 'unavailable'
// 音声認識の部品が入っていないブラウザ（Chromium 系の一部）では、確かめる処理そのものでページが落ちることがある。
// 本物の Google Chrome でだけ確かめ、確かめる途中で落ちたことがあれば、その端末では二度と確かめない。
const PROBE = 'meet.capProbe';
function isGoogleChrome() {
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  return brands.some((b) => b.brand === 'Google Chrome');
}
export async function captionSupport() {
  if (!SR || !isGoogleChrome()) return 'unavailable';
  let prev = '';
  try { prev = localStorage.getItem(PROBE) || ''; } catch (_) { /* 何もしない */ }
  if (prev === 'pending' || prev === 'crashed') { try { localStorage.setItem(PROBE, 'crashed'); } catch (_) { /* 何もしない */ } return 'unavailable'; }
  try { localStorage.setItem(PROBE, 'pending'); } catch (_) { /* 何もしない */ }
  const r = await probe();
  try { localStorage.setItem(PROBE, r); } catch (_) { /* 何もしない */ }
  return r;
}
async function probe() {
  try {
    if (typeof SR.available === 'function') {
      const r = await SR.available({ langs: [LANG], processLocally: true });
      return ['available', 'downloadable', 'downloading'].includes(r) ? r : 'unavailable';
    }
    if (typeof SR.availableOnDevice === 'function') { // 以前の名前
      const r = await SR.availableOnDevice(LANG);
      return ['available', 'downloadable', 'downloading'].includes(r) ? r : 'unavailable';
    }
  } catch (_) { /* 使えない */ }
  return 'unavailable';
}

// 初回の準備（日本語の認識データを端末に入れる）。ボタンを押した流れの中で呼ぶ
export async function prepareCaption() {
  try {
    if (typeof SR.install === 'function') return !!(await SR.install({ langs: [LANG], processLocally: true }));
    if (typeof SR.installOnDevice === 'function') return !!(await SR.installOnDevice(LANG));
  } catch (_) { /* 準備できない */ }
  return false;
}

export class Caption {
  constructor({ onLine, onInterim, onState }) {
    this.onLine = onLine; this.onInterim = onInterim; this.onState = onState || (() => {});
    this.lines = []; this.running = false; this.r = null; this.t0 = 0; this.offset = 0; this.track = null; this.fails = 0;
  }

  // 端末の中だけで動く設定にできたときだけ true
  _make() {
    const r = new SR();
    r.lang = LANG; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    let local = false;
    if ('processLocally' in r) { r.processLocally = true; local = r.processLocally === true; }
    else if ('mode' in r) { r.mode = 'ondevice-only'; local = r.mode === 'ondevice-only'; }
    if (!local) return null;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]; const txt = (res[0] && res[0].transcript || '').trim();
        if (!txt) continue;
        if (res.isFinal) { const line = { at: this.elapsed(), text: txt }; this.lines.push(line); this.onLine(line); this.fails = 0; }
        else interim += txt;
      }
      this.onInterim(interim);
    };
    r.onerror = (e) => {
      if (['not-allowed', 'service-not-allowed', 'language-not-supported', 'audio-capture'].includes(e.error)) { this.running = false; this.onState('error', e.error); }
    };
    r.onend = () => {
      this.onInterim('');
      if (!this.running) return;
      // 無音などで止まったら、つなぎ直す（続けて失敗するときは少し待つ）
      this.fails++;
      setTimeout(() => { if (this.running) this._go(); }, Math.min(5000, 200 * this.fails));
    };
    return r;
  }
  _go() {
    try {
      this.r = this._make();
      if (!this.r) { this.running = false; this.onState('error', 'not-local'); return; }
      try { if (this.track) this.r.start(this.track); else this.r.start(); } catch (_) { this.r.start(); }
      this.onState('on');
    } catch (_) { this.running = false; this.onState('error', 'start'); }
  }
  elapsed() { return this.offset + (this.t0 ? Date.now() - this.t0 : 0); }

  start(track) { if (!SR) return false; this.track = track || null; this.running = true; this.t0 = Date.now(); this._go(); return this.running; }
  pause() { if (!this.running) return; this.offset = this.elapsed(); this.t0 = 0; this.running = false; try { this.r && this.r.stop(); } catch (_) { /* 何もしない */ } this.onState('paused'); }
  resume() { if (this.running || !this.r) return; this.running = true; this.t0 = Date.now(); this._go(); }
  setTrack(track) { this.track = track; if (this.running) { try { this.r.abort(); } catch (_) { /* onend でつなぎ直す */ } } }
  stop() { this.running = false; try { this.r && this.r.stop(); } catch (_) { /* 何もしない */ } this.onState('off'); }

  text() {
    const p = (n) => String(n).padStart(2, '0');
    return this.lines.map((l) => { const s = Math.floor(l.at / 1000); return `[${Math.floor(s / 60)}:${p(s % 60)}] ${l.text}`; }).join('\n');
  }
}
