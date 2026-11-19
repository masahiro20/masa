// 会社の統一背景（名刺風）：ロゴと、入室したスタッフの肩書き・氏名を描く
// ロゴはホームランディックの公式サイトのもの（public/brand/）。文字は端末の中で描くだけで、外へは送らない。
const W = 1280; const H = 720;
const INK = '#231815';
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
let assets = null;
async function getAssets() {
  if (!assets) assets = Promise.all([loadImg('/static/brand/homelandick-logo.svg'), loadImg('/static/brand/homelandick-mark.svg')]);
  return assets;
}
async function fontsReady() {
  if (!document.fonts || !document.fonts.load) return;
  await Promise.race([
    Promise.all(['700 40px "Noto Sans JP"', '500 16px "Noto Sans JP"', '500 14px Inter'].map((f) => document.fonts.load(f).catch(() => {}))),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
}
const FONT = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';

export async function drawCard({ name = '', title = '' } = {}) {
  const [logo, mark] = await getAssets();
  await fontsReady();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  // 紙のような、あたたかい白
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#f7f5f1'); g.addColorStop(1, '#e7e2da');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const light = c.createRadialGradient(W * 0.2, H * 0.1, 0, W * 0.2, H * 0.1, W * 0.8);
  light.addColorStop(0, 'rgba(255,255,255,.55)'); light.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = light; c.fillRect(0, 0, W, H);
  // 右下に、大きなマークを透かしで
  c.save(); c.globalAlpha = 0.06;
  const mh = 560; const mw = mh * (mark.naturalWidth / mark.naturalHeight || 35 / 32);
  c.drawImage(mark, W - mw * 0.78, H - mh * 0.86, mw, mh);
  c.restore();
  // 左上：ロゴ
  const lh = 58; const lw = lh * (logo.naturalWidth / logo.naturalHeight || 254 / 54);
  c.drawImage(logo, 56, 52, lw, lh);
  // 右上：肩書き・氏名
  const x = W - 60; let y = 64;
  c.textAlign = 'right'; c.textBaseline = 'alphabetic';
  const spacing = (px) => { if ('letterSpacing' in c) c.letterSpacing = px; };
  if (title) {
    c.fillStyle = '#6f665d'; c.font = `500 19px ${FONT}`; spacing('3px');
    c.fillText(title, x + 3, y + 8); y += 34;
  } else y += 4;
  c.fillStyle = INK; c.font = `700 42px ${FONT}`; spacing('3px');
  const nm = String(name).slice(0, 20);
  c.fillText(nm, x + 3, y + 40); y += 62;
  spacing('0px');
  c.fillStyle = 'rgba(35,24,21,.55)'; c.fillRect(x - 40, y, 40, 2); y += 28;
  c.fillStyle = '#8a8178'; c.font = `500 14px Inter, ${FONT}`; spacing('1px');
  c.fillText('homelandick.com', x + 1, y);
  return cv;
}

// 選ぶ画面に出す小さな見本
export async function cardThumb(info) {
  const cv = await drawCard(info);
  const t = document.createElement('canvas'); t.width = 320; t.height = 180;
  t.getContext('2d').drawImage(cv, 0, 0, 320, 180);
  return t.toDataURL('image/png');
}
