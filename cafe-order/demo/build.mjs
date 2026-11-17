// ブラウザだけで動くデモ版を dist-demo/ に作る:  npm run build:demo
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-demo');
const shim = (f) => path.join(ROOT, 'demo/shims', f);

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.rmSync(path.join(OUT, 'index.html'));
for (const f of ['admin.webmanifest', 'sw.js', 'paysim.html']) fs.rmSync(path.join(OUT, f));

await build({
  entryPoints: [path.join(ROOT, 'demo/backend.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2021',
  minify: true,
  outfile: path.join(OUT, 'demo-shim.js'),
  alias: { 'node:fs': shim('empty.js'), 'node:path': shim('path.js'), 'node:url': shim('url.js'), 'node:net': shim('empty.js'), 'node:crypto': shim('empty.js') },
  define: { 'import.meta.url': '"file:///demo/lib/app.js"' },
  logLevel: 'warning',
});

// 画面のHTMLを相対パスにして、アプリより先にデモ用バックエンドを読み込む
for (const name of ['admin.html', 'order.html']) {
  const f = path.join(OUT, name);
  let html = fs.readFileSync(f, 'utf8');
  html = html.replace(/<link rel="manifest"[^>]*>\n?\s*/, '')
    .replace(/(href|src)="\//g, '$1="./')
    .replace('<script type="module"', '<script src="./demo-shim.js"></script>\n  <script type="module"');
  fs.writeFileSync(f, html);
}
// 外枠のページ：<head> に入れるもの（title・meta・link・style）と本文に分けて、完全なHTMLにする
const page = fs.readFileSync(path.join(ROOT, 'demo/index.html'), 'utf8');
const bodyStart = page.indexOf('<header>');
fs.writeFileSync(path.join(OUT, 'index.html'), `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${page.slice(0, bodyStart).trim()}
</head>
<body>
${page.slice(bodyStart).trim()}
</body>
</html>
`);
console.log(`demo built → ${path.relative(process.cwd(), OUT)}/`);
