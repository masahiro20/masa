// 背景のぼかし・背景画像（すべて自分の端末の中で処理し、映像を外へ送らない）
// 人と背景の見分けには Google MediaPipe の selfie segmenter を使う（本番の組み立て時に自分のサイトへ置く）。
// 流れ：カメラの映像 → 小さく縮めて人の形（マスク）を出す → 背景をぼかす／画像に差し替える → 相手に送る映像にする

const BASE = '/static/vendor/mediapipe';
const SEG_W = 256; const SEG_H = 144; // 見分けに使う大きさ（小さいほど軽い）
const FPS = 24;
// パソコンの速さに合わせて、出す映像の大きさと人の見分けの回数を自動で下げる（カクつき防止）
const LEVELS = [{ w: 960, every: 1 }, { w: 800, every: 2 }, { w: 640, every: 2 }, { w: 512, every: 3 }];

export const PRESETS = [
  { id: 'office', label: 'オフィス', src: '/static/bg/office.svg' },
  { id: 'living', label: 'リビング', src: '/static/bg/living.svg' },
  { id: 'wood', label: '木の壁', src: '/static/bg/wood.svg' },
  { id: 'brand', label: 'COMPASS', src: '/static/bg/brand.svg' },
];

let readyPromise = null;
// 使えるかどうか（部品がそろっているか・この端末で動くか）
export function available() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    if (window.__fxTestMask) return true; // 試験用：見分けの代わりに楕円の形を使う
    if (!window.WebAssembly || !HTMLCanvasElement.prototype.captureStream) return false;
    try { const r = await fetch(`${BASE}/ready.json`, { cache: 'no-store' }); return r.ok; } catch (_) { return false; }
  })();
  return readyPromise;
}

let segPromise = null;
async function loadSegmenter() {
  if (window.__fxTestMask) return { test: true };
  if (segPromise) return segPromise;
  segPromise = (async () => {
    const files = await fetch(`${BASE}/ready.json`, { cache: 'no-store' }).then((r) => r.ok && r.json()).catch(() => null);
    if (!files) throw new Error('not ready');
    const mod = await import(`${BASE}/vision_bundle.mjs`);
    const fileset = await mod.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: `${BASE}/segmenter.tflite`, delegate }, runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true });
    try { return await mod.ImageSegmenter.createFromOptions(fileset, opts('GPU')); } catch (_) { return mod.ImageSegmenter.createFromOptions(fileset, opts('CPU')); }
  })();
  segPromise.catch(() => { segPromise = null; });
  return segPromise;
}

// 一定の間隔で合図を出す（タブが裏に回っても止まりにくいよう、別スレッドの時計を使う）
function makeTicker(cb) {
  let w = null; let t = null;
  try {
    w = new Worker('/static/fxtimer.js');
    w.onmessage = cb; w.postMessage({ ms: Math.round(1000 / FPS) });
  } catch (_) { t = setInterval(cb, Math.round(1000 / FPS)); }
  return () => { if (w) w.terminate(); if (t) clearInterval(t); };
}

const loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

export class Effects {
  constructor() {
    this.mode = 'none'; // none | blur-light | blur | image
    this.imageId = null; this.image = null;
    this.source = null; this.track = null; this.stream = null;
    this.video = document.createElement('video');
    Object.assign(this.video, { muted: true, playsInline: true, autoplay: true });
    this.video.setAttribute('aria-hidden', 'true');
    Object.assign(this.video.style, { position: 'fixed', left: '-10px', top: '-10px', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
    this.out = document.createElement('canvas');
    this.ctx = this.out.getContext('2d');
    this.small = document.createElement('canvas'); this.small.width = SEG_W; this.small.height = SEG_H;
    this.sctx = this.small.getContext('2d', { willReadFrequently: false });
    this.mask = document.createElement('canvas'); this.mask.width = SEG_W; this.mask.height = SEG_H;
    this.mctx = this.mask.getContext('2d');
    // 縁をやわらかくした形（小さいままぼかすので軽い）
    this.soft = document.createElement('canvas'); this.soft.width = SEG_W; this.soft.height = SEG_H;
    this.softCtx = this.soft.getContext('2d');
    this.level = 0; this.cost = 0; this.n = 0;
    this.maskData = this.mctx.createImageData(SEG_W, SEG_H);
    this.prev = new Float32Array(SEG_W * SEG_H);
    this.blurC = document.createElement('canvas');
    this.bctx = this.blurC.getContext('2d');
    this.stop = null; this.seg = null; this.busy = false; this.lastTs = 0; this.paused = false;
    this.hasFilter = 'filter' in this.ctx;
  }

  get active() { return this.mode !== 'none' && !!this.track && this.track.readyState === 'live'; }

  // 設定を変える（画像は id か、自分で選んだ画像の data URL）
  async set(mode, imageId, customUrl) {
    if (mode === 'image') {
      const pre = PRESETS.find((p) => p.id === imageId);
      const src = pre ? pre.src : customUrl;
      if (!src) mode = 'none';
      else {
        // 毎回描き直すと重い（特に SVG）ので、一度だけ 1280×720 の絵にしておく
        const img = await loadImage(src);
        const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720;
        this.drawCover(cv.getContext('2d'), img, 1280, 720);
        this.image = cv; this.imageId = imageId;
      }
    }
    this.mode = mode;
    if (mode === 'none') { this.shutdown(); return null; }
    if (!this.seg) this.seg = await loadSegmenter();
    this.ensureRunning();
    return this.track;
  }

  // カメラの映像（元）を差し替える
  setSource(track) {
    this.source = track || null;
    if (this.video.srcObject && this.video.srcObject.getVideoTracks()[0] === this.source) return;
    this.video.srcObject = this.source ? new MediaStream([this.source]) : null;
    if (this.source) this.video.play().catch(() => {});
  }

  setPaused(p) { this.paused = !!p; }

  ensureRunning() {
    if (!this.video.isConnected) document.body.appendChild(this.video);
    if (this.source && !this.video.srcObject) this.setSource(this.source);
    if (!this.track || this.track.readyState !== 'live') {
      const s = this.source && this.source.getSettings ? this.source.getSettings() : {};
      this.out.width = Math.min(LEVELS[this.level].w, s.width || 1280); this.out.height = Math.round(this.out.width * ((s.height || 720) / (s.width || 1280)));
      this.stream = this.out.captureStream(FPS);
      this.track = this.stream.getVideoTracks()[0];
      if ('contentHint' in this.track) this.track.contentHint = 'motion';
    }
    if (!this.stop) this.stop = makeTicker(() => this.frame());
  }

  shutdown() {
    if (this.stop) { this.stop(); this.stop = null; }
    if (this.track) this.track.stop();
    this.track = null; this.stream = null;
    this.prev.fill(0);
  }

  frame() {
    if (this.busy || this.paused || this.mode === 'none') return;
    const v = this.video;
    if (!v.videoWidth || v.readyState < 2) return;
    this.busy = true;
    const t0 = performance.now();
    try {
      const L = LEVELS[this.level];
      const W = Math.min(L.w, v.videoWidth); const H = Math.round(W * v.videoHeight / v.videoWidth);
      if (this.out.width !== W) this.out.width = W;
      if (this.out.height !== H) this.out.height = H;
      this.n++;
      const doSeg = this.n % L.every === 0 || this.n < 3;
      if (doSeg) this.sctx.drawImage(v, 0, 0, SEG_W, SEG_H);
      if (!doSeg) { /* 前の形を使い回す */ } else if (this.seg.test) this.testMask();
      else {
        let ts = performance.now(); if (ts <= this.lastTs) ts = this.lastTs + 1; this.lastTs = ts;
        this.seg.segmentForVideo(this.small, ts, (res) => {
          const m = res.confidenceMasks && res.confidenceMasks[0];
          if (m) this.applyMask(m.getAsFloat32Array(), m.width, m.height);
        });
      }
      this.compose(v, W, H);
    } catch (e) {
      console.error(e);
    } finally {
      this.busy = false;
      // 1 コマにかかった時間をならして見て、重ければ一段軽く、余裕があれば一段戻す
      const dt = performance.now() - t0;
      this.cost = this.cost ? this.cost * 0.9 + dt * 0.1 : dt;
      if (this.n % 48 === 0) {
        if (this.cost > 22 && this.level < LEVELS.length - 1) { this.level++; this.cost = 0; }
        else if (this.cost < 8 && this.level > 0) { this.level--; this.cost = 0; }
      }
    }
  }

  testMask() {
    const a = new Float32Array(SEG_W * SEG_H);
    for (let y = 0; y < SEG_H; y++) for (let x = 0; x < SEG_W; x++) {
      const dx = (x - SEG_W / 2) / (SEG_W * 0.22); const dy = (y - SEG_H * 0.62) / (SEG_H * 0.5);
      a[y * SEG_W + x] = dx * dx + dy * dy < 1 ? 1 : 0;
    }
    this.applyMask(a, SEG_W, SEG_H);
  }

  // 確からしさ（0〜1）を、なめらかな透明度に。前の形と混ぜて、ちらつきを抑える
  applyMask(arr, w, h) {
    const d = this.maskData.data; const prev = this.prev; const n = SEG_W * SEG_H;
    const sx = w / SEG_W; const sy = h / SEG_H;
    const same = w === SEG_W && h === SEG_H;
    for (let i = 0; i < n; i++) {
      let c;
      if (same) c = arr[i]; else { const x = i % SEG_W; const y = (i / SEG_W) | 0; c = arr[((y * sy) | 0) * w + ((x * sx) | 0)]; }
      c = prev[i] * 0.35 + c * 0.65; prev[i] = c;
      // 0.35〜0.75 をなだらかにつなぐ
      let t = (c - 0.35) / 0.4; t = t < 0 ? 0 : t > 1 ? 1 : t; t = t * t * (3 - 2 * t);
      d[i * 4 + 3] = (t * 255) | 0;
    }
    this.mctx.putImageData(this.maskData, 0, 0);
    const sc = this.softCtx;
    sc.clearRect(0, 0, SEG_W, SEG_H);
    if ('filter' in sc) sc.filter = 'blur(1px)';
    sc.drawImage(this.mask, 0, 0);
    if ('filter' in sc) sc.filter = 'none';
  }

  compose(v, W, H) {
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, W, H);
    // 1) 人：映像を描き、マスクで切り抜く（拡大で縁がやわらかくなる）
    c.drawImage(v, 0, 0, W, H);
    c.globalCompositeOperation = 'destination-in';
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(this.soft, 0, 0, W, H);
    // 2) 背景：人の後ろに描く
    c.globalCompositeOperation = 'destination-over';
    if (this.mode === 'image' && this.image) this.drawCover(c, this.image, W, H);
    else this.drawBlur(c, v, W, H, this.mode === 'blur' ? 1 : 0.5);
    c.restore();
  }

  drawBlur(c, v, W, H, strength) {
    // 小さく縮めてぼかしてから引き伸ばす（軽くて、どのブラウザでも同じように見える）
    const bw = Math.round(W / (strength >= 1 ? 10 : 5)); const bh = Math.round(H / (strength >= 1 ? 10 : 5));
    if (this.blurC.width !== bw || this.blurC.height !== bh) { this.blurC.width = bw; this.blurC.height = bh; }
    const b = this.bctx;
    if ('filter' in b) b.filter = `blur(${strength >= 1 ? 3 : 1.5}px)`;
    b.drawImage(v, 0, 0, bw, bh);
    if ('filter' in b) b.filter = 'none';
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(this.blurC, 0, 0, W, H);
  }

  drawCover(c, img, W, H) {
    const iw = img.naturalWidth || img.width; const ih = img.naturalHeight || img.height;
    const r = Math.max(W / iw, H / ih);
    const w = iw * r; const h = ih * r;
    c.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  }
}

// 自分で選んだ画像を、背景にちょうどよい大きさ（最大 1280×720）の JPEG にする
export async function prepareCustomImage(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('PNG・JPEG・WebP の画像を選んでください');
  if (file.size > 15 * 1024 * 1024) throw new Error('画像が大きすぎます（15MB まで）');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const W = 1280; const H = 720;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const r = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    cv.getContext('2d').drawImage(img, (W - img.naturalWidth * r) / 2, (H - img.naturalHeight * r) / 2, img.naturalWidth * r, img.naturalHeight * r);
    return cv.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}
