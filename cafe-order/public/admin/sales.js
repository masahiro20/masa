// 売上：日別の集計・会計履歴・再印刷・会計の取り消し・CSV
import { computeTotals, activeLines, lineGross } from '../shared/calc.js';
import { S, esc, yen, api, run, refresh, openModal, closeModal, timeStr, tagLabel, printHtml, confirmDialog, toast, hooks } from './core.js';
import { receiptHtml, printRyoshu } from './checkout.js';

const R = { date: '', data: null, loading: false };

export async function loadReport(date) {
  R.date = date || R.date || S.data.ctx.bizDate;
  R.loading = true;
  R.data = await run(() => api('GET', `/api/admin/report?date=${R.date}`));
  R.loading = false;
  hooks.renderMain();
}

const bar = (v, max) => `<span class="bar"><span style="width:${max ? Math.round((v / max) * 100) : 0}%"></span></span>`;

export function renderSales() {
  if (!R.data && !R.loading) { loadReport(); }
  const r = R.data;
  let h = `<div class="view-head"><h1>売上</h1><input type="date" data-change="s-date" value="${esc(R.date || S.data.ctx.bizDate)}" style="width:auto">
    <button class="btn btn-sm" data-act="s-today">今日</button><span class="spacer"></span>
    <a class="btn" href="/api/admin/export.csv?from=${R.date}&to=${R.date}&type=checks">会計CSV</a>
    <a class="btn" href="/api/admin/export.csv?from=${R.date}&to=${R.date}&type=items">商品別CSV</a>
    <button class="btn" data-act="s-month">月間CSV</button></div>`;
  if (!r) return `${h}<div class="empty">読み込み中…</div>`;

  h += `<div class="kpis">
    <div class="card kpi"><div class="small muted">売上（税込）</div><div class="num big">${yen(r.sales)}</div><div class="small muted">内消費税 ${yen(r.tax)}</div></div>
    <div class="card kpi"><div class="small muted">会計数 / 客数</div><div class="num big">${r.checks}<span class="small">組</span> ${r.guests}<span class="small">名</span></div><div class="small muted">持ち帰り ${r.takeout}組</div></div>
    <div class="card kpi"><div class="small muted">客単価</div><div class="num big">${yen(r.perGuest)}</div></div>
    <div class="card kpi"><div class="small muted">${esc(S.data.settings.ticket.name)}</div><div class="num big">${r.tickets}<span class="small">枚</span></div><div class="small muted">値引 ${yen(r.ticketDiscount)} / 割引 ${yen(r.discountTotal)}</div></div>
  </div>`;

  const methods = Object.entries(r.byMethod).sort((a, b) => b[1] - a[1]);
  const mMax = Math.max(0, ...methods.map((x) => x[1]));
  const items = Object.values(r.byItem).sort((a, b) => b.qty - a.qty);
  const iMax = Math.max(0, ...items.map((x) => x.qty));
  const hours = Object.entries(r.byHour).map(([k, v]) => [Number(k), v]).sort((a, b) => a[0] - b[0]);
  const hMax = Math.max(0, ...hours.map((x) => x[1]));
  h += `<div class="sales-grid">
    <div class="card pad"><h3>支払い方法</h3>${methods.map(([k, v]) => `<div class="brow"><span>${esc(k)}</span>${bar(v, mMax)}<b class="num">${yen(v)}</b></div>`).join('') || '<div class="muted small">データなし</div>'}
      <h3 style="margin-top:16px">時間帯</h3>${hours.map(([k, v]) => `<div class="brow"><span>${k}時</span>${bar(v, hMax)}<b class="num">${yen(v)}</b></div>`).join('') || '<div class="muted small">データなし</div>'}</div>
    <div class="card pad"><h3>商品ランキング</h3>${items.slice(0, 20).map((x, i) => `<div class="brow"><span>${i + 1}. ${esc(x.name)}</span>${bar(x.qty, iMax)}<b class="num">${x.qty}点</b><span class="num muted small">${yen(x.amount)}</span></div>`).join('') || '<div class="muted small">データなし</div>'}</div>
  </div>`;

  h += `<div class="card pad" style="margin-top:12px"><h3>会計履歴（${r.list.length}件${r.voids ? ` / 取消 ${r.voids}件` : ''}）</h3><table class="hist"><thead><tr><th>会計</th><th>番号札</th><th>人数</th><th>支払</th><th class="r">金額</th><th></th></tr></thead><tbody>
    ${[...r.list].reverse().map((c) => `<tr class="${c.status === 'void' ? 'void' : ''}" data-act="s-open" data-id="${c.id}"><td>${timeStr(c.closedAt)}</td><td>${c.tagNo ?? 'カウンター'}${c.takeout ? ' 持帰' : ''}</td>
      <td>${c.people || ''}</td><td>${c.status === 'void' ? `取消${c.voidReason ? `（${esc(c.voidReason)}）` : ''}` : esc(c.methods.join('・'))}</td><td class="r num">${yen(c.total)}</td><td>›</td></tr>`).join('') || '<tr><td colspan="6" class="muted">まだ会計はありません</td></tr>'}
  </tbody></table></div>`;
  return h;
}

async function openHistory(id) {
  const c = await run(() => api('GET', `/api/admin/history/${R.date}/${id}`));
  if (!c) return;
  const t = c.totals || computeTotals(c, S.data.settings);
  openModal({
    hist: c,
    html: () => `<div class="modal-head"><h2>${esc(tagLabel(c))} ${timeStr(c.openedAt)}〜${timeStr(c.closedAt)}</h2>${c.status === 'void' ? '<span class="chip chip-danger">取消</span>' : ''}<span class="spacer"></span><button class="btn btn-ghost" data-act="modal-close">✕</button></div>
      <div class="modal-body">${activeLines(c).map((l) => `<div class="row"><span class="grow">${esc(l.name)} × ${l.qty}<span class="small muted"> ${esc(l.options.map((x) => x.label).join(' / '))}</span></span><span class="num">${l.comp ? 'サービス' : yen(lineGross(l))}</span></div>`).join('')}
        <hr><div class="row"><span>小計</span><span class="spacer"></span><span class="num">${yen(t.subtotal)}</span></div>
        ${t.ticketDiscount ? `<div class="row"><span>チケット ${t.tickets}枚</span><span class="spacer"></span><span class="num">−${yen(t.ticketDiscount)}</span></div>` : ''}
        ${t.discountTotal ? `<div class="row"><span>割引</span><span class="spacer"></span><span class="num">−${yen(t.discountTotal)}</span></div>` : ''}
        <div class="row"><b>合計</b><span class="spacer"></span><b class="num">${yen(t.total)}</b></div>
        ${c.payments.map((p) => `<div class="row small"><span>${esc(p.method)}${p.label ? `（${esc(p.label)}）` : ''}</span><span class="spacer"></span><span class="num">${yen(p.amount)}</span></div>`).join('')}
        ${c.note ? `<p class="small muted">メモ：${esc(c.note)}</p>` : ''}</div>
      <div class="modal-foot"><button class="btn btn-danger" data-act="s-reopen">${c.status === 'void' ? '取消を戻す' : '会計を取り消して修正'}</button><span class="spacer"></span>
        ${c.status === 'void' ? '' : '<button class="btn" data-act="s-ryoshu">領収書</button><button class="btn btn-primary" data-act="s-print">レシート再印刷</button>'}</div>`,
  });
}

export const salesActions = {
  's-today': () => loadReport(S.data.ctx.bizDate),
  's-open': (el) => openHistory(el.dataset.id),
  's-print': () => printHtml(receiptHtml(S.modals.findLast((m) => m.hist).hist)),
  's-ryoshu': () => printRyoshu(S.modals.findLast((m) => m.hist).hist),
  's-month': () => {
    const d = R.date || S.data.ctx.bizDate;
    const from = `${d.slice(0, 8)}01`;
    const last = new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0).getDate();
    const a = document.createElement('a');
    a.href = `/api/admin/export.csv?from=${from}&to=${d.slice(0, 8)}${String(last).padStart(2, '0')}&type=checks`;
    document.body.append(a); a.click(); a.remove();
  },
  's-reopen': async () => {
    const m = S.modals.findLast((x) => x.hist);
    const c = m.hist;
    if (!(await confirmDialog('この会計を取り消して、営業中の伝票に戻します。\n支払いの記録は消えるので、返金・再会計を行ってください。', { ok: '取り消して戻す', danger: true }))) return;
    const r = await run(() => api('POST', `/api/admin/history/${R.date}/${c.id}/reopen`));
    if (!r) return;
    closeModal(m);
    toast(`${tagLabel(r.check)} の伝票に戻しました`);
    await refresh();
    await loadReport();
    hooks.goCheckout(r.check.id);
  },
};
export const salesChanges = {
  's-date': (el) => loadReport(el.value),
};
