// 会計：番号札の番号を入れて会計開始 → チケット・割引 → 一括/均等割り/個別/金額指定 → 支払い → レシート
import {
  computeTotals, activeLines, splitEqual, splitByItems, paidByLabel, lineGross,
} from '../shared/calc.js';
import {
  S, esc, yen, api, run, toast, refresh, keypad, applyKey, tagLabel, checkById, elapsed, timeStr, promptDialog, confirmDialog,
  printHtml, openModal, closeModal, updateModal, settings, hooks,
} from './core.js';
import { openStaffOrder } from './ordering.js';
import { callsFor } from './hall.js';

export const CO = { checkId: null, entry: '', pay: null, done: null, amountStr: '' };

export function goCheckout(id) {
  CO.checkId = id; CO.pay = null; CO.done = null; CO.amountStr = '';
  hooks.setView('checkout');
}

const MODES = [['all', 'まとめて'], ['equal', '割り勘（均等）'], ['items', '個別会計'], ['amount', '金額指定']];

export function renderCheckout() {
  if (CO.done) return doneHtml();
  const c = CO.checkId && checkById(CO.checkId);
  if (!c) { CO.checkId = null; return entryHtml(); }
  return checkoutHtml(c);
}

// ---- 番号札の番号を入力 ----
function entryHtml() {
  const d = S.data;
  const list = [...d.openChecks].sort((a, b) => Number(callsFor(b).some((x) => x.type.includes('会計'))) - Number(callsFor(a).some((x) => x.type.includes('会計'))));
  return `<div class="view-head"><h1>会計</h1><span class="spacer"></span><button class="btn" data-act="counter-quick">🧾 カウンター会計（札なし）</button></div>
  <div class="co-entry">
    <div class="card co-pad"><div class="small muted">お持ちの番号札の番号</div>
      <div class="co-display num">${esc(CO.entry) || '<span class="muted">—</span>'}</div>
      ${keypad('co-entry-key')}
      <button class="btn btn-primary btn-lg btn-block" data-act="co-entry-go" ${CO.entry ? '' : 'disabled'}>会計をはじめる</button></div>
    <div class="co-list">${list.length ? list.map((c) => {
      const t = computeTotals(c, d.settings);
      const bill = callsFor(c).some((x) => x.type.includes('会計'));
      return `<button class="card co-item ${bill ? 'bill' : ''}" data-act="co-open" data-id="${c.id}"><span class="tno">${c.tagNo ?? '🧾'}</span>
        <div class="grow"><b>${esc(tagLabel(c))}</b>${bill ? ' <span class="chip chip-accent">お会計希望</span>' : ''}<div class="small muted">${c.people ? `${c.people}名 · ` : ''}${elapsed(c.openedAt)} · ${t.itemCount}点${t.paid ? ` · 支払済${yen(t.paid)}` : ''}</div></div>
        <b class="num">${yen(t.remaining)}</b></button>`;
    }).join('') : '<div class="empty">ご利用中の伝票はありません</div>'}</div>
  </div>`;
}

// ---- 会計画面 ----
function splitOf(c) { return c.split || { mode: 'all' }; }

function shares(c, t) {
  const sp = splitOf(c);
  const paid = paidByLabel(c);
  if (sp.mode === 'equal') {
    const n = sp.n || Math.max(2, c.people || 2);
    const labels = Array.from({ length: n }, (_, i) => `${i + 1}人目`);
    const other = c.payments.filter((p) => !labels.includes(p.label)).reduce((s, p) => s + p.amount, 0);
    const amounts = splitEqual(Math.max(0, t.total - other), n, sp.unit || 1);
    return labels.map((label, i) => ({ label, amount: amounts[i], paid: paid[label] || 0 }));
  }
  if (sp.mode === 'items') {
    const people = sp.people || [];
    const r = splitByItems(c, settings(), people, sp.assign || {});
    const out = people.map((p) => ({ label: p, amount: r.people[p], paid: paid[p] || 0 }));
    return Object.assign(out, { unassigned: r.unassigned });
  }
  return [];
}

function defaultPeople(c) {
  const names = [...new Set([...c.orders.filter((o) => o.source === 'customer').map((o) => o.name), ...Object.values(c.devices || {})].filter(Boolean))];
  if (names.length >= 2) return names.slice(0, 8);
  const n = Math.max(2, Math.min(8, c.people || 2));
  return Array.from({ length: n }, (_, i) => `${'ABCDEFGH'[i]}さん`);
}

function checkoutHtml(c) {
  const s = settings();
  const t = computeTotals(c, s);
  const sp = splitOf(c);
  const lines = activeLines(c);

  let h = `<div class="view-head"><button class="btn" data-act="co-back">‹ 一覧</button>
    <h1><span class="tagno">${c.tagNo ?? '🧾'}</span> ${c.tagNo == null ? 'カウンター' : '番'} のお会計</h1>
    <span class="small muted">${c.people ? `${c.people}名 · ` : ''}${timeStr(c.openedAt)}〜（${elapsed(c.openedAt)}）</span>
    <span class="spacer"></span>
    <button class="pill ${c.takeout ? 'on' : ''}" data-act="co-takeout">${c.takeout ? '持ち帰り（8%）' : `店内（${s.taxRate}%）`}</button>
    <button class="btn" data-act="co-add">＋ 追加</button></div>
  <div class="co-main">`;

  // 左：明細と調整
  h += '<div class="card co-left"><div class="co-lines">';
  for (const l of lines) {
    const tk = t.ticketByLine[l.id] || 0;
    h += `<div class="co-line"><div class="grow"><b>${esc(l.name)}</b>${l.qty > 1 ? ` × ${l.qty}` : ''}
      ${l.options.length ? `<div class="small muted">${esc(l.options.map((x) => x.label).join(' / '))}</div>` : ''}
      ${l.status === 'new' ? '<span class="chip chip-warn">未提供</span>' : ''}</div>
      <div style="text-align:right"><div class="num">${l.comp ? '<span class="chip chip-ok">サービス</span>' : yen(lineGross(l))}</div>
      ${tk ? `<div class="small num" style="color:var(--ok)">🎫 −${yen(tk)}</div>` : ''}</div></div>`;
  }
  if (!lines.length) h += '<div class="empty small">明細がありません</div>';
  h += '</div><div class="co-adjust">';
  if (s.ticket.enabled) {
    h += `<div class="adj-row"><div class="grow"><b>🎫 ${esc(s.ticket.name)}</b><div class="small muted">${t.ticketMax ? `対象 ${t.ticketMax}点 · 1枚 ${yen(s.ticket.value)}まで（差額はお支払い）` : '対象の商品がありません'}</div></div>
      <div class="stepper"><button data-act="co-ticket" data-d="-1" ${t.tickets ? '' : 'disabled'}>−</button><span>${t.tickets}枚</span><button data-act="co-ticket" data-d="1" ${t.tickets < t.ticketMax ? '' : 'disabled'}>＋</button></div></div>`;
  }
  h += `<div class="adj-row wrap"><b>割引</b>${s.discounts.map((d) => `<button class="pill" data-act="co-disc" data-id="${esc(d.id)}">${esc(d.name)}</button>`).join('')}
    <button class="pill" data-act="co-disc-custom">その他…</button></div>`;
  for (const d of t.discounts) {
    h += `<div class="adj-row applied"><span class="grow">${esc(d.name)}${d.type === 'percent' ? `（${d.value}%）` : ''}</span><span class="num">−${yen(d.amount)}</span>
      <button class="btn btn-sm btn-ghost" data-act="co-disc-del" data-id="${esc(d.id)}">✕</button></div>`;
  }
  h += `</div><div class="co-totals">
    <div class="row"><span>小計</span><span class="spacer"></span><span class="num">${yen(t.subtotal)}</span></div>
    ${t.ticketDiscount ? `<div class="row"><span>${esc(s.ticket.name)} ${t.tickets}枚</span><span class="spacer"></span><span class="num">−${yen(t.ticketDiscount)}</span></div>` : ''}
    ${t.discountTotal ? `<div class="row"><span>割引</span><span class="spacer"></span><span class="num">−${yen(t.discountTotal)}</span></div>` : ''}
    <div class="row total"><span>合計</span><span class="spacer"></span><span class="num">${yen(t.total)}</span></div>
    <div class="row small muted"><span>（${t.taxRate}%対象 ${yen(t.total)} / 内消費税 ${yen(t.tax)}）</span></div>
    ${t.paid ? `<div class="row"><span>お支払い済み</span><span class="spacer"></span><span class="num">${yen(t.paid)}</span></div>
      <div class="row total remain"><span>残り</span><span class="spacer"></span><span class="num">${yen(t.remaining)}</span></div>` : ''}
  </div></div>`;

  // 右：支払い
  h += `<div class="card co-right"><div class="seg-tabs full">${MODES.map(([k, l]) => `<button class="${sp.mode === k ? 'on' : ''}" data-act="co-mode" data-m="${k}">${l}</button>`).join('')}</div>`;
  if (t.remaining <= 0) {
    h += `<div class="empty"><p>お支払いは完了しています</p><button class="btn btn-primary btn-lg" data-act="co-close">会計を完了する</button></div>`;
  } else if (sp.mode === 'all') {
    h += payPanel(c, t, { label: '', amount: t.remaining, editable: false });
  } else if (sp.mode === 'amount') {
    const amt = Number(CO.amountStr || 0);
    h += `<div class="co-amount"><div class="small muted">今回お支払いいただく金額（残り ${yen(t.remaining)}）</div>
      <div class="co-display num">${CO.amountStr ? yen(amt) : '<span class="muted">¥0</span>'}</div>
      ${keypad('co-amount-key')}
      <div class="row"><button class="btn btn-sm" data-act="co-amount-half">半分</button><button class="btn btn-sm" data-act="co-amount-rest">残り全額</button></div></div>`;
    if (amt > 0) h += payPanel(c, t, { label: '金額指定', amount: Math.min(amt, t.remaining), compact: true });
  } else {
    const list = shares(c, t);
    if (sp.mode === 'equal') {
      const n = sp.n || Math.max(2, c.people || 2);
      h += `<div class="adj-row wrap"><b>人数</b><div class="stepper"><button data-act="co-eq-n" data-d="-1">−</button><span>${n}人</span><button data-act="co-eq-n" data-d="1">＋</button></div>
        <span class="spacer"></span><b>端数</b>${[[1, '1円単位'], [10, '10円'], [100, '100円']].map(([u, l]) => `<button class="pill ${(sp.unit || 1) === u ? 'on' : ''}" data-act="co-eq-unit" data-u="${u}">${l}</button>`).join('')}</div>
        ${(sp.unit || 1) > 1 ? '<div class="small muted">端数は1人目（幹事さん）にまとめます</div>' : ''}`;
    } else {
      const people = sp.people || [];
      h += `<div class="adj-row wrap"><b>お支払いする人</b>${people.map((p) => `<span class="pill on">${esc(p)}</span>`).join('')}
        <button class="pill" data-act="co-person-add">＋ 追加</button>${people.length > 1 ? '<button class="pill" data-act="co-person-del">− 最後の人を削除</button>' : ''}</div>
        <div class="assign">${lines.filter((l) => !l.comp).map((l) => {
          const who = (sp.assign || {})[l.id] || [];
          return `<div class="as-row"><div class="grow small"><b>${esc(l.name)}</b>${l.qty > 1 ? ` ×${l.qty}` : ''}</div>
            <div class="as-chips">${people.map((p) => `<button class="pill sm ${who.includes(p) ? 'on' : ''}" data-act="co-assign" data-line="${l.id}" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div></div>`;
        }).join('')}</div>
        ${list.unassigned ? `<div class="row warnbox"><span>未割り当て ${yen(list.unassigned)}</span><span class="spacer"></span><button class="btn btn-sm" data-act="co-assign-rest">残りを全員で割る</button></div>` : ''}
        <div class="small muted">2人以上を選んだ品はその人数で等分します</div>`;
    }
    h += `<div class="shares">${list.map((x) => {
      const done = x.paid >= x.amount && x.amount > 0;
      const sel = CO.pay?.label === x.label;
      return `<button class="share ${done ? 'done' : ''} ${sel ? 'sel' : ''}" data-act="co-share" data-label="${esc(x.label)}" ${done || !x.amount ? 'disabled' : ''}>
        <span class="grow">${esc(x.label)}</span><b class="num">${yen(x.amount - Math.min(x.paid, x.amount))}</b>${done ? '<span class="chip chip-ok">済</span>' : ''}</button>`;
    }).join('')}</div>`;
    const cur = CO.pay && list.find((x) => x.label === CO.pay.label);
    if (cur && cur.paid < cur.amount) h += payPanel(c, t, { label: cur.label, amount: Math.min(cur.amount - cur.paid, t.remaining), compact: true });
  }
  if (c.payments.length) {
    h += `<div class="paylist"><div class="small muted">記録済みの支払い</div>${c.payments.map((p) => `<div class="row small"><span>${timeStr(p.at)}</span><span>${esc(p.method)}</span>${p.label ? `<span class="chip">${esc(p.label)}</span>` : ''}
      <span class="spacer"></span><b class="num">${yen(p.amount)}</b>${p.change ? `<span class="muted">（釣${yen(p.change)}）</span>` : ''}<button class="btn btn-sm btn-ghost" data-act="co-pay-del" data-id="${p.id}">取消</button></div>`).join('')}</div>`;
  }
  h += '</div></div>';
  return h;
}

// 支払い方法とお預かり
function payPanel(c, t, { label, amount }) {
  const methods = settings().paymentMethods;
  CO.pay ||= { label, method: methods[0], received: '' };
  if (CO.pay.label !== label) CO.pay = { label, method: CO.pay.method, received: '' };
  const p = CO.pay;
  p.amount = amount;
  const cash = p.method === '現金';
  const rec = Number(p.received || 0);
  const change = rec - amount;
  const quick = [...new Set([amount, Math.ceil(amount / 1000) * 1000, Math.ceil(amount / 5000) * 5000, 10000].filter((v) => v >= amount))].slice(0, 4);
  return `<div class="paypanel"><div class="row"><span class="muted">${label ? `${esc(label)} の` : ''}お支払い</span><span class="spacer"></span><b class="num pay-amt">${yen(amount)}</b></div>
    <div class="methods">${methods.map((m) => `<button class="pill ${p.method === m ? 'on' : ''}" data-act="co-method" data-m="${esc(m)}">${esc(m)}</button>`).join('')}</div>
    ${cash ? `<div class="cash"><div class="cash-l"><div class="row"><span class="small muted">お預かり</span><span class="spacer"></span><b class="num co-display sm">${p.received ? yen(rec) : '—'}</b></div>
        <div class="row"><span class="small muted">おつり</span><span class="spacer"></span><b class="num change ${p.received && change < 0 ? 'neg' : ''}">${p.received ? (change >= 0 ? yen(change) : `${yen(-change)} 不足`) : '—'}</b></div>
        <div class="quick">${quick.map((v) => `<button class="btn btn-sm" data-act="co-quick" data-v="${v}">${v === amount ? 'ちょうど' : yen(v)}</button>`).join('')}</div></div>
      ${keypad('co-cash-key')}</div>` : ''}
    <button class="btn btn-ok btn-lg btn-block" data-act="co-pay" ${cash && p.received && change < 0 ? 'disabled' : ''}>${cash ? (p.received ? `お預かり ${yen(rec)} で会計` : `${yen(amount)} 現金で会計`) : `${esc(p.method)}で ${yen(amount)} 会計`}</button></div>`;
}

// ---- 完了 ----
function doneHtml() {
  const { check, change, received } = CO.done;
  const t = check.totals || computeTotals(check, settings());
  return `<div class="co-done card">
    <div class="done-mark">✓</div><h1>${esc(tagLabel(check))} のお会計が完了しました</h1>
    <div class="done-grid"><div><div class="small muted">合計</div><div class="num big">${yen(t.total)}</div></div>
    ${received != null ? `<div><div class="small muted">お預かり</div><div class="num big">${yen(received)}</div></div><div><div class="small muted">おつり</div><div class="num big change">${yen(change)}</div></div>` : ''}</div>
    <p class="muted">番号札${check.tagNo != null ? `（${check.tagNo}番）` : ''}をお受け取りください。</p>
    <div class="grid3"><button class="btn btn-lg" data-act="co-receipt">🧾 レシート印刷</button><button class="btn btn-lg" data-act="co-ryoshu">領収書</button>
      <button class="btn btn-lg btn-primary" data-act="co-next">次の会計へ</button></div></div>`;
}

// ---- レシート・領収書 ----
export function receiptHtml(check, { type = 'receipt', name = '', tadashi = 'ご飲食代として' } = {}) {
  const s = settings();
  const t = check.totals || computeTotals(check, s);
  const r = s.receipt;
  const at = new Date(check.closedAt || Date.now()).toLocaleString('ja-JP', { timeZone: s.timeZone });
  const head = `<div class="rc-shop">${esc(s.shopName)}</div>${r.address ? `<div>${esc(r.address)}</div>` : ''}${r.phone ? `<div>TEL ${esc(r.phone)}</div>` : ''}
    ${r.invoiceNumber ? `<div>登録番号 ${esc(r.invoiceNumber)}</div>` : ''}<div>${esc(at)}</div><div>${esc(tagLabel(check))}${check.people ? ` / ${check.people}名` : ''} / ${check.takeout ? '持ち帰り' : '店内'}</div>`;
  const taxLine = `<div class="rc-row"><span>${t.taxRate}%対象${check.takeout ? '（軽減税率）' : ''}</span><span>${yen(t.total)}</span></div><div class="rc-row"><span>（内消費税等</span><span>${yen(t.tax)}）</span></div>`;
  if (type === 'ryoshu') {
    return `<div class="receipt"><div class="rc-title">領 収 書</div><div class="rc-name">${esc(name || '')}　様</div>
      <div class="rc-amount">${yen(t.total)}-</div><div>但し　${esc(tadashi)}</div><div>上記正に領収いたしました</div><hr>${taxLine}<hr>${head}</div>`;
  }
  const lines = activeLines(check).map((l) => `<div class="rc-row"><span>${esc(l.name)}${l.qty > 1 ? ` ×${l.qty}` : ''}${check.takeout ? ' ※' : ''}</span><span>${l.comp ? 'サービス' : yen(lineGross(l))}</span></div>
    ${l.options.length ? `<div class="rc-opt">${esc(l.options.map((x) => x.label).join(' / '))}</div>` : ''}`).join('');
  return `<div class="receipt">${head}<div class="rc-title">領 収 証</div><hr>${lines}<hr>
    <div class="rc-row"><span>小計</span><span>${yen(t.subtotal)}</span></div>
    ${t.ticketDiscount ? `<div class="rc-row"><span>${esc(s.ticket.name)} ${t.tickets}枚</span><span>−${yen(t.ticketDiscount)}</span></div>` : ''}
    ${(t.discounts || []).map((d) => `<div class="rc-row"><span>${esc(d.name)}</span><span>−${yen(d.amount)}</span></div>`).join('')}
    <div class="rc-row rc-total"><span>合計</span><span>${yen(t.total)}</span></div>${taxLine}<hr>
    ${check.payments.map((p) => `<div class="rc-row"><span>${esc(p.method)}${p.label ? `（${esc(p.label)}）` : ''}</span><span>${yen(p.received ?? p.amount)}</span></div>${p.change ? `<div class="rc-row"><span>おつり</span><span>${yen(p.change)}</span></div>` : ''}`).join('')}
    ${check.takeout ? '<div class="rc-opt">※は軽減税率対象</div>' : ''}<hr><div class="rc-foot">${esc(r.footer)}</div></div>`;
}

export async function printRyoshu(check) {
  const name = await promptDialog('領収書の宛名（空欄で「上様」）', { placeholder: '例：株式会社〇〇', ok: '次へ' });
  if (name === null) return;
  const tadashi = await promptDialog('但し書き', { value: 'ご飲食代として', ok: '印刷' });
  if (tadashi === null) return;
  printHtml(receiptHtml(check, { type: 'ryoshu', name: name || '上', tadashi }));
}

// ---- 操作 ----
const cur = () => checkById(CO.checkId);
async function patch(body) {
  const c = cur();
  if (!c) return;
  if ('split' in body) c.split = body.split; // 先に画面へ反映
  hooks.renderMain();
  await run(async () => { await api('PATCH', `/api/admin/checks/${c.id}`, body); await refresh(); });
}

export const checkoutActions = {
  'co-entry-key': (el) => { CO.entry = applyKey(CO.entry, el.dataset.k, 3); hooks.renderMain(); },
  'co-entry-go': () => {
    const no = Number(CO.entry);
    const c = S.data.openChecks.find((x) => x.tagNo === no);
    CO.entry = '';
    if (!c) { toast(`${no}番のご利用はありません`, 'error'); hooks.renderMain(); return; }
    goCheckout(c.id);
  },
  'co-open': (el) => goCheckout(el.dataset.id),
  'co-back': () => { CO.checkId = null; CO.pay = null; hooks.renderMain(); },
  'counter-quick': () => openStaffOrder({ tagNo: null, people: 1, takeout: false }, { thenCheckout: true }),
  'co-add': () => openStaffOrder({ checkId: CO.checkId }),
  'co-takeout': () => patch({ takeout: !cur().takeout }),
  'co-ticket': (el) => patch({ tickets: Math.max(0, (cur().tickets || 0) + Number(el.dataset.d)) }),
  'co-disc': (el) => {
    const d = settings().discounts.find((x) => x.id === el.dataset.id);
    patch({ discounts: [...cur().discounts, { ...d, id: `${d.id}-${Date.now()}` }] });
  },
  'co-disc-custom': () => {
    const st = { type: 'amount', value: '', name: '' };
    openModal({
      disc: st,
      html: () => `<div class="modal-head"><h2>割引を追加</h2><span class="spacer"></span><button class="btn btn-ghost" data-act="modal-close">✕</button></div>
        <div class="modal-body"><div class="row"><button class="pill ${st.type === 'amount' ? 'on' : ''}" data-act="disc-type" data-t="amount">円引き</button>
          <button class="pill ${st.type === 'percent' ? 'on' : ''}" data-act="disc-type" data-t="percent">％引き</button></div>
        <div class="co-display num">${st.value ? (st.type === 'percent' ? `${st.value}%` : yen(st.value)) : '<span class="muted">0</span>'}</div>
        ${keypad('disc-key')}<input data-input="disc-name" placeholder="名目（例：お詫び・常連さん）" value="${esc(st.name)}" style="margin-top:10px"></div>
        <div class="modal-foot"><span class="spacer"></span><button class="btn btn-primary btn-lg" data-act="disc-ok" ${st.value ? '' : 'disabled'}>追加</button></div>`,
    });
  },
  'disc-type': (el) => { S.modals.at(-1).disc.type = el.dataset.t; updateModal(); },
  'disc-key': (el) => { const st = S.modals.at(-1).disc; st.value = applyKey(st.value, el.dataset.k, st.type === 'percent' ? 3 : 7); if (st.type === 'percent' && Number(st.value) > 100) st.value = '100'; updateModal(); },
  'disc-ok': () => {
    const st = S.modals.at(-1).disc;
    closeModal();
    const name = st.name.trim() || (st.type === 'percent' ? `${st.value}%引き` : `${st.value}円引き`);
    patch({ discounts: [...cur().discounts, { id: `c-${Date.now()}`, name, type: st.type, value: Number(st.value) }] });
  },
  'co-disc-del': (el) => patch({ discounts: cur().discounts.filter((d) => d.id !== el.dataset.id) }),
  'co-mode': (el) => {
    const c = cur();
    const m = el.dataset.m;
    CO.pay = null; CO.amountStr = '';
    const prev = splitOf(c);
    if (m === 'items') patch({ split: { mode: 'items', people: prev.people || defaultPeople(c), assign: prev.assign || autoAssign(c, prev.people || defaultPeople(c)) } });
    else if (m === 'equal') patch({ split: { mode: 'equal', n: prev.n || Math.max(2, c.people || 2), unit: prev.unit || 1, people: prev.people, assign: prev.assign } });
    else patch({ split: { ...prev, mode: m } });
  },
  'co-eq-n': (el) => { const sp = splitOf(cur()); CO.pay = null; patch({ split: { ...sp, n: Math.max(2, Math.min(20, (sp.n || 2) + Number(el.dataset.d))) } }); },
  'co-eq-unit': (el) => { const sp = splitOf(cur()); CO.pay = null; patch({ split: { ...sp, unit: Number(el.dataset.u) } }); },
  'co-person-add': async () => {
    const sp = splitOf(cur());
    const name = await promptDialog('お名前（例：Cさん）', { value: `${'ABCDEFGHIJ'[(sp.people || []).length] || ''}さん` });
    if (!name || (sp.people || []).includes(name)) return;
    patch({ split: { ...sp, people: [...(sp.people || []), name.slice(0, 12)] } });
  },
  'co-person-del': () => {
    const sp = splitOf(cur());
    const people = (sp.people || []).slice(0, -1);
    const assign = Object.fromEntries(Object.entries(sp.assign || {}).map(([k, v]) => [k, v.filter((p) => people.includes(p))]));
    patch({ split: { ...sp, people, assign } });
  },
  'co-assign': (el) => {
    const sp = splitOf(cur());
    const assign = { ...(sp.assign || {}) };
    const who = new Set(assign[el.dataset.line] || []);
    if (who.has(el.dataset.p)) who.delete(el.dataset.p); else who.add(el.dataset.p);
    assign[el.dataset.line] = [...who];
    patch({ split: { ...sp, assign } });
  },
  'co-assign-rest': () => {
    const c = cur(); const sp = splitOf(c);
    const assign = { ...(sp.assign || {}) };
    for (const l of activeLines(c)) if (!(assign[l.id] || []).length) assign[l.id] = [...(sp.people || [])];
    patch({ split: { ...sp, assign } });
  },
  'co-share': (el) => { CO.pay = { label: el.dataset.label, method: CO.pay?.method || settings().paymentMethods[0], received: '' }; hooks.renderMain(); },
  'co-amount-key': (el) => { CO.amountStr = applyKey(CO.amountStr, el.dataset.k, 7); hooks.renderMain(); },
  'co-amount-half': () => { const t = computeTotals(cur(), settings()); CO.amountStr = String(Math.ceil(t.remaining / 2)); hooks.renderMain(); },
  'co-amount-rest': () => { const t = computeTotals(cur(), settings()); CO.amountStr = String(t.remaining); hooks.renderMain(); },
  'co-method': (el) => { CO.pay.method = el.dataset.m; CO.pay.received = ''; hooks.renderMain(); },
  'co-cash-key': (el) => { CO.pay.received = applyKey(CO.pay.received, el.dataset.k, 7); hooks.renderMain(); },
  'co-quick': (el) => { CO.pay.received = el.dataset.v; hooks.renderMain(); },
  'co-pay': async () => {
    const c = cur(); const p = CO.pay;
    if (!c || !p || CO.paying) return;
    CO.paying = true;
    const body = { method: p.method, amount: p.amount, label: p.label };
    if (p.method === '現金' && p.received) body.received = Number(p.received);
    const r = await run(() => api('POST', `/api/admin/checks/${c.id}/payments`, body));
    CO.paying = false;
    if (!r) return;
    CO.pay = null; CO.amountStr = '';
    if (r.closed) {
      CO.done = { check: r.check, change: r.payment.change ?? (p.method === '現金' ? 0 : null), received: r.payment.received ?? (p.method === '現金' ? r.payment.amount : null) };
      if (p.method !== '現金') { CO.done.change = null; CO.done.received = null; }
    } else {
      toast(`${p.label ? `${p.label}：` : ''}${yen(r.payment.amount)} を受け取りました${r.payment.change ? `（おつり ${yen(r.payment.change)}）` : ''}`, '', 5000);
    }
    await refresh();
  },
  'co-pay-del': async (el) => {
    if (!(await confirmDialog('この支払いの記録を取り消しますか？', { ok: '取り消す', danger: true }))) return;
    await run(async () => { await api('DELETE', `/api/admin/checks/${CO.checkId}/payments/${el.dataset.id}`); await refresh(); });
  },
  'co-close': async () => {
    const r = await run(() => api('POST', `/api/admin/checks/${CO.checkId}/close`));
    if (r) { CO.done = { check: r.check, change: null, received: null }; await refresh(); }
  },
  'co-receipt': () => printHtml(receiptHtml(CO.done.check)),
  'co-ryoshu': () => printRyoshu(CO.done.check),
  'co-next': () => { CO.done = null; CO.checkId = null; hooks.renderMain(); },
};

// スマホから注文した人ごとに品を自動で割り当てる（個別会計の初期値）
function autoAssign(c, people) {
  const assign = {};
  for (const o of c.orders) {
    const who = o.name && people.includes(o.name) ? [o.name] : [];
    for (const l of o.lines) assign[l.id] = who;
  }
  return assign;
}
