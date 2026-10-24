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
fs.rmSync(path.join(OUT, 'admin.webmanifest'));

await build({
  entryPoints: [path.join(ROOT, 'demo/backend.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2021',
  minify: true,
  outfile: path.join(OUT, 'demo-shim.js'),
  alias: { 'node:fs': shim('empty.js'), 'node:path': shim('path.js'), 'node:url': shim('url.js') },
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
fs.copyFileSync(path.join(ROOT, 'demo/index.html'), path.join(OUT, 'index.html'));
console.log(`demo built → ${path.relative(process.cwd(), OUT)}/`);
