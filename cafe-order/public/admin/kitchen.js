// 注文：未提供の品を古い順に並べたキッチン／ドリンク用の伝票ボード
import { S, esc, api, run, refresh, minutesSince, timeStr, tagLabel, localStorageSet } from './core.js';
import { TIMING_LABEL } from './ordering.js';
import { isNewOrder, markSeen, openCheckPanel } from './hall.js';

const STATIONS = [['all', 'すべて'], ['drink', 'ドリンク'], ['food', 'フード']];

const servable = () => [...S.data.openChecks, ...(S.data.pendingServe || []).map((c) => ({ ...c, paid: true }))];

export function pendingCount(station = 'all') {
  let n = 0;
  for (const c of servable()) for (const o of c.orders) for (const l of o.lines) {
    if (l.status === 'new' && (station === 'all' || l.station === station)) n += l.qty;
  }
  return n;
}

export function renderKitchen() {
  const st = S.station;
  const tickets = [];
  for (const c of servable()) {
    for (const o of c.orders) {
      const lines = o.lines.filter((l) => l.status === 'new' && (st === 'all' || l.station === st));
      if (lines.length) tickets.push({ c, o, lines });
    }
  }
  tickets.sort((a, b) => a.o.at.localeCompare(b.o.at));
  // 「食後」指定だけの伝票は後ろへ
  tickets.sort((a, b) => Number(a.lines.every((l) => l.timing === 'after')) - Number(b.lines.every((l) => l.timing === 'after')));

  let h = `<div class="view-head"><h1>注文</h1>
    <div class="seg-tabs">${STATIONS.map(([k, l]) => `<button class="${st === k ? 'on' : ''}" data-act="station" data-s="${k}">${l}<span class="count">${pendingCount(k)}</span></button>`).join('')}</div>
    <span class="spacer"></span><span class="small muted">品名をタップで提供済に</span></div>`;
  if (!tickets.length) return `${h}<div class="empty big-empty">☕<br>未提供の注文はありません</div>`;

  h += '<div class="tickets">';
  for (const { c, o, lines } of tickets) {
    const m = minutesSince(o.at);
    const allAfter = lines.every((l) => l.timing === 'after');
    const cls = allAfter ? 'later' : m >= 20 ? 'late' : m >= 10 ? 'slow' : '';
    h += `<div class="ticket ${cls} ${isNewOrder(o) ? 'new' : ''}">
      <div class="ticket-h" ${c.paid ? '' : `data-act="open-check" data-id="${c.id}"`}><span class="tno">${c.tagNo ?? '🧾'}</span>
        <div class="grow"><div class="small">${c.tagNo == null ? 'カウンター' : '番'}${c.takeout ? ' · 持ち帰り' : ''}${c.paid ? ' <span class="chip chip-ok">会計済</span>' : ''}</div>
        <div class="small muted">${timeStr(o.at)} · ${o.source === 'staff' ? 'スタッフ' : esc(o.name || 'スマホ')}</div></div>
        <span class="mins">${m}分</span></div>
      <div class="ticket-lines">${lines.map((l) => `<button class="tl" data-act="k-serve" data-check="${c.id}" data-line="${l.id}">
        <span class="q">${l.qty}</span><span class="grow"><b>${esc(l.name)}</b>
        ${l.options.length ? `<span class="opts">${esc(l.options.map((x) => x.label).join(' / '))}</span>` : ''}
        ${l.note ? `<span class="note">「${esc(l.note)}」</span>` : ''}</span>
        ${l.timing ? `<span class="chip ${l.timing === 'after' ? 'chip-accent' : 'chip-warn'}">${TIMING_LABEL[l.timing]}</span>` : ''}</button>`).join('')}</div>
      <button class="btn btn-ok btn-block" data-act="k-serve-all" data-check="${c.id}" data-order="${o.id}">まとめて提供済</button>
    </div>`;
  }
  h += '</div>';
  return h;
}

export const kitchenActions = {
  station: (el) => { S.station = el.dataset.s; localStorageSet('cafe_station', S.station); refreshMain(); },
  'k-serve': async (el) => run(async () => { await api('POST', `/api/admin/checks/${el.dataset.check}/lines/${el.dataset.line}`, { status: 'served' }); await refresh(); }),
  'k-serve-all': async (el) => {
    const c = servable().find((x) => x.id === el.dataset.check);
    if (c) markSeen(c);
    await run(async () => {
      await api('POST', `/api/admin/checks/${el.dataset.check}/serve`, { orderId: el.dataset.order, station: S.station === 'all' ? '' : S.station });
      await refresh();
    });
  },
};
let refreshMain = () => {};
export function setKitchenRerender(fn) { refreshMain = fn; }
export { openCheckPanel, tagLabel };
