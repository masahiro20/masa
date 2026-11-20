// 背景の絵：会社の名刺（統一背景）と、落ち着いた背景のひとそろい
// すべて端末の中で描く（画像の取得や外部への送信はしない）。ロゴはホームランディック公式サイトのもの（public/brand/）。
const W = 1280; const H = 720;
const FONT = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

// ロゴは色を差し替えて使う（濃い色の版を白にする）
const logoCache = new Map();
async function logo(kind, color) {
  const key = `${kind}:${color}`;
  if (!logoCache.has(key)) {
    logoCache.set(key, (async () => {
      const txt = await (await fetch(`/static/brand/homelandick-${kind}.svg`)).text();
      const svg = txt.replace(/#231815/gi, color);
      return loadImg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    })());
  }
  return logoCache.get(key);
}

async function fontsReady() {
  if (!document.fonts || !document.fonts.load) return;
  await Promise.race([
    Promise.all(['600 42px "Noto Sans JP"', '400 18px "Noto Sans JP"'].map((f) => document.fonts.load(f).catch(() => {}))),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
}

// 細かな粒子（グラデーションの帯を消し、紙や塗り壁のような質感にする）
let grainCv = null;
function grain(c, alpha) {
  if (!grainCv) {
    grainCv = document.createElement('canvas'); grainCv.width = grainCv.height = 256;
    const g = grainCv.getContext('2d'); const d = g.createImageData(256, 256);
    for (let i = 0; i < d.data.length; i += 4) { const v = (Math.random() * 255) | 0; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0);
  }
  c.save(); c.globalAlpha = alpha; c.globalCompositeOperation = 'overlay';
  c.fillStyle = c.createPattern(grainCv, 'repeat'); c.fillRect(0, 0, W, H);
  c.restore();
}

// やわらかな光の当たった、無地の壁
function wall(c, center, edge, lightPos = [0.28, 0.18], lightAlpha = 0.1) {
  const g = c.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, W * 0.75);
  g.addColorStop(0, center); g.addColorStop(1, edge);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const l = c.createRadialGradient(W * lightPos[0], H * lightPos[1], 0, W * lightPos[0], H * lightPos[1], W * 0.7);
  l.addColorStop(0, `rgba(255,255,255,${lightAlpha})`); l.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = l; c.fillRect(0, 0, W, H);
}

const canvas = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; return [cv, cv.getContext('2d')]; };

// ---------- 会社の名刺 ----------
const CARD = {
  dark: { center: '#2b2f35', edge: '#121418', ink: '#ffffff', sub: 'rgba(255,255,255,.62)', rule: 'rgba(255,255,255,.35)', mark: 0.06, logo: '#ffffff', light: 0.07, grain: 0.06 },
  light: { center: '#f7f8f9', edge: '#d9dde2', ink: '#1b1d20', sub: '#6b727b', rule: 'rgba(27,29,32,.35)', mark: 0.06, logo: '#1b1d20', light: 0.35, grain: 0.05 },
};

export async function drawCard({ name = '', title = '', theme = 'dark' } = {}) {
  const t = CARD[theme] || CARD.dark;
  const [lg, mk] = await Promise.all([logo('logo', t.logo), logo('mark', t.logo)]);
  await fontsReady();
  const [cv, c] = canvas();
  wall(c, t.center, t.edge, [0.25, 0.15], t.light);
  // 右下に大きなマークを透かしで
  c.save(); c.globalAlpha = t.mark;
  const mh = 600; const mw = mh * (35 / 32);
  c.drawImage(mk, W - mw * 0.74, H - mh * 0.84, mw, mh);
  c.restore();
  grain(c, t.grain);
  // 左上：ロゴ
  const lh = 56; c.drawImage(lg, 60, 56, lh * (254 / 54), lh);
  // 右上：肩書き・氏名
  const x = W - 64; let y = 66;
  c.textAlign = 'right'; c.textBaseline = 'alphabetic';
  const sp = (px) => { if ('letterSpacing' in c) c.letterSpacing = px; };
  if (title) { c.fillStyle = t.sub; c.font = `400 18px ${FONT}`; sp('4px'); c.fillText(String(title).slice(0, 24), x + 4, y + 8); y += 34; } else y += 4;
  c.fillStyle = t.ink; c.font = `600 42px ${FONT}`; sp('4px');
  c.fillText(String(name).slice(0, 20), x + 4, y + 40); y += 64;
  sp('0px'); c.fillStyle = t.rule; c.fillRect(x - 44, y, 44, 1.5);
  return cv;
}

// ---------- 背景のひとそろい ----------
function plan(c, color, alpha) {
  // うっすらとした間取り図の線（建築事務所らしさ）
  c.save(); c.strokeStyle = color; c.globalAlpha = alpha; c.lineWidth = 2;
  const ox = 760; const oy = 120; const u = 46;
  const rect = (x, y, w, h) => c.strokeRect(ox + x * u, oy + y * u, w * u, h * u);
  rect(0, 0, 10, 10); rect(0, 0, 5, 4); rect(5, 0, 5, 6); rect(0, 4, 3, 6); rect(3, 6, 7, 4);
  c.lineWidth = 1;
  for (const [x, y, r, a0, a1] of [[5, 2.6, 1, Math.PI, Math.PI * 1.5], [3, 7.2, 1, 0, Math.PI / 2], [7, 6, 1, Math.PI / 2, Math.PI]]) { c.beginPath(); c.moveTo(ox + x * u, oy + y * u); c.arc(ox + x * u, oy + y * u, r * u, a0, a1); c.stroke(); }
  c.setLineDash([6, 8]); c.beginPath(); c.moveTo(ox - u, oy + 12 * u); c.lineTo(ox + 11 * u, oy + 12 * u); c.stroke();
  c.restore();
}

export const PRESETS = [
  { id: 'white', label: 'ホワイト', draw: (c) => { wall(c, '#fbfbfc', '#dfe2e6', [0.3, 0.1], 0.4); grain(c, 0.04); } },
  { id: 'gray', label: 'グレー', draw: (c) => { wall(c, '#c9cdd2', '#8d939a', [0.3, 0.15], 0.18); grain(c, 0.06); } },
  { id: 'charcoal', label: 'チャコール', draw: (c) => { wall(c, '#33373d', '#121417', [0.3, 0.12], 0.08); grain(c, 0.07); } },
  { id: 'navy', label: 'ネイビー', draw: (c) => { wall(c, '#26344a', '#0d141f', [0.3, 0.12], 0.08); grain(c, 0.07); } },
  { id: 'sage', label: 'セージ', draw: (c) => { wall(c, '#a9b3a6', '#66705f', [0.3, 0.12], 0.16); grain(c, 0.06); } },
  { id: 'plan', label: '図面', draw: (c) => { wall(c, '#f4f5f7', '#d6dae0', [0.3, 0.1], 0.35); plan(c, '#3d4a5c', 0.22); grain(c, 0.04); } },
];

const presetCache = new Map();
export function drawPreset(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return null;
  if (!presetCache.has(id)) { const [cv, c] = canvas(); p.draw(c); presetCache.set(id, cv); }
  return presetCache.get(id);
}

// 選ぶ画面に出す小さな見本
export function thumb(cv) {
  const t = document.createElement('canvas'); t.width = 320; t.height = 180;
  t.getContext('2d').drawImage(cv, 0, 0, 320, 180);
  return t.toDataURL('image/jpeg', 0.85);
}
export async function cardThumb(info) { return thumb(await drawCard(info)); }
