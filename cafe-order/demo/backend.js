// ブラウザだけで動くデモ版のバックエンド。
// 本物のサーバー処理（lib/app.js）をページ内で動かし、fetch と EventSource をそこへつなぐ。
// iPad枠とスマホ枠は localStorage と BroadcastChannel で同じ店の状態を共有する。
import { createApp } from '../lib/app.js';
import { LocalStore } from './local-store.js';

const PREFIX = 'cafe-demo:';
const DEMO_PIN = '1234';

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* noop */ } };

// ---- リアルタイム通知（同じ画面＋他の画面へ） ----
const sources = new Set();
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('cafe-demo') : null;
let queue = null;
function deliver(ev) { for (const es of sources) es.deliver(ev); }
function emit(ev) {
  if (queue) { queue.push(ev); return; }
  deliver(ev);
  channel?.postMessage(ev);
}
if (channel) channel.onmessage = (m) => deliver(m.data);

const store = new LocalStore(PREFIX);
const app = createApp({ store, onEvent: emit });

// ---- 疑似HTTPリクエスト ----
function request(method, url, body) {
  store.reload();
  queue = [];
  const req = {
    method, url, body: body ? JSON.parse(body) : {}, on() {},
    headers: { cookie: lsGet(`${PREFIX}cookie`) || '', host: location.host || 'demo', 'x-forwarded-proto': (location.protocol || 'https:').replace(':', '') },
    socket: { remoteAddress: 'demo' },
  };
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {}, chunks: [], headersSent: false,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      writeHead(status, h = {}) { this.statusCode = status; for (const [k, v] of Object.entries(h)) this.setHeader(k, v); this.headersSent = true; },
      write(c) { this.chunks.push(String(c)); },
      end(c) { if (c != null) this.chunks.push(String(c)); resolve(this); },
    };
    app.handle(req, res);
  }).then((res) => {
    if (method !== 'GET') store.saveNow();
    const events = queue;
    queue = null;
    for (const ev of events) emit(ev);
    const sc = res.headers['set-cookie'];
    if (sc) {
      const v = /^cafe_admin=([^;]*)/.exec(sc)?.[1] || '';
      lsSet(`${PREFIX}cookie`, v && !/Max-Age=0/.test(sc) ? `cafe_admin=${v}` : null);
    }
    return res;
  });
}

async function call(method, url, body) {
  const res = await request(method, url, body ? JSON.stringify(body) : undefined);
  const text = res.chunks.join('');
  return (res.headers['content-type'] || '').includes('json') ? JSON.parse(text) : text;
}

// ---- 初回だけ、触ってすぐ分かるようにお店の営業中の様子を用意する ----
async function seed() {
  if (lsGet(`${PREFIX}seeded`)) return;
  await call('POST', '/api/admin/login', { pin: DEMO_PIN });
  await call('PUT', '/api/admin/settings', { notice: 'デモ版です。自由に注文・会計してみてください。' });
  const patch = (id, groupId, choiceId, detail) => call('PATCH', `/api/admin/items/${id}`, { choice: { groupId, choiceId, detail } });
  await patch('basque', 'flavor', 'l1', '和栗');
  await patch('basque', 'flavor', 'l2', 'ほうじ茶');
  await patch('scone', 'kind', 'daily', 'かぼちゃ');
  await patch('single', 'bean', 'b1', 'エチオピア');
  await patch('single', 'bean', 'b2', 'グアテマラ');
  await call('PATCH', '/api/admin/items/pudding', { stock: 3 });

  const state = await call('GET', '/api/admin/state');
  const key = (no) => state.tags.find((t) => t.no === no).key;
  const order = (no, name, people, lines) => call('POST', '/api/c/order', { tag: no, k: key(no), device: `seed-${no}`, name, people, knownCheckId: null, lines });

  // 2番：常連さんが注文済み（ケーキは提供済み）
  const a = await order(2, 'みか', 2, [
    { itemId: 'blend', qty: 1, sel: { temp: ['hot'] }, timing: 'after' },
    { itemId: 'basque', qty: 1, sel: { flavor: ['l1'] } },
    { itemId: 'latte', qty: 1, sel: { temp: ['ice'], milk: ['oat'] } },
  ]);
  const cake = a.check?.orders[0].lines.find((l) => l.name === 'バスクチーズケーキ');
  if (cake) await call('POST', `/api/admin/checks/${a.check.id}/lines/${cake.id}`, { status: 'served' });
  // 5番：注文が入ったばかり＋お会計の呼び出し
  await order(5, 'たろう', 1, [
    { itemId: 'napolitan', qty: 1, sel: { size: ['large'], set: ['blend-h'] } },
    { itemId: 'soda', qty: 1, sel: { color: ['melon'] } },
  ]);
  await call('POST', '/api/c/call', { tag: 5, k: key(5), type: 'お会計をお願いします' });

  // 売上画面が空にならないよう、会計済みを2件
  for (const [lines, method] of [
    [[{ itemId: 'eggsand', qty: 1, sel: { set: ['blend-h'] } }], '現金'],
    [[{ itemId: 'pudding', qty: 2, sel: {} }, { itemId: 'tea', qty: 2, sel: { leaf: ['earl'] } }], 'クレジットカード'],
  ]) {
    const c = (await call('POST', '/api/admin/checks', { tagNo: null, people: 2 })).check;
    const r = await call('POST', `/api/admin/checks/${c.id}/orders`, { lines });
    const total = r.check.orders.flatMap((o) => o.lines).reduce((s, l) => s + l.unitPrice * l.qty, 0);
    await call('POST', `/api/admin/checks/${c.id}/payments`, { method, amount: total });
    await call('POST', `/api/admin/checks/${c.id}/serve`, {});
  }
  lsSet(`${PREFIX}seeded`, '1');
}

async function init() {
  await seed();
  // オーナー画面はPIN入力なしで開く
  if (!lsGet(`${PREFIX}cookie`)) await call('POST', '/api/admin/login', { pin: DEMO_PIN });
}
const ready = init().catch((e) => console.error('demo init failed', e));

// ---- fetch / EventSource の差し替え ----
const realFetch = window.fetch?.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return realFetch(input, init);
  await ready;
  if (url.startsWith('/api/admin/upload')) {
    return new Response(JSON.stringify({ error: 'デモ版では写真を追加できません（絵文字で表示されます）' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const res = await request(init.method || 'GET', url, init.body);
  return new Response(res.chunks.join(''), { status: res.statusCode, headers: { 'Content-Type': res.headers['content-type'] || 'application/json' } });
};

class DemoEventSource {
  constructor(url) {
    const u = new URL(url, 'http://demo.local');
    this.url = url;
    this.kind = u.pathname === '/api/admin/stream' ? 'admin' : 'tag';
    this.tagNo = Number(u.searchParams.get('tag'));
    this.readyState = 0;
    this.listeners = new Map();
    sources.add(this);
    ready.then(() => { this.readyState = 1; this.dispatch('open', '{}'); });
  }
  accepts(ev) {
    if (this.kind === 'admin') return ev.target === 'admin';
    return ev.target === 'customers' || (ev.target === 'tag' && ev.tagNo === this.tagNo);
  }
  deliver(ev) { if (this.readyState === 1 && this.accepts(ev)) this.dispatch(ev.event, JSON.stringify(ev.data || {})); }
  dispatch(type, data) {
    const e = new MessageEvent(type, { data });
    for (const fn of this.listeners.get(type) || []) fn(e);
    if (type === 'message') this.onmessage?.(e);
  }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  close() { this.readyState = 2; sources.delete(this); }
}
window.EventSource = DemoEventSource;

// ---- 画像・印刷・ダウンロード（デモでできないこと）の代わり ----
function demoToast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:200;background:#2b211b;color:#fffaf3;padding:12px 18px;border-radius:12px;font:600 14px/1.5 system-ui,sans-serif;max-width:90vw;box-shadow:0 6px 20px rgba(0,0,0,.3)';
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

// QRコード画像（/api/admin/qr/N）をページ内で生成
async function fixQr(img) {
  const src = img.getAttribute('src') || '';
  if (!src.startsWith('/api/admin/qr/')) return;
  img.removeAttribute('src');
  const svg = await call('GET', src.split('?')[0]);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
new MutationObserver((list) => {
  for (const m of list) for (const n of m.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.tagName === 'IMG') fixQr(n);
    n.querySelectorAll?.('img[src^="/api/admin/qr/"]').forEach(fixQr);
  }
}).observe(document.documentElement, { childList: true, subtree: true });

// 印刷の代わりにプレビューを表示
window.print = () => {
  const area = document.getElementById('print-area');
  if (!area) return;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:150;background:rgba(20,12,6,.55);display:flex;align-items:center;justify-content:center;padding:16px';
  el.innerHTML = `<div style="background:#fff;color:#000;border-radius:14px;max-width:min(860px,100%);max-height:100%;overflow:auto;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.35)">
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;font:600 14px system-ui,sans-serif">印刷プレビュー（デモ版では実際には印刷されません）<span style="flex:1"></span>
    <button type="button" style="font:inherit;padding:8px 14px;border-radius:10px;border:1px solid #ccc;background:#f5f5f5">閉じる</button></div>${area.innerHTML}</div>`;
  el.addEventListener('click', (ev) => { if (ev.target === el || ev.target.closest('button')) el.remove(); });
  document.body.append(el);
};

document.addEventListener('click', (ev) => {
  const a = ev.target.closest?.('a[href^="/api/"]');
  if (!a) return;
  ev.preventDefault();
  ev.stopPropagation();
  demoToast('デモ版ではCSV・バックアップの保存はできません（実際のシステムではそのまま保存できます）');
}, true);

// ---- デモページ（外枠）から使う ----
window.__cafeDemo = {
  ready,
  tags: () => { store.reload(); return store.state.tags; },
  reset() {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX) || k.startsWith('cafe_')) localStorage.removeItem(k);
    } catch { /* noop */ }
  },
};
