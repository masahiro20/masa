// オーナー画面の起動・ナビゲーション・リアルタイム受信・イベント振り分け
import {
  S, esc, api, run, refresh, hooks, toast, chime, enableSound, closeModal, renderModals, applyKey, localStorageSet, localStorageGet,
} from './core.js';
import { renderHall, hallActions, hallChanges, callsFor } from './hall.js';
import { renderKitchen, kitchenActions, pendingCount, setKitchenRerender } from './kitchen.js';
import { renderCheckout, checkoutActions, goCheckout } from './checkout.js';
import { renderToday, todayActions, todayChange } from './today.js';
import { renderMenu, menuActions, menuInput, menuUpload, catInput } from './menu.js';
import { renderSales, salesActions, salesChanges } from './sales.js';
import { renderSettings, settingsActions, settingsInput, resetSettingsDraft } from './settings.js';
import { pickerActions, pickerInputs, staffOrderActions, staffOrderInputs, staffOrderChanges } from './ordering.js';

S.station = localStorageGet('cafe_station', 'all');

const VIEWS = [
  ['hall', 'ホール', renderHall],
  ['orders', '注文', renderKitchen],
  ['checkout', '会計', renderCheckout],
  ['today', '本日の準備', renderToday],
  ['menu', 'メニュー', renderMenu],
  ['sales', '売上', renderSales],
  ['settings', '設定', renderSettings],
];

const actions = {
  ...hallActions, ...kitchenActions, ...checkoutActions, ...todayActions, ...menuActions, ...salesActions, ...settingsActions,
  ...pickerActions, ...staffOrderActions,
};
const inputs = { ...pickerInputs, ...staffOrderInputs };
const changes = { ...hallChanges, ...salesChanges, ...staffOrderChanges };

const $root = document.getElementById('app');
let pin = '';

function setView(v) {
  if (v === 'settings' && S.view !== 'settings') resetSettingsDraft();
  S.view = v;
  localStorageSet('cafe_admin_view', v);
  renderAll();
  document.querySelector('.main')?.scrollTo(0, 0);
}
hooks.setView = setView;
hooks.goCheckout = (id) => goCheckout(id);
setKitchenRerender(() => renderMain());

function renderLogin() {
  $root.innerHTML = `<div class="login"><div class="card login-card">
    <div class="login-logo">☕</div><h1 class="serif">オーナー画面</h1><p class="muted small">PINを入力してください</p>
    <div class="pin-dots">${Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('')}</div>
    <div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => `<button class="key" data-act="pin" data-k="${k}">${k}</button>`).join('')}</div>
    <button class="btn btn-primary btn-lg btn-block" data-act="login" ${pin.length >= 4 ? '' : 'disabled'}>ログイン</button>
    <p class="small muted">初期PINは 1234 です。ログイン後「設定」から必ず変更してください。</p></div></div>`;
}

function badges() {
  const d = S.data;
  return {
    hall: d.calls.length,
    orders: pendingCount('all'),
    checkout: d.calls.filter((c) => c.type.includes('会計')).length,
  };
}

function headerHtml() {
  const d = S.data;
  const b = badges();
  return `<header class="hdr">
    <div class="brand serif">${esc(d.settings.shopName)}</div>
    <nav class="nav">${VIEWS.map(([k, label]) => `<button class="nav-btn ${S.view === k ? 'on' : ''}" data-act="view" data-v="${k}">${label}${b[k] ? `<span class="badge ${k === 'hall' ? 'pulse' : ''}">${b[k]}</span>` : ''}</button>`).join('')}</nav>
    <span class="spacer"></span>
    <button class="status-pill ${d.settings.orderingPaused ? 'off' : 'on'}" data-act="toggle-ordering" title="スマホ注文の受付">${d.settings.orderingPaused ? '⏸ 注文停止中' : '● 注文受付中'}</button>
    <button class="status-pill ${S.soundOn ? 'on' : 'off'}" data-act="sound">${S.soundOn ? '🔔' : '🔕 音をON'}</button>
    <span class="clock num" id="clock"></span>
  </header>`;
}

function renderMain() {
  if (!S.data) return;
  const main = document.querySelector('.main');
  if (!main) return renderAll();
  const view = VIEWS.find((v) => v[0] === S.view) || VIEWS[0];
  const scroll = main.scrollTop;
  main.innerHTML = view[2]();
  main.scrollTop = scroll;
  renderBadges();
}
function renderBadges() {
  const hdr = document.querySelector('.hdr');
  if (hdr) hdr.outerHTML = headerHtml();
  tick();
}
hooks.renderMain = renderMain;
hooks.renderBadges = renderBadges;

function renderAll() {
  if (S.needLogin) { renderLogin(); return; }
  if (!S.data) { $root.innerHTML = '<div class="empty">読み込み中…</div>'; return; }
  $root.innerHTML = `${headerHtml()}<main class="main"></main>`;
  renderMain();
  renderModals();
}
hooks.render = renderAll;

function tick() {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}
setInterval(tick, 10_000);
// 経過時間の表示を更新
setInterval(() => { if (S.data && ['hall', 'orders', 'checkout'].includes(S.view)) hooks.renderMain(); }, 30_000);

// ---- リアルタイム受信 ----
let es;
function connect() {
  es?.close();
  es = new EventSource('/api/admin/stream');
  es.addEventListener('open', () => refresh());
  es.addEventListener('order', async (e) => {
    const d = JSON.parse(e.data);
    chime('order');
    await refresh();
    toast(`🔔 ${d.tagNo != null ? `${d.tagNo}番` : 'カウンター'} から新しい注文（${d.count}点）`, 'notify', 8000);
  });
  es.addEventListener('call', async (e) => {
    const d = JSON.parse(e.data);
    chime('call');
    toast(`🔔 ${d.tagNo}番：${d.type}`, 'notify', 10000);
    await refresh();
  });
  for (const ev of ['changed', 'closed', 'opened', 'payment', 'staff-order', 'menu', 'settings', 'call-done']) {
    es.addEventListener(ev, () => refresh());
  }
}
// iPadがスリープから戻った時など
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.data) { refresh(); if (es?.readyState === 2) connect(); } });
setInterval(() => { if (document.visibilityState === 'visible' && S.data) refresh(); }, 20_000);

// ---- イベント振り分け ----
document.addEventListener('click', async (ev) => {
  if (!S.soundOn && S.data) { enableSound(); renderBadges(); }
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'modal-backdrop') { if (ev.target === el) closeModal(S.modals[Number(el.dataset.i)]); return; }
  if (act === 'modal-close') { closeModal(); return; }
  if (act === 'dlg') { S.modals.at(-1)?.resolve(el.dataset.v === '1'); return; }
  if (act === 'view') { setView(el.dataset.v); return; }
  if (act === 'sound') { enableSound(); chime(); renderBadges(); return; }
  if (act === 'toggle-ordering') {
    await run(async () => { await api('PUT', '/api/admin/settings', { orderingPaused: !S.data.settings.orderingPaused }); await refresh(); });
    toast(S.data.settings.orderingPaused ? 'スマホ注文を停止しました' : 'スマホ注文を再開しました');
    return;
  }
  if (act === 'pin') { pin = applyKey(pin, el.dataset.k, 12); renderLogin(); return; }
  if (act === 'login') {
    try {
      const r = await api('POST', '/api/admin/login', { pin });
      pin = '';
      S.needLogin = false;
      enableSound();
      await refresh();
      renderAll();
      connect();
      if (r.defaultPin) toast('初期PIN（1234）のままです。「設定」から変更してください', 'error', 8000);
    } catch (e) { pin = ''; renderLogin(); toast(e.message, 'error'); }
    return;
  }
  const fn = actions[act];
  if (fn) await fn(el, ev, renderMain);
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset.input && inputs[el.dataset.input]) { inputs[el.dataset.input](el); return; }
  if (el.type === 'checkbox' || el.tagName === 'SELECT') return;
  if (menuInput(el) || catInput(el)) return;
  if (S.view === 'settings') settingsInput(el);
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.change && changes[el.dataset.change]) { changes[el.dataset.change](el); return; }
  if (el.dataset.upload) { menuUpload(el); return; }
  if (el.type === 'checkbox' || el.tagName === 'SELECT') {
    if (menuInput(el)) return;
    if (S.view === 'settings' && settingsInput(el)) return;
  }
  if (S.view === 'today' && todayChange(el)) return;
});

// 入力欄でEnterを押したら確定（本日の準備の入力をすぐ保存）
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && S.view === 'today') ev.target.blur();
});

// ---- 起動 ----
(async () => {
  await refresh();
  if (S.needLogin) { renderLogin(); return; }
  renderAll();
  connect();
})();

export { callsFor };
