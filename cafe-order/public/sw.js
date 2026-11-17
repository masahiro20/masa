// まめレジ（オーナー画面）を タブレットのホーム画面から素早く開くためのキャッシュ。
// 画面のファイルだけを保存し、注文・会計のデータ（/api/）は必ずサーバーから取る。
const CACHE = 'mamereji-v1';
const SHELL = ['/admin', '/admin.css', '/common.css', '/icon.svg', '/icon-192.png', '/shared/calc.js',
  ...['main', 'core', 'hall', 'kitchen', 'checkout', 'register', 'today', 'menu', 'sales', 'settings', 'ordering'].map((n) => `/admin/${n}.js`)];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 新しい版を優先し、つながらない時だけ保存した画面を出す
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && SHELL.includes(url.pathname)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request)));
});
