// お客様のスマホ注文画面（番号札のQRから開く）
import { yen, choiceLabel } from '/shared/calc.js';

const tagNo = Number(location.pathname.split('/')[2]);
const key = new URLSearchParams(location.search).get('k') || '';
const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* プライベートモードなど */ } },
};
const deviceId = store.get('cafe_device') || (() => {
  const id = (crypto.randomUUID?.() || String(Math.random()).slice(2)) + '';
  store.set('cafe_device', id);
  return id;
})();
const CART_KEY = `cafe_cart_${tagNo}`;
const SEEN_KEY = `cafe_seen_check_${tagNo}`;

const S = {
  ses: null,
  view: 'menu',
  cart: store.get(CART_KEY, []),
  name: store.get('cafe_name', ''),
  people: 0,
  sheet: null, // {type:'item', item, sel, qty, note, timing, editIndex} | {type:'cart'} | {type:'call'}
  sending: false,
  closedNotice: false,
  unavailable: new Set(),
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 2600);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || '通信に失敗しました'); e.code = data.code; e.status = res.status; throw e; }
  return data;
}

// ---- データ取得 ----
let loading = null;
async function load() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const ses = await api('GET', `/api/c/session?tag=${tagNo}&k=${encodeURIComponent(key)}&device=${encodeURIComponent(deviceId)}`);
      const seen = store.get(SEEN_KEY, null);
      // 前に見ていた伝票が無くなった＝お会計済み
      if (seen && (!ses.check || ses.check.id !== seen)) S.closedNotice = !ses.check;
      store.set(SEEN_KEY, ses.check?.id || null);
      S.ses = ses;
      document.title = `${ses.shop.name}｜${ses.tagNo}番 ご注文`;
      if (ses.check?.myName && !S.name) S.name = ses.check.myName;
      validateCart();
      render();
    } catch (e) {
      if (e.code === 'bad_tag') renderFatal(e.message);
      else if (!S.ses) renderFatal('通信できませんでした。電波の良い場所で再読み込みしてください。');
      else toast(e.message, 'error');
    } finally { loading = null; }
  })();
  return loading;
}

function connect() {
  if (!window.EventSource) return;
  const es = new EventSource(`/api/c/stream?tag=${tagNo}&k=${encodeURIComponent(key)}`);
  let t;
  es.addEventListener('changed', () => { clearTimeout(t); t = setTimeout(load, 250); });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30000);

// ---- カート ----
const findItem = (id) => S.ses?.menu.items.find((i) => i.id === id);
const lineKey = (l) => JSON.stringify([l.itemId, l.sel, l.note, l.timing]);

function previewPrice(item, sel) {
  let p = item.price;
  for (const g of item.optionGroups) for (const cid of sel[g.id] || []) p += g.choices.find((c) => c.id === cid)?.price || 0;
  return p;
}
function optionLabels(item, sel) {
  const out = [];
  for (const g of item.optionGroups) for (const cid of sel[g.id] || []) {
    const c = g.choices.find((x) => x.id === cid);
    if (c) out.push(choiceLabel(c));
  }
  return out;
}
function saveCart() { store.set(CART_KEY, S.cart); }
function cartCount() { return S.cart.reduce((s, l) => s + l.qty, 0); }
function cartTotal() {
  return S.cart.reduce((s, l) => { const it = findItem(l.itemId); return s + (it ? previewPrice(it, l.sel) * l.qty : 0); }, 0);
}
// メニュー更新（売り切れなど）でカートの商品が注文できなくなっていないか
function validateCart() {
  S.unavailable = new Set();
  for (const l of S.cart) {
    const it = findItem(l.itemId);
    const soldChoice = it && it.optionGroups.some((g) => (l.sel[g.id] || []).some((cid) => { const c = g.choices.find((x) => x.id === cid); return !c || c.soldOut; }));
    if (!it || !it.orderable || soldChoice) S.unavailable.add(lineKey(l));
  }
}

// ---- 描画 ----
function renderFatal(msg) {
  $app.innerHTML = `<div class="wrap"><div class="empty" style="padding-top:80px"><div style="font-size:48px">☕</div><p>${esc(msg)}</p>
    <button class="btn" onclick="location.reload()">再読み込み</button></div></div>`;
}

function badge(item) {
  const b = [];
  if (!item.orderable) b.push(`<span class="chip ${item.reason === '売り切れ' ? 'chip-danger' : ''}">${esc(item.reason)}</span>`);
  if (item.recommended && item.orderable) b.push('<span class="chip chip-accent">おすすめ</span>');
  if (item.daily) b.push('<span class="chip chip-warn">日替わり・限定あり</span>');
  if (item.orderable && item.stockLeft != null && item.stockLeft <= 5) b.push(`<span class="chip chip-danger">残り${item.stockLeft}</span>`);
  if (item.ticketEligible && S.ses.ticket) b.push(`<span class="chip">🎫 ${esc(S.ses.ticket.name)}可</span>`);
  return b.join('');
}
const thumb = (item) => `<div class="thumb">${item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy">` : esc(item.emoji || '☕')}</div>`;
const inCart = (id) => S.cart.filter((l) => l.itemId === id).reduce((s, l) => s + l.qty, 0);

function render() {
  const ses = S.ses;
  if (!ses) return;
  const ordersCount = ses.check?.orders.length || 0;
  let html = `<header class="top"><div class="wrap">
    <div class="top-inner">
      <div class="tagbadge"><small>番号札</small><b>${ses.tagNo}</b></div>
      <div class="grow"><div class="shop">${esc(ses.shop.name)}</div><div class="small muted">テーブルからご注文いただけます</div></div>
      <button class="btn callbtn" data-act="open-call">🔔 呼ぶ</button>
    </div>
    <nav class="tabs">
      <button class="tab ${S.view === 'menu' ? 'on' : ''}" data-act="view" data-v="menu">メニュー</button>
      <button class="tab ${S.view === 'history' ? 'on' : ''}" data-act="view" data-v="history">注文履歴・お会計${ordersCount ? `<span class="count">${ordersCount}</span>` : ''}</button>
    </nav></div></header><main class="wrap">`;

  if (S.closedNotice) {
    html += `<div class="banner ok">お会計が完了しました。ご来店ありがとうございました。<br><button class="btn btn-sm" style="margin-top:8px" data-act="dismiss-closed">新しく注文する</button></div>`;
  }
  if (!ses.ordering.open) html += `<div class="banner warn">⏸ ${esc(ses.ordering.reason)}</div>`;
  else if (ses.requireStaffOpen && !ses.check) html += '<div class="banner warn">スタッフが受付を完了するとご注文いただけます。</div>';
  if (ses.shop.notice) html += `<div class="banner accent">📢 ${esc(ses.shop.notice)}</div>`;

  html += S.view === 'menu' ? renderMenu() : renderHistory();
  html += '</main>';

  const n = cartCount();
  if (n && S.view === 'menu') {
    html += `<button class="cartbar" data-act="open-cart"><span class="n">${n}</span><span class="grow" style="text-align:left">カートを見る</span><span class="num">${yen(cartTotal())}</span></button>`;
  } else if (n) {
    html += `<button class="cartbar" data-act="open-cart"><span class="n">${n}</span><span class="grow" style="text-align:left">未送信の商品があります</span><span>確認 ›</span></button>`;
  }
  $app.innerHTML = html;
  const top = $app.querySelector('.top');
  if (top) document.documentElement.style.setProperty('--hdr', `${top.offsetHeight}px`);
  // 入力中にリアルタイム更新が来ても、シートを描き直してキーボードを閉じない
  const a = document.activeElement;
  if (!(a && $sheet.contains(a) && /INPUT|TEXTAREA/.test(a.tagName))) renderSheet();
}

function renderMenu() {
  const { categories, items } = S.ses.menu;
  if (!items.length) return '<div class="empty">ただいまご注文いただけるメニューがありません</div>';
  let html = '';
  if (!S.ses.check && S.ses.shop.welcome) html += `<div class="banner">${esc(S.ses.shop.welcome)}</div>`;
  html += `<nav class="cats" id="cats">${categories.map((c) => `<button class="cat" data-act="jump" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</nav>`;
  const reco = items.filter((i) => i.recommended && i.orderable);
  if (reco.length) {
    html += `<div class="section" style="padding-bottom:0"><h2>本日のおすすめ</h2></div><div class="reco">${reco.map((i) => `
      <button class="rc" data-act="item" data-id="${esc(i.id)}">${thumb(i)}<div style="font-weight:700;font-size:14px">${esc(i.name)}</div><div class="price num" style="color:var(--accent);font-weight:700">${yen(i.price)}〜</div></button>`).join('')}</div>`;
  }
  for (const c of categories) {
    const list = items.filter((i) => i.categoryId === c.id);
    html += `<section class="section" id="cat-${esc(c.id)}"><h2>${esc(c.name)}</h2><div class="items">`;
    for (const i of list) {
      const q = inCart(i.id);
      const hasPaid = i.optionGroups.some((g) => g.choices.some((ch) => ch.price > 0));
      html += `<button class="item ${i.orderable ? '' : 'off'}" data-act="item" data-id="${esc(i.id)}">
        ${thumb(i)}
        <div class="grow"><div class="name">${esc(i.name)}</div>
          ${i.description ? `<div class="desc">${esc(i.description)}</div>` : ''}
          <div class="row" style="margin-top:2px"><span class="price">${yen(i.price)}${hasPaid ? '〜' : ''}</span></div>
          <div class="badges">${badge(i)}</div></div>
        ${q ? `<span class="incart">${q}</span>` : ''}
      </button>`;
    }
    html += '</div></section>';
  }
  return html;
}

const STATUS = { new: ['準備中', 'chip-warn'], served: ['お届け済み', 'chip-ok'], cancelled: ['取消', ''] };
const TIMING = { first: '先に', with: '食事と一緒に', after: '食後に' };
const timeStr = (iso) => new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

function renderHistory() {
  const ck = S.ses.check;
  let html = '';
  if (!ck) {
    html += '<div class="empty">まだご注文はありません。<br>メニューからお選びください。</div>';
  } else {
    html += `<div class="card sumcard"><div class="small muted">現在のご利用金額（${ck.itemCount}点）</div>
      <div class="big">${yen(ck.subtotal)}</div>
      ${ck.discount ? `<div class="small muted">※チケット・割引はお会計時に反映されます</div>` : ''}
      <div class="small" style="margin-top:8px">お会計は<b>この番号札（${S.ses.tagNo}番）</b>をレジまでお持ちください。<br>${S.ses.ticket ? `${esc(S.ses.ticket.name)}・` : ''}割り勘もレジで承ります。</div></div>`;
    for (const o of [...ck.orders].reverse()) {
      html += `<div class="card order"><div class="hd"><span>${timeStr(o.at)} のご注文</span><span>${o.mine ? 'あなた' : esc(o.name || '')}</span></div>`;
      for (const l of o.lines) {
        const [label, cls] = STATUS[l.status] || STATUS.new;
        html += `<div class="oline ${l.status === 'cancelled' ? 'cancelled' : ''}"><span>${esc(l.emoji || '')}</span>
          <div class="grow"><div><b>${esc(l.name)}</b> × ${l.qty}</div>
          ${l.options.length ? `<div class="small muted">${esc(l.options.join(' / '))}</div>` : ''}
          ${l.timing ? `<div class="small muted">提供：${TIMING[l.timing]}</div>` : ''}
          ${l.note ? `<div class="small muted">「${esc(l.note)}」</div>` : ''}</div>
          <div style="text-align:right"><div class="num">${l.comp ? 'サービス' : yen(l.unitPrice * l.qty)}</div><span class="chip ${cls}">${label}</span></div></div>`;
      }
      html += '</div>';
    }
  }
  html += `<div class="section"><h2>スタッフを呼ぶ</h2></div><div class="calls">${S.ses.callOptions.map((c) => `<button class="btn btn-lg" data-act="call" data-type="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
  return html;
}

// ---- シート ----
function openItem(id, editIndex = null) {
  const item = findItem(id);
  if (!item) return;
  const base = editIndex != null ? S.cart[editIndex] : null;
  const sel = base ? JSON.parse(JSON.stringify(base.sel)) : {};
  if (!base) {
    // 必須の単一選択で選べるものが1つしかなければ自動選択
    for (const g of item.optionGroups) {
      const avail = g.choices.filter((c) => !c.soldOut);
      if (g.type === 'single' && g.required && avail.length === 1) sel[g.id] = [avail[0].id];
    }
  }
  S.sheet = { type: 'item', item, sel, qty: base?.qty || 1, note: base?.note || '', timing: base?.timing || '', editIndex, showNote: !!base?.note };
  renderSheet();
}

function renderSheet() {
  const sh = S.sheet;
  if (!sh) { $sheet.innerHTML = ''; document.body.style.overflow = ''; return; }
  document.body.style.overflow = 'hidden';
  let inner = '';
  if (sh.type === 'item') inner = itemSheet(sh);
  if (sh.type === 'cart') inner = cartSheet();
  if (sh.type === 'call') inner = callSheet();
  const scroll = $sheet.querySelector('.sheet')?.scrollTop || 0;
  const enter = !$sheet.firstElementChild ? 'enter' : '';
  $sheet.innerHTML = `<div class="sheet-backdrop ${enter}" data-act="close-sheet"><div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${inner}</div></div>`;
  const el = $sheet.querySelector('.sheet');
  if (el) el.scrollTop = scroll;
}

function itemSheet(sh) {
  const it = sh.item;
  const unit = previewPrice(it, sh.sel);
  const missing = it.optionGroups.filter((g) => g.required && !(sh.sel[g.id] || []).length);
  let h = `<div class="hero">${it.image ? `<img src="${esc(it.image)}" alt="">` : esc(it.emoji || '☕')}</div>
    <div class="row"><h3 class="grow">${esc(it.name)}</h3><b class="num" style="font-size:18px;color:var(--accent)">${yen(it.price)}</b></div>
    ${it.description ? `<p class="muted small" style="margin:6px 0 0">${esc(it.description)}</p>` : ''}
    <div class="badges row" style="flex-wrap:wrap;margin-top:6px">${badge(it)}</div>
    ${it.allergens.length ? `<div class="small muted" style="margin-top:6px">アレルギー：${esc(it.allergens.join('・'))}</div>` : ''}`;
  for (const g of it.optionGroups) {
    const picked = sh.sel[g.id] || [];
    h += `<div class="group"><div class="group-h"><b>${esc(g.name)}</b>
      ${g.required ? '<span class="chip chip-danger">必須</span>' : '<span class="chip">任意</span>'}
      ${g.type === 'multi' ? `<span class="small muted">${g.max ? `${g.max}つまで` : '複数可'}</span>` : ''}</div>
      ${g.hint ? `<div class="hint">📝 ${esc(g.hint)}</div>` : ''}<div class="choices">`;
    for (const c of g.choices) {
      const on = picked.includes(c.id);
      h += `<button class="choice ${g.type === 'multi' ? 'multi' : ''} ${on ? 'on' : ''}" data-act="choose" data-g="${esc(g.id)}" data-c="${esc(c.id)}" ${c.soldOut ? 'disabled' : ''}>
        <span class="mark"></span><span class="grow">${esc(c.label)} ${c.detail ? `<span class="detail">${esc(c.detail)}</span>` : c.slot ? '<span class="small muted">（黒板をご覧ください）</span>' : ''}
        ${c.soldOut ? '<span class="chip chip-danger">売り切れ</span>' : ''}</span>
        ${c.price ? `<span class="num small">${c.price > 0 ? '+' : ''}${yen(c.price)}</span>` : ''}</button>`;
    }
    h += '</div></div>';
  }
  if (it.station === 'drink') {
    h += `<div class="group"><div class="group-h"><b>お出しするタイミング</b><span class="chip">任意</span></div><div class="seg">
      ${[['', 'おまかせ'], ['first', '先に'], ['with', '食事と一緒'], ['after', '食後に']].map(([v, l]) => `<button data-act="timing" data-v="${v}" class="${sh.timing === v ? 'on' : ''}">${l}</button>`).join('')}
    </div></div>`;
  }
  h += `<div class="group">${sh.showNote
    ? `<div class="group-h"><b>ご要望</b><span class="chip">任意</span></div><textarea id="note" rows="2" maxlength="120" placeholder="例：氷少なめ / 取り皿2枚">${esc(sh.note)}</textarea>`
    : '<button class="btn btn-ghost btn-sm" data-act="show-note">＋ ご要望を書く（氷少なめ・取り皿 など）</button>'}</div>`;
  h += `<div class="sheet-foot">
    <div class="stepper"><button data-act="qty" data-d="-1" aria-label="減らす">−</button><span>${sh.qty}</span><button data-act="qty" data-d="1" aria-label="増やす">＋</button></div>
    <button class="btn btn-primary btn-lg grow" data-act="add" ${!it.orderable || missing.length ? 'disabled' : ''}>
      ${!it.orderable ? esc(it.reason) : missing.length ? `${esc(missing[0].name)}を選んでください` : `${sh.editIndex != null ? '変更する' : 'カートに入れる'}　${yen(unit * sh.qty)}`}
    </button></div>`;
  return h;
}

function cartSheet() {
  const ses = S.ses;
  if (!S.cart.length) return '<div class="empty">カートは空です</div><button class="btn btn-block" data-act="close-sheet">メニューに戻る</button>';
  let h = '<h3 class="serif">ご注文内容の確認</h3>';
  for (const [i, l] of S.cart.entries()) {
    const it = findItem(l.itemId);
    const bad = S.unavailable.has(lineKey(l));
    h += `<div class="cline ${bad ? 'bad' : ''}"><div class="grow" data-act="edit-line" data-i="${i}">
      <div class="name"><b>${esc(it?.name || '販売終了')}</b></div>
      <div class="opts">${esc(it ? optionLabels(it, l.sel).join(' / ') : '')}${l.timing ? ` / ${TIMING[l.timing]}` : ''}</div>
      ${l.note ? `<div class="opts">「${esc(l.note)}」</div>` : ''}
      ${bad ? '<span class="chip chip-danger">売り切れ・ご注文できません</span>' : `<div class="num small">${yen(it ? previewPrice(it, l.sel) * l.qty : 0)}</div>`}</div>
      <div class="stepper"><button data-act="cqty" data-i="${i}" data-d="-1">${l.qty === 1 ? '🗑' : '−'}</button><span>${l.qty}</span><button data-act="cqty" data-i="${i}" data-d="1">＋</button></div></div>`;
  }
  if (!ses.check && ses.askPeople) {
    h += `<div class="group"><div class="group-h"><b>何名様ですか？</b><span class="chip">任意</span></div><div class="people">
      ${[1, 2, 3, 4, 5, 6].map((n) => `<button data-act="people" data-n="${n}" class="${S.people === n ? 'on' : ''}">${n}${n === 6 ? '+' : ''}</button>`).join('')}</div></div>`;
  }
  h += `<div class="group"><div class="group-h"><b>お名前・ニックネーム</b><span class="chip">任意</span></div>
    <input id="name" maxlength="20" placeholder="例：あや（割り勘のときに誰の注文か分かります）" value="${esc(S.name)}"></div>`;
  const badCount = S.cart.filter((l) => S.unavailable.has(lineKey(l))).length;
  const blocked = !ses.ordering.open || (ses.requireStaffOpen && !ses.check);
  h += `<div class="sheet-foot" style="flex-direction:column;align-items:stretch">
    <div class="row"><span class="muted">合計（税込）</span><span class="spacer"></span><b class="num" style="font-size:22px">${yen(cartTotal())}</b></div>
    <button class="btn btn-primary btn-lg btn-block" data-act="submit" ${S.sending || badCount || blocked ? 'disabled' : ''}>
      ${S.sending ? '送信中…' : badCount ? '売り切れの商品を削除してください' : blocked ? 'ただいまご注文できません' : `${cartCount()}点を注文する`}</button>
    <div class="small muted" style="text-align:center">注文はお店のスタッフに直接届きます</div></div>`;
  return h;
}

function callSheet() {
  return `<h3 class="serif">スタッフを呼ぶ</h3><p class="small muted">${S.ses.tagNo}番の札としてお知らせします</p>
    <div class="choices">${S.ses.callOptions.map((c) => `<button class="btn btn-lg btn-block" data-act="call" data-type="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <button class="btn btn-ghost btn-block" style="margin-top:8px" data-act="close-sheet">閉じる</button>`;
}

// ---- 操作 ----
async function submit() {
  const nameEl = document.getElementById('name');
  if (nameEl) { S.name = nameEl.value.trim(); store.set('cafe_name', S.name); }
  if (S.sending) return;
  S.sending = true; renderSheet();
  const clientOrderId = `${deviceId}-${Date.now()}`;
  const send = (knownCheckId) => api('POST', '/api/c/order', {
    tag: tagNo, k: key, device: deviceId, name: S.name, people: S.people || undefined, knownCheckId, clientOrderId,
    lines: S.cart.map((l) => ({ itemId: l.itemId, sel: l.sel, qty: l.qty, note: l.note, timing: l.timing })),
  });
  try {
    let res;
    try {
      res = await send(S.ses.check?.id || null);
    } catch (e) {
      if (e.code !== 'check_changed') throw e;
      await load();
      // 会計済みの後にもう一度注文する／同じテーブルで新しい伝票が始まっていた場合は確認してから送る
      if (!confirm(`${e.message}\n\nこのまま注文を送信しますか？`)) throw Object.assign(new Error('送信を取りやめました'), { quiet: true });
      res = await send(S.ses.check?.id || null);
    }
    S.cart = []; saveCart();
    S.sheet = null;
    S.closedNotice = false;
    store.set(SEEN_KEY, res.check.id);
    showDone();
    await load();
    S.view = 'history';
    render();
  } catch (e) {
    if (!e.quiet) toast(e.message, 'error');
    if (e.code === 'unavailable') await load();
  } finally {
    S.sending = false; renderSheet();
  }
}

function showDone() {
  const el = document.createElement('div');
  el.className = 'done-overlay';
  el.innerHTML = '<div><div class="check">✓</div><h2 class="serif">ご注文を承りました</h2><p class="muted">できあがり次第お席までお持ちします。<br>追加のご注文もこの画面からどうぞ。</p></div>';
  document.body.append(el);
  setTimeout(() => el.remove(), 1900);
  el.addEventListener('click', () => el.remove());
}

document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'close-sheet') {
    if (t.classList.contains('sheet-backdrop') && ev.target !== t) return; // シートの中身のタップでは閉じない
    S.sheet = null; renderSheet(); render(); return;
  }
  const sh = S.sheet;
  switch (act) {
    case 'view': S.view = t.dataset.v; window.scrollTo(0, 0); render(); break;
    case 'jump': document.getElementById(`cat-${t.dataset.cat}`)?.scrollIntoView({ behavior: 'smooth' }); break;
    case 'item': openItem(t.dataset.id); break;
    case 'choose': {
      const g = sh.item.optionGroups.find((x) => x.id === t.dataset.g);
      const cur = sh.sel[g.id] || [];
      const c = t.dataset.c;
      if (g.type === 'single') sh.sel[g.id] = cur.includes(c) && !g.required ? [] : [c];
      else if (cur.includes(c)) sh.sel[g.id] = cur.filter((x) => x !== c);
      else if (!g.max || cur.length < g.max) sh.sel[g.id] = [...cur, c];
      else toast(`${g.name}は${g.max}つまでです`);
      renderSheet(); break;
    }
    case 'timing': sh.timing = t.dataset.v; renderSheet(); break;
    case 'show-note': sh.showNote = true; renderSheet(); document.getElementById('note')?.focus(); break;
    case 'qty': sh.qty = Math.max(1, Math.min(30, sh.qty + Number(t.dataset.d))); renderSheet(); break;
    case 'add': {
      sh.note = (document.getElementById('note')?.value || '').trim();
      const line = { itemId: sh.item.id, sel: sh.sel, qty: sh.qty, note: sh.note, timing: sh.timing };
      if (sh.editIndex != null) S.cart.splice(sh.editIndex, 1);
      const same = S.cart.find((l) => lineKey(l) === lineKey(line));
      if (same) same.qty = Math.min(30, same.qty + line.qty); else S.cart.push(line);
      saveCart(); validateCart();
      S.sheet = sh.editIndex != null ? { type: 'cart' } : null;
      if (sh.editIndex == null) toast(`${sh.item.name} をカートに入れました`);
      render(); break;
    }
    case 'open-cart': S.sheet = { type: 'cart' }; renderSheet(); break;
    case 'edit-line': openItem(S.cart[Number(t.dataset.i)].itemId, Number(t.dataset.i)); break;
    case 'cqty': {
      const nameEl = document.getElementById('name'); if (nameEl) S.name = nameEl.value;
      const l = S.cart[Number(t.dataset.i)];
      l.qty += Number(t.dataset.d);
      if (l.qty <= 0) S.cart.splice(Number(t.dataset.i), 1);
      saveCart(); validateCart(); render(); break;
    }
    case 'people': { const nameEl = document.getElementById('name'); if (nameEl) S.name = nameEl.value; S.people = Number(t.dataset.n); renderSheet(); break; }
    case 'submit': submit(); break;
    case 'open-call': S.sheet = { type: 'call' }; renderSheet(); break;
    case 'call':
      try {
        await api('POST', '/api/c/call', { tag: tagNo, k: key, type: t.dataset.type });
        toast(`「${t.dataset.type}」をお伝えしました`);
        S.sheet = null; renderSheet();
      } catch (e) { toast(e.message, 'error'); }
      break;
    case 'dismiss-closed': S.closedNotice = false; render(); break;
    default:
  }
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'note' && S.sheet?.type === 'item') S.sheet.note = ev.target.value;
  if (ev.target.id === 'name') S.name = ev.target.value;
});

if (!tagNo || !key) renderFatal('番号札のQRコードを読み取ってください');
else { load(); connect(); }
