'use strict';
// 本番の組み立て（Vercel のビルド）で、背景ぼかし用の部品を自分のサイトに置く。
//   ・人と背景を分ける仕組み（Google MediaPipe、Apache-2.0）… npm から入れたものを写す
//   ・人の形を見分けるモデル（selfie segmenter、Apache-2.0）… Google の配布元から取得
// 映像の処理はすべて参加者の端末の中で行い、映像を外へ送ることはない。
// 取得に失敗しても組み立ては止めない（背景の機能が「使えません」と出るだけ）。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OUT = path.join(__dirname, '..', 'public', 'vendor', 'mediapipe');
const MODELS = [
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite',
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
];

function copyLib() {
  let dir;
  try { dir = path.dirname(require.resolve('@mediapipe/tasks-vision/package.json')); } catch (_) { return false; }
  fs.mkdirSync(path.join(OUT, 'wasm'), { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.mjs')) fs.copyFileSync(path.join(dir, f), path.join(OUT, f));
  for (const f of fs.readdirSync(path.join(dir, 'wasm'))) fs.copyFileSync(path.join(dir, 'wasm', f), path.join(OUT, 'wasm', f));
  fs.copyFileSync(path.join(dir, 'LICENSE'), path.join(OUT, 'LICENSE')); // 使用許諾の表示
  const v = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  console.log(`[vendor] @mediapipe/tasks-vision ${v} を写しました`);
  return true;
}

async function getModel() {
  for (const url of MODELS) {
    try {
      const r = await fetch(url);
      if (!r.ok) { console.log(`[vendor] ${url} → ${r.status}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 50000 || buf.length > 20e6) continue;
      fs.writeFileSync(path.join(OUT, 'segmenter.tflite'), buf);
      console.log(`[vendor] モデル ${path.basename(url)} ${buf.length} bytes sha256=${crypto.createHash('sha256').update(buf).digest('hex')}`);
      return true;
    } catch (e) { console.log(`[vendor] ${url} 取得失敗: ${e.message}`); }
  }
  return false;
}

(async () => {
  try {
    const lib = copyLib();
    const model = lib && await getModel();
    if (lib && model) fs.writeFileSync(path.join(OUT, 'ready.json'), JSON.stringify({ ok: true, at: new Date().toISOString() }));
    else console.log('[vendor] 背景の部品がそろわなかったため、背景の機能は無効のまま公開します');
  } catch (e) {
    console.log(`[vendor] 失敗（背景の機能は無効のまま）: ${e.message}`);
  }
})();
