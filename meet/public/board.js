// COMPASS Meet — 書き込みの仕組み（画面共有への書き込み・ホワイトボード共通）
//
// ・映像そのものには書き込まず、映像の上に透明なキャンバスを重ねる
// ・座標は「共有されている中身（映像の枠・ホワイトボードの紙）」に対する 0〜1 の割合で持つ。
//   画面の大きさ・向き・解像度が人によって違っても、同じ場所に表示される
// ・やりとりは参加者どうしの WebRTC データチャネル（暗号化）。サーバーは通らない
// ・受け取った側で「その人に書く権限があるか」「消してよい図形か」を確かめる

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clamp01 = (v) => Math.max(-0.2, Math.min(1.2, Number(v) || 0));
const TOOLS = ['pen', 'line', 'arrow', 'rect', 'ellipse', 'text', 'note', 'image', 'eraser', 'move'];
export const COLORS = ['#c63d2f', '#1f5fbf', '#1d8a5a', '#d08a10', '#111111', '#ffffff'];
export const WIDTHS = [0.002, 0.004, 0.008];

// 受け取った図形を、決まった形・大きさに整える（壊れたデータや巨大なデータを入れない）
function sanitizeShape(s) {
  if (!s || typeof s !== 'object' || !TOOLS.includes(s.t) || s.t === 'eraser' || s.t === 'move') return null;
  const out = {
    id: String(s.id || '').slice(0, 24), t: s.t,
    color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#c63d2f',
    w: Math.min(0.03, Math.max(0.0005, Number(s.w) || 0.004)),
    by: String(s.by || '').slice(0, 64), name: String(s.name || '').slice(0, 30), at: Number(s.at) || Date.now(),
  };
  if (!out.id) return null;
  if (s.t === 'pen') out.pts = (Array.isArray(s.pts) ? s.pts.slice(0, 4000) : []).map((p) => [clamp01(p[0]), clamp01(p[1])]);
  else { out.a = [clamp01(s.a && s.a[0]), clamp01(s.a && s.a[1])]; out.b = [clamp01(s.b && s.b[0]), clamp01(s.b && s.b[1])]; }
  if (s.t === 'text' || s.t === 'note') out.text = String(s.text || '').slice(0, 300);
  if (s.t === 'image') out.asset = String(s.asset || '').slice(0, 24);
  return out;
}

export class Board {
  // getRect(): 中身の枠（キャンバス上の CSS ピクセル）。overlay なら映像の表示枠、whiteboard なら紙の枠
  constructor({ canvas, layer, me, canDraw, canEditOthers, send, getRect, onAuthors }) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.layer = layer; this.me = me; this.canDraw = canDraw; this.canEditOthers = canEditOthers;
    this.send = send; this.getRect = getRect; this.onAuthors = onAuthors || (() => {});
    this.shapes = []; this.assets = new Map(); this.images = new Map(); this.incoming = new Map();
    this.tool = 'pen'; this.color = COLORS[0]; this.width = WIDTHS[1];
    this.drawing = null; this.background = null; this.dirty = true; this.enabled = false;
    this._bind();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.canvas.style.pointerEvents = on ? 'auto' : 'none';
    this.canvas.style.touchAction = on ? 'none' : 'auto';
    this.canvas.classList.toggle('drawing', !!on);
  }

  // ---------- 座標 ----------
  toNorm(ev) {
    const r = this.canvas.getBoundingClientRect();
    const c = this.getRect();
    return [(ev.clientX - r.left - c.x) / c.w, (ev.clientY - r.top - c.y) / c.h];
  }
  toPx([x, y]) { const c = this.getRect(); return [c.x + x * c.w, c.y + y * c.h]; }

  // ---------- 入力 ----------
  _bind() {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => this._down(e));
    cv.addEventListener('pointermove', (e) => this._move(e));
    cv.addEventListener('pointerup', (e) => this._up(e));
    cv.addEventListener('pointercancel', (e) => this._up(e));
  }

  _down(e) {
    if (!this.enabled || !this.canDraw()) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.toNorm(e);
    if (this.tool === 'eraser') { this.drawing = { erase: true }; this._eraseAt(p); return; }
    if (this.tool === 'move') {
      const hit = this._hit(p);
      if (hit && this._mayEdit(hit, this.me().id, this.me().role)) this.drawing = { move: hit, last: p };
      return;
    }
    if (this.tool === 'text' || this.tool === 'note') {
      const text = window.prompt(this.tool === 'note' ? '付箋に書く内容' : '書き込む文字', '');
      if (text && text.trim()) this._commit({ t: this.tool, a: p, b: [p[0] + (this.tool === 'note' ? 0.16 : 0.2), p[1] + (this.tool === 'note' ? 0.12 : 0.04)], text: text.trim().slice(0, 300) });
      return;
    }
    const base = { id: uid(), t: this.tool, color: this.color, w: this.width, by: this.me().id, name: this.me().name, at: Date.now() };
    if (this.tool === 'pen') {
      base.pts = [p];
      this.drawing = { shape: base, pending: [] };
      this.shapes.push(base);
      this.send({ op: 'add', s: base });
    } else {
      base.a = p; base.b = p;
      this.drawing = { shape: base, preview: true };
    }
    this.dirty = true;
  }

  _move(e) {
    if (!this.drawing) return;
    const p = this.toNorm(e);
    const d = this.drawing;
    if (d.erase) return this._eraseAt(p);
    if (d.move) {
      const dx = p[0] - d.last[0]; const dy = p[1] - d.last[1];
      d.last = p; this._applyMove(d.move, dx, dy);
      d.acc = d.acc || [0, 0]; d.acc[0] += dx; d.acc[1] += dy;
      return;
    }
    if (d.shape.t === 'pen') {
      const last = d.shape.pts[d.shape.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.0015) return;
      d.shape.pts.push(p); d.pending.push(p);
      // 書いている途中の線も少しずつ送る（相手の画面にもリアルタイムで出る）
      if (!d.timer) d.timer = setTimeout(() => { this._flush(d); }, 40);
    } else {
      d.shape.b = p;
    }
    this.dirty = true;
  }

  _flush(d) {
    if (!d || !d.shape) return;
    clearTimeout(d.timer); d.timer = null;
    if (d.pending.length) { this.send({ op: 'pts', id: d.shape.id, pts: d.pending }); d.pending = []; }
  }

  _up() {
    const d = this.drawing;
    this.drawing = null;
    if (!d) return;
    if (d.move) { if (d.acc) this.send({ op: 'mv', id: d.move.id, dx: d.acc[0], dy: d.acc[1] }); return; }
    if (d.erase) return;
    if (d.shape.t === 'pen') { this._flush(d); this.send({ op: 'end', id: d.shape.id }); this._authors(); return; }
    const s = d.shape;
    if (Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) < 0.004) { this.dirty = true; return; }
    this._commit(s, true);
  }

  _commit(partial, hasId) {
    const s = hasId ? partial : { id: uid(), color: this.color, w: this.width, by: this.me().id, name: this.me().name, at: Date.now(), ...partial };
    this.shapes.push(s);
    this.send({ op: 'add', s });
    this.dirty = true; this._authors();
  }

  addImage(dataUrl, aspect) {
    const asset = uid();
    this.assets.set(asset, dataUrl);
    this._loadImage(asset, dataUrl);
    const w = 0.6; const h = Math.min(0.9, w / (aspect || 1.4) * (this.getRect().w / this.getRect().h));
    this.send({ op: 'asset', id: asset, data: dataUrl });
    this._commit({ t: 'image', a: [0.2, 0.05], b: [0.2 + w, 0.05 + h], asset });
  }

  setBackground(dataUrl) { // ホワイトボードの下敷き（図面など）
    const asset = uid();
    this.assets.set(asset, dataUrl);
    this._loadImage(asset, dataUrl);
    this.background = asset;
    this.send({ op: 'asset', id: asset, data: dataUrl });
    this.send({ op: 'bg', asset });
    this.dirty = true;
  }

  _loadImage(id, dataUrl) {
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) return;
    const img = new Image();
    img.onload = () => { this.images.set(id, img); this.dirty = true; };
    img.src = dataUrl;
  }

  _hit(p) {
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const s = this.shapes[i];
      const tol = 0.012 + s.w;
      if (s.t === 'pen') { if (s.pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < tol)) return s; continue; }
      const x0 = Math.min(s.a[0], s.b[0]) - tol; const x1 = Math.max(s.a[0], s.b[0]) + tol;
      const y0 = Math.min(s.a[1], s.b[1]) - tol; const y1 = Math.max(s.a[1], s.b[1]) + tol;
      if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) return s;
    }
    return null;
  }

  _mayEdit(s, byId, role) { return s.by === byId || (role === 'host' && this.canEditOthers()); }

  _eraseAt(p) {
    const hit = this._hit(p);
    if (!hit || !this._mayEdit(hit, this.me().id, this.me().role)) return;
    this._remove([hit.id]);
    this.send({ op: 'del', ids: [hit.id] });
  }

  _applyMove(s, dx, dy) {
    if (s.t === 'pen') s.pts = s.pts.map((q) => [q[0] + dx, q[1] + dy]);
    else { s.a = [s.a[0] + dx, s.a[1] + dy]; s.b = [s.b[0] + dx, s.b[1] + dy]; }
    this.dirty = true;
  }

  _remove(ids) { const set = new Set(ids); this.shapes = this.shapes.filter((s) => !set.has(s.id)); this.dirty = true; this._authors(); }

  undo() {
    const mine = [...this.shapes].reverse().find((s) => s.by === this.me().id);
    if (!mine) return;
    this._remove([mine.id]);
    this.send({ op: 'del', ids: [mine.id] });
  }

  clear(scope) { // 'all'（主催者のみ）か 'mine'
    if (scope === 'all' && this.me().role !== 'host') return;
    if (scope === 'all') { this.shapes = []; this.background = null; } else this.shapes = this.shapes.filter((s) => s.by !== this.me().id);
    this.send({ op: 'clear', scope });
    this.dirty = true; this._authors();
  }

  // ---------- 受信（相手の権限・持ち主を確かめる） ----------
  receive(op, from, mayDraw) {
    // from = { id, role }
    if (!op || typeof op !== 'object') return;
    if (op.op === 'snapshot') {
      if (from.role !== 'host') return; // 全体の上書きは主催者からだけ受け付ける
      this.shapes = (Array.isArray(op.shapes) ? op.shapes.slice(0, 3000) : []).map(sanitizeShape).filter(Boolean);
      this.background = typeof op.bg === 'string' ? op.bg.slice(0, 24) : null;
      this.dirty = true; this._authors();
      return;
    }
    if (op.op === 'asset' || op.op === 'asset-chunk') return this._receiveAsset(op);
    if (!mayDraw) return; // 書く権限のない人からの書き込みは無視
    if (op.op === 'add') {
      const s = sanitizeShape(op.s);
      if (!s || s.by !== from.id) return; // 他人になりすました図形は入れない
      if (this.shapes.some((x) => x.id === s.id)) return;
      if (this.shapes.length >= 3000) return;
      this.shapes.push(s);
    } else if (op.op === 'pts') {
      const s = this.shapes.find((x) => x.id === op.id);
      if (!s || s.by !== from.id || s.t !== 'pen' || !Array.isArray(op.pts)) return;
      if (s.pts.length + op.pts.length > 4000) return;
      for (const q of op.pts.slice(0, 500)) s.pts.push([clamp01(q[0]), clamp01(q[1])]);
    } else if (op.op === 'end') {
      this._authors();
    } else if (op.op === 'del') {
      const ids = (Array.isArray(op.ids) ? op.ids : []).filter((id) => {
        const s = this.shapes.find((x) => x.id === id);
        return s && (s.by === from.id || from.role === 'host');
      });
      this._remove(ids);
    } else if (op.op === 'mv') {
      const s = this.shapes.find((x) => x.id === op.id);
      if (!s || !(s.by === from.id || from.role === 'host')) return;
      this._applyMove(s, Math.max(-1, Math.min(1, Number(op.dx) || 0)), Math.max(-1, Math.min(1, Number(op.dy) || 0)));
    } else if (op.op === 'clear') {
      if (op.scope === 'all') { if (from.role !== 'host') return; this.shapes = []; this.background = null; } else this.shapes = this.shapes.filter((s) => s.by !== from.id);
      this._authors();
    } else if (op.op === 'bg') {
      if (from.role !== 'host' && !mayDraw) return;
      this.background = String(op.asset || '').slice(0, 24);
    }
    this.dirty = true;
  }

  _receiveAsset(op) {
    if (op.op === 'asset') {
      if (typeof op.data !== 'string' || op.data.length > 3_000_000) return;
      this.assets.set(String(op.id).slice(0, 24), op.data);
      this._loadImage(String(op.id).slice(0, 24), op.data);
      return;
    }
    // 大きな画像は分けて届く
    const id = String(op.id).slice(0, 24);
    const n = Math.min(Number(op.n) || 0, 400);
    if (!n) return;
    const buf = this.incoming.get(id) || { n, parts: [] };
    buf.parts[Number(op.i)] = String(op.data || '');
    this.incoming.set(id, buf);
    if (buf.parts.filter((x) => x !== undefined).length === n) {
      this.incoming.delete(id);
      this._receiveAsset({ op: 'asset', id, data: buf.parts.join('') });
    }
  }

  snapshot() { return { op: 'snapshot', shapes: this.shapes, bg: this.background }; }
  assetOps() { return [...this.assets].map(([id, data]) => ({ op: 'asset', id, data })); }

  _authors() {
    const m = new Map();
    for (const s of this.shapes) { const e = m.get(s.by) || { name: s.name, color: s.color, n: 0 }; e.n++; e.color = s.color; m.set(s.by, e); }
    this.onAuthors([...m.values()]);
  }

  // ---------- 描画 ----------
  _loop() {
    const cv = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cv.clientWidth * dpr); const h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; this.dirty = true; }
    const fresh = this.shapes.some((s) => Date.now() - s.at < 4500);
    if (this.dirty || fresh || this.drawing) { this.render(this.ctx, dpr, this.getRect(), true); this.dirty = false; }
    requestAnimationFrame(this._loop);
  }

  render(ctx, scale, rect, live) {
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (live) ctx.clearRect(0, 0, ctx.canvas.width / scale, ctx.canvas.height / scale);
    if (this.layer === 'wb') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      const bg = this.background && this.images.get(this.background);
      if (bg) {
        const s = Math.min(rect.w / bg.width, rect.h / bg.height);
        ctx.drawImage(bg, rect.x + (rect.w - bg.width * s) / 2, rect.y + (rect.h - bg.height * s) / 2, bg.width * s, bg.height * s);
      }
    }
    const P = ([x, y]) => [rect.x + x * rect.w, rect.y + y * rect.h];
    const list = this.drawing && this.drawing.preview ? [...this.shapes, this.drawing.shape] : this.shapes;
    for (const s of list) {
      const lw = Math.max(1, s.w * rect.w);
      ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (s.t === 'pen' && s.pts.length) {
        ctx.beginPath();
        const [x0, y0] = P(s.pts[0]); ctx.moveTo(x0, y0);
        for (const q of s.pts.slice(1)) { const [x, y] = P(q); ctx.lineTo(x, y); }
        if (s.pts.length === 1) ctx.lineTo(x0 + 0.1, y0 + 0.1);
        ctx.stroke();
      } else if (s.t === 'line' || s.t === 'arrow') {
        const [ax, ay] = P(s.a); const [bx, by] = P(s.b);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        if (s.t === 'arrow') {
          const ang = Math.atan2(by - ay, bx - ax); const hl = Math.max(10, lw * 4);
          ctx.beginPath(); ctx.moveTo(bx, by);
          ctx.lineTo(bx - hl * Math.cos(ang - 0.45), by - hl * Math.sin(ang - 0.45));
          ctx.lineTo(bx - hl * Math.cos(ang + 0.45), by - hl * Math.sin(ang + 0.45));
          ctx.closePath(); ctx.fill();
        }
      } else if (s.t === 'rect' || s.t === 'ellipse') {
        const [ax, ay] = P(s.a); const [bx, by] = P(s.b);
        ctx.beginPath();
        if (s.t === 'rect') ctx.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
        else ctx.ellipse((ax + bx) / 2, (ay + by) / 2, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.t === 'text') {
        const [ax, ay] = P(s.a);
        ctx.font = `600 ${Math.max(12, rect.w * 0.022)}px "Noto Sans JP", sans-serif`;
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3; ctx.strokeStyle = s.color === '#ffffff' ? '#111' : '#fff';
        ctx.strokeText(s.text, ax, ay); ctx.fillText(s.text, ax, ay);
      } else if (s.t === 'note') {
        const [ax, ay] = P(s.a); const [bx, by] = P(s.b);
        ctx.fillStyle = '#fff3b0'; ctx.strokeStyle = '#e0c860'; ctx.lineWidth = 1;
        ctx.fillRect(ax, ay, bx - ax, by - ay); ctx.strokeRect(ax, ay, bx - ax, by - ay);
        ctx.fillStyle = '#3a3220';
        const fs = Math.max(11, rect.w * 0.014);
        ctx.font = `${fs}px "Noto Sans JP", sans-serif`; ctx.textBaseline = 'top';
        wrapText(ctx, s.text, ax + 8, ay + 8, bx - ax - 16, fs * 1.4, by - ay - 16);
      } else if (s.t === 'image') {
        const img = this.images.get(s.asset);
        const [ax, ay] = P(s.a); const [bx, by] = P(s.b);
        if (img) ctx.drawImage(img, ax, ay, bx - ax, by - ay);
        else { ctx.strokeStyle = '#999'; ctx.setLineDash([6, 6]); ctx.strokeRect(ax, ay, bx - ax, by - ay); ctx.setLineDash([]); }
      }
      // 書いた人の名前を、書いた直後にしばらく出す
      if (live && s.name && Date.now() - s.at < 4500) {
        const end = s.t === 'pen' ? s.pts[s.pts.length - 1] : s.b;
        if (end) {
          const [x, y] = P(end);
          ctx.globalAlpha = Math.max(0, 1 - (Date.now() - s.at - 3000) / 1500);
          ctx.font = '600 12px "Noto Sans JP", sans-serif';
          const tw = ctx.measureText(s.name).width + 12;
          ctx.fillStyle = s.color === '#ffffff' ? '#333' : s.color;
          roundRect(ctx, x + 6, y + 6, tw, 20, 4); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(s.name, x + 12, y + 16);
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.restore();
  }

  // 書き込み結果を画像に（overlay は映像の 1 コマと重ねる）
  exportPng(video) {
    const W = this.layer === 'ann' && video && video.videoWidth ? video.videoWidth : 1920;
    const H = this.layer === 'ann' && video && video.videoHeight ? video.videoHeight : Math.round(1920 / this.aspect());
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if (this.layer === 'ann' && video) ctx.drawImage(video, 0, 0, W, H);
    else { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); }
    this.render(ctx, 1, { x: 0, y: 0, w: W, h: H }, false);
    return c.toDataURL('image/png');
  }

  aspect() { const r = this.getRect(); return r.w / r.h || 16 / 10; }
  toJSON() { return { v: 1, shapes: this.shapes, bg: this.background, assets: Object.fromEntries(this.assets) }; }
  loadJSON(j, { broadcast } = {}) {
    if (!j || j.v !== 1) throw new Error('形式が違います');
    this.assets = new Map(Object.entries(j.assets || {}).slice(0, 50));
    for (const [id, d] of this.assets) this._loadImage(id, d);
    this.shapes = (j.shapes || []).map(sanitizeShape).filter(Boolean);
    this.background = j.bg || null;
    this.dirty = true; this._authors();
    if (broadcast) { for (const op of this.assetOps()) this.send(op); this.send(this.snapshot()); }
  }
}

function wrapText(ctx, text, x, y, maxW, lh, maxH) {
  let line = ''; let yy = y;
  for (const ch of String(text)) {
    if (ch === '\n' || ctx.measureText(line + ch).width > maxW) {
      ctx.fillText(line, x, yy); yy += lh; line = ch === '\n' ? '' : ch;
      if (yy - y > maxH) return;
    } else line += ch;
  }
  ctx.fillText(line, x, yy);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// 画像ファイルを、送れる大きさ（長辺 1600px・JPEG）にしてから読み込む
export function fileToDataUrl(file, max = 1600) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('PNG・JPEG・WebP の画像を選んでください'));
    if (file.size > 20 * 1024 * 1024) return reject(new Error('画像が大きすぎます（20MB まで）'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ dataUrl: c.toDataURL('image/jpeg', 0.85), aspect: c.width / c.height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}

// PDF（任意）：pdf.js を自サーバーに置いたときだけ使える（/static/vendor/pdfjs/）
export async function pdfToDataUrl(file, page = 1) {
  let pdfjs;
  try {
    pdfjs = await import('/static/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/static/vendor/pdfjs/pdf.worker.min.mjs';
  } catch (_) {
    throw new Error('PDF の読み込みは準備中です。図面を PNG か JPEG に書き出してから読み込んでください。');
  }
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  const p = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
  const vp = p.getViewport({ scale: 1 });
  const scale = Math.min(2.5, 2000 / Math.max(vp.width, vp.height));
  const v2 = p.getViewport({ scale });
  const c = document.createElement('canvas'); c.width = v2.width; c.height = v2.height;
  await p.render({ canvasContext: c.getContext('2d'), viewport: v2 }).promise;
  return { dataUrl: c.toDataURL('image/jpeg', 0.88), aspect: c.width / c.height, pages: doc.numPages };
}
