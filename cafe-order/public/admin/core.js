// オーナー画面の共通部品（状態・通信・モーダル・通知音）
import { yen } from '/shared/calc.js';

export { yen };
export const S = {
  data: null,
  publicBase: '',
  view: localStorageGet('cafe_admin_view', 'hall'),
  modals: [],
  station: 'all',
  soundOn: false,
  needLogin: false,
};

export function localStorageGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
export function localStorageSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* noop */ } }

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const timeStr = (iso) => (iso ? new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '');
export const minutesSince = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
export const elapsed = (iso) => { const m = minutesSince(iso); return m < 60 ? `${m}分` : `${Math.floor(m / 60)}時間${m % 60}分`; };
export const tagLabel = (c) => (c.tagNo == null ? 'カウンター' : `${c.tagNo}番`);
export const checkById = (id) => S.data?.openChecks.find((c) => c.id === id);
export const itemById = (id) => S.data?.items.find((i) => i.id === id);
export const settings = () => S.data.settings;
export const uid = () => Math.random().toString(36).slice(2, 10);

// ---- 通信 ----
export async function api(method, path, body) {
  const res = await fetch(path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.endsWith('/login')) { S.needLogin = true; hooks.render(); }
  if (!res.ok) { const e = new Error(data.error || `通信に失敗しました (${res.status})`); e.code = data.code; throw e; }
  return data;
}

// 失敗したらトーストを出すだけの呼び出し
export async function run(fn) {
  try { return await fn(); } catch (e) { toast(e.message, 'error'); return undefined; }
}

// ---- 再描画 ----
export const hooks = { render: () => {}, renderMain: () => {} };

let refreshing = null;
let again = false;
export async function refresh() {
  // 取得中に新しい変更が届いたら、終わってからもう一度取り直す（取りこぼし防止）
  if (refreshing) { again = true; return refreshing; }
  refreshing = (async () => {
    try {
      do {
        again = false;
        const d = await api('GET', '/api/admin/state');
        S.publicBase = d.publicBase;
        S.data = d;
        S.needLogin = false;
      } while (again);
      softRender();
    } catch { /* 401 はログイン画面へ */ } finally { refreshing = null; }
  })();
  return refreshing;
}

// 入力中なら描き直しを入力完了まで待つ（キーボードが閉じないように）
let pending = false;
export function softRender() {
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'button' && a.type !== 'checkbox') {
    if (!pending) {
      pending = true;
      a.addEventListener('blur', () => { pending = false; setTimeout(softRender, 50); }, { once: true });
    }
    hooks.renderBadges?.();
    return;
  }
  hooks.renderMain();
  renderModals(true);
}

// ---- トースト ----
export function toast(msg, type = '', ms) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  el.addEventListener('click', () => el.remove());
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), ms || (type === 'error' ? 6000 : 3000));
}

// ---- モーダル（積み重ね可） ----
// m = { html: () => string, size: 'side'|'wide'|'', live: bool, onClose }
export function openModal(m) { S.modals.push(m); renderModals(); return m; }
export function closeModal(m) {
  const target = m || S.modals[S.modals.length - 1];
  S.modals = S.modals.filter((x) => x !== target);
  target?.onClose?.();
  renderModals();
}
export function closeAllModals() { S.modals = []; renderModals(); }
export function renderModals(liveOnly = false) {
  const root = document.getElementById('modals');
  if (!root) return;
  const prev = [...root.children];
  if (liveOnly && !S.modals.some((m) => m.live)) return;
  const prevCount = prev.length;
  const scrolls = prev.map((el) => el.querySelector('.modal')?.scrollTop || 0);
  root.innerHTML = S.modals.map((m, i) => `<div class="modal-backdrop ${m.size || ''} ${i >= prevCount ? 'enter' : ''}" data-act="modal-backdrop" data-i="${i}" style="z-index:${60 + i}">
    <div class="modal ${m.size || ''}" role="dialog" aria-modal="true">${m.html()}</div></div>`).join('');
  [...root.children].forEach((el, i) => { const md = el.querySelector('.modal'); if (md) md.scrollTop = scrolls[i] || 0; });
}
export function updateModal() { renderModals(); }

export function confirmDialog(message, { ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      html: () => `<div class="dialog"><p style="white-space:pre-line;font-size:17px">${esc(message)}</p>
        <div class="row" style="justify-content:flex-end;margin-top:16px">
          <button class="btn" data-act="dlg" data-v="0">キャンセル</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="dlg" data-v="1">${esc(ok)}</button></div></div>`,
      onClose: () => resolve(false),
      resolve: (v) => { m.onClose = null; closeModal(m); resolve(v); },
    });
  });
}

export function promptDialog(message, { value = '', placeholder = '', type = 'text', ok = 'OK' } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      html: () => `<div class="dialog"><p style="font-size:17px;margin-top:0">${esc(message)}</p>
        <input id="prompt-input" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${type === 'number' ? 'inputmode="numeric"' : ''}>
        <div class="row" style="justify-content:flex-end;margin-top:16px">
          <button class="btn" data-act="dlg" data-v="0">キャンセル</button>
          <button class="btn btn-primary" data-act="dlg" data-v="1">${esc(ok)}</button></div></div>`,
      onClose: () => resolve(null),
      resolve: (v) => { const val = document.getElementById('prompt-input')?.value ?? ''; m.onClose = null; closeModal(m); resolve(v ? val : null); },
    });
    setTimeout(() => document.getElementById('prompt-input')?.focus(), 50);
  });
}

// ---- 通知音・画面スリープ防止 ----
let audio;
export function enableSound() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
    S.soundOn = true;
  } catch { S.soundOn = false; }
  requestWakeLock();
}
export function chime(kind = 'order') {
  if (!S.soundOn || !audio || settings()?.newOrderSound === false) return;
  const notes = kind === 'call' ? [[880, 0], [660, 0.18], [880, 0.36]] : [[784, 0], [1047, 0.22]]; // ピン・ポーン
  const t0 = audio.currentTime + 0.02;
  for (const [f, dt] of notes) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + dt);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + dt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.6);
    o.connect(g).connect(audio.destination);
    o.start(t0 + dt); o.stop(t0 + dt + 0.65);
  }
}
let wakeLock = null;
export async function requestWakeLock() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* 非対応 */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.soundOn) requestWakeLock(); });

// ---- 印刷 ----
export function printHtml(html, { waitImages = false } = {}) {
  const area = document.getElementById('print-area');
  area.innerHTML = html;
  const go = () => setTimeout(() => window.print(), 50);
  if (!waitImages) return go();
  const imgs = [...area.querySelectorAll('img')];
  Promise.all(imgs.map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = r; im.onerror = r; })))).then(go);
}

// キーパッド（数字入力）
export function keypad(act, { extra = '' } = {}) {
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '⌫'];
  return `<div class="keypad">${keys.map((k) => `<button class="key" data-act="${act}" data-k="${k}">${k}</button>`).join('')}${extra}</div>`;
}
export function applyKey(cur, k, max = 9) {
  let s = String(cur ?? '');
  if (k === '⌫') s = s.slice(0, -1);
  else if (k === 'C') s = '';
  else if (s.length < max) s = (s === '0' ? '' : s) + k;
  return s.replace(/^0+(?=\d)/, '');
}
