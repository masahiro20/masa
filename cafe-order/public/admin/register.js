// レジ締め：開店時に釣銭準備金 → 営業中の入出金・点検 → 閉店時に金種を数えて精算
import {
  S, esc, yen, api, run, toast, refresh, keypad, applyKey, timeStr, openModal, closeModal, updateModal, confirmDialog, printHtml, hooks,
} from './core.js';

const DENOMS = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1];
const R = { data: null, loading: false, floatStr: '', counts: {}, note: '', result: null };

export async function loadRegister() {
  R.loading = true;
  R.data = await run(() => api('GET', '/api/admin/register'));
  R.loading = false;
  if (R.data && !R.floatStr) R.floatStr = String(R.data.lastFloat ?? '');
  hooks.renderMain();
}
export function registerChanged() { if (S.view === 'register') loadRegister(); }

const countSum = () => DENOMS.reduce((s, d) => s + d * (Number(R.counts[d]) || 0), 0);
const dt = (iso) => (iso ? new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export function renderRegister() {
  if (!R.data && !R.loading) loadRegister();
  const d = R.data;
  let h = '<div class="view-head"><h1>レジ締め</h1><span class="spacer"></span><button class="btn" data-act="co-drawer">ドロアを開ける</button></div>';
  if (!d) return `${h}<div class="empty">読み込み中…</div>`;
  if (R.result) return h + resultHtml(R.result);
  h += d.session ? openHtml(d) : closedHtml();
  if (d.log.length) {
    h += `<div class="card pad" style="margin-top:12px"><h3>これまでの精算</h3><table class="hist"><thead><tr><th>開始</th><th>精算</th><th class="r">売上</th><th class="r">現金売上</th><th class="r">過不足</th><th></th></tr></thead><tbody>
      ${d.log.map((e) => `<tr data-act="rg-log" data-id="${e.id}"><td>${dt(e.openedAt)}</td><td>${dt(e.closedAt)}</td><td class="r num">${yen(e.summary.sales)}</td>
        <td class="r num">${yen(e.summary.cashSales)}</td><td class="r num ${e.difference ? 'diff-bad' : 'diff-ok'}">${e.difference > 0 ? '+' : ''}${yen(e.difference)}</td><td>›</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  return h;
}

function closedHtml() {
  return `<div class="reg-open card pad">
    <h2>レジを開ける</h2>
    <p class="muted small">開店時に、レジに入れたおつり用の現金（釣銭準備金）を入力します。閉店時の過不足チェックの基準になります。</p>
    <div class="co-display num">${R.floatStr ? yen(Number(R.floatStr)) : '<span class="muted">¥0</span>'}</div>
    ${keypad('rg-float-key')}
    <button class="btn btn-primary btn-lg btn-block" data-act="rg-open">この金額でレジを開ける</button>
  </div>`;
}

function methodRows(sum) {
  const rows = Object.entries(sum.byMethod).sort((a, b) => b[1].amount - a[1].amount);
  return rows.map(([m, v]) => `<div class="row"><span>${esc(m)}<span class="muted small">（${v.count}件）</span></span><span class="spacer"></span><b class="num">${yen(v.amount)}</b></div>`).join('') || '<div class="muted small">まだ支払いはありません</div>';
}

function openHtml(d) {
  const s = d.summary;
  const actual = countSum();
  const diff = actual - s.expectedCash;
  const counted = DENOMS.some((x) => R.counts[x]);
  return `<div class="reg-grid">
    <div class="card pad">
      <div class="row"><h3 class="grow">営業中</h3><span class="chip chip-ok">${timeStr(d.session.openedAt)} から</span></div>
      <div class="kpi-row"><div><div class="small muted">売上（税込）</div><div class="num big">${yen(s.sales)}</div></div>
        <div><div class="small muted">会計数 / 客数</div><div class="num big">${s.salesChecks}<span class="small">組</span> ${s.guests}<span class="small">名</span></div></div></div>
      <h3 style="margin-top:12px">支払い方法別</h3>${methodRows(s)}
      <h3 style="margin-top:12px">レジの現金</h3>
      <div class="row"><span>釣銭準備金</span><span class="spacer"></span><span class="num">${yen(s.float)}</span></div>
      <div class="row"><span>現金売上</span><span class="spacer"></span><span class="num">${yen(s.cashSales)}</span></div>
      <div class="row"><span>入金</span><span class="spacer"></span><span class="num">${yen(s.moneyIn)}</span></div>
      <div class="row"><span>出金</span><span class="spacer"></span><span class="num">−${yen(s.moneyOut)}</span></div>
      <div class="row total-row"><b>あるはずの現金（理論在高）</b><span class="spacer"></span><b class="num">${yen(s.expectedCash)}</b></div>
      <div class="grid3" style="margin-top:12px">
        <button class="btn" data-act="rg-move" data-t="in">＋ 入金</button>
        <button class="btn" data-act="rg-move" data-t="out">− 出金</button>
        <button class="btn" data-act="rg-check">点検レシート</button></div>
      ${d.session.movements.length ? `<div class="paylist" style="margin-top:10px"><div class="small muted">入出金の記録</div>${d.session.movements.map((m) => `<div class="row small">
        <span>${timeStr(m.at)}</span><span class="chip ${m.type === 'in' ? 'chip-ok' : 'chip-warn'}">${m.type === 'in' ? '入金' : '出金'}</span><span class="grow">${esc(m.reason)}</span>
        <b class="num">${yen(m.amount)}</b><button class="btn btn-sm btn-ghost" data-act="rg-move-del" data-id="${m.id}">取消</button></div>`).join('')}</div>` : ''}
    </div>
    <div class="card pad">
      <h3>閉店：レジの現金を数える</h3>
      <p class="small muted">お札・硬貨の枚数を入れてください。あるはずの現金との差（過不足）が出ます。</p>
      <div class="denoms">${DENOMS.map((x) => `<div class="denom"><span class="dn">${x.toLocaleString()}円</span>
        <div class="stepper sm"><button data-act="rg-cnt" data-d="${x}" data-v="-1">−</button><input type="number" inputmode="numeric" min="0" data-count="${x}" value="${R.counts[x] || ''}" placeholder="0"><button data-act="rg-cnt" data-d="${x}" data-v="1">＋</button></div>
        <span class="num small dv">${R.counts[x] ? yen(x * R.counts[x]) : ''}</span></div>`).join('')}</div>
      <div class="row total-row"><b>数えた現金（実在高）</b><span class="spacer"></span><b class="num">${yen(actual)}</b></div>
      <div class="row total-row ${counted ? (diff === 0 ? 'diff-ok' : 'diff-bad') : ''}"><b>過不足</b><span class="spacer"></span><b class="num big">${counted ? `${diff > 0 ? '+' : ''}${yen(diff)}` : '—'}</b></div>
      <input data-input="rg-note" placeholder="メモ（例：1,000円を両替に使用）" value="${esc(R.note)}" style="margin-top:8px">
      <button class="btn btn-primary btn-lg btn-block" style="margin-top:10px" data-act="rg-close" ${counted ? '' : 'disabled'}>精算してレジを締める</button>
    </div>
  </div>`;
}

function resultHtml(e) {
  return `<div class="co-done card"><div class="done-mark ${e.difference ? 'warn' : ''}">${e.difference ? '!' : '✓'}</div>
    <h1>レジを締めました</h1>
    <div class="done-grid"><div><div class="small muted">売上</div><div class="num big">${yen(e.summary.sales)}</div></div>
      <div><div class="small muted">あるはずの現金</div><div class="num big">${yen(e.summary.expectedCash)}</div></div>
      <div><div class="small muted">数えた現金</div><div class="num big">${yen(e.actual)}</div></div></div>
    <p class="${e.difference ? 'diff-bad' : 'diff-ok'}" style="font-size:20px;font-weight:800">過不足 ${e.difference > 0 ? '+' : ''}${yen(e.difference)}${e.difference === 0 ? '（ぴったりです）' : ''}</p>
    <div class="grid2"><button class="btn btn-lg" data-act="rg-print" data-id="${e.id}">精算レシートを印刷</button><button class="btn btn-lg btn-primary" data-act="rg-done">閉じる</button></div></div>`;
}

// 精算・点検の内容（AirPrint 用）
function reportHtml(e, title) {
  const s = e.summary;
  const row = (l, r, b) => `<div class="rc-row${b ? ' rc-total' : ''}"><span>${esc(l)}</span><span>${r}</span></div>`;
  return `<div class="receipt"><div class="rc-title">${esc(title)}</div><div class="rc-shop">${esc(S.data.settings.shopName)}</div>
    <div>開始 ${dt(e.openedAt)}</div><div>${e.closedAt ? `精算 ${dt(e.closedAt)}` : `点検 ${dt(new Date().toISOString())}`}</div><hr>
    ${row('売上（税込）', yen(s.sales))}${row('会計数 / 客数', `${s.salesChecks}組 / ${s.guests}名`)}<hr>
    ${Object.entries(s.byMethod).map(([m, v]) => row(`${m}（${v.count}件）`, yen(v.amount))).join('')}<hr>
    ${row('釣銭準備金', yen(s.float))}${row('現金売上', yen(s.cashSales))}${row('入金', yen(s.moneyIn))}${row('出金', `−${yen(s.moneyOut)}`)}${row('理論在高', yen(s.expectedCash), true)}
    ${e.counts ? `<hr>${DENOMS.filter((x) => e.counts[x]).map((x) => row(`${x.toLocaleString()}円 × ${e.counts[x]}`, yen(x * e.counts[x]))).join('')}${row('実在高', yen(e.actual), true)}${row('過不足', `${e.difference > 0 ? '+' : ''}${yen(e.difference)}`, true)}${e.note ? `<div>メモ：${esc(e.note)}</div>` : ''}` : ''}</div>`;
}

async function printReport(entry) {
  const title = entry.closedAt ? 'レジ精算' : 'レジ点検';
  if (S.data.printer && S.data.printer.type !== 'none') {
    const r = await run(() => api('POST', '/api/admin/print/register', { entry }));
    if (r) toast('プリンターに送りました');
    return;
  }
  printHtml(reportHtml(entry, title));
}

export const registerActions = {
  'rg-float-key': (el) => { R.floatStr = applyKey(R.floatStr, el.dataset.k, 7); hooks.renderMain(); },
  'rg-open': async () => {
    const r = await run(() => api('POST', '/api/admin/register/open', { float: Number(R.floatStr || 0) }));
    if (r) { toast('レジを開けました'); R.counts = {}; R.note = ''; await loadRegister(); await refresh(); }
  },
  'rg-move': (el) => {
    const st = { type: el.dataset.t, amount: '', reason: '' };
    openModal({
      move: st,
      html: () => `<div class="modal-head"><h2>${st.type === 'in' ? '入金（レジにお金を入れる）' : '出金（レジからお金を出す）'}</h2><span class="spacer"></span><button class="btn btn-ghost" data-act="modal-close">✕</button></div>
        <div class="modal-body"><div class="co-display num">${st.amount ? yen(Number(st.amount)) : '<span class="muted">¥0</span>'}</div>${keypad('rg-move-key')}
        <input data-input="rg-move-reason" placeholder="${st.type === 'in' ? '理由（例：両替・釣銭の補充）' : '理由（例：牛乳の買い出し・配達代）'}" value="${esc(st.reason)}"></div>
        <div class="modal-foot"><span class="spacer"></span><button class="btn btn-primary btn-lg" data-act="rg-move-ok" ${st.amount ? '' : 'disabled'}>記録する</button></div>`,
    });
  },
  'rg-move-key': (el) => { const st = S.modals.at(-1).move; st.amount = applyKey(st.amount, el.dataset.k, 7); updateModal(); },
  'rg-move-ok': async () => {
    const m = S.modals.findLast((x) => x.move);
    const r = await run(() => api('POST', '/api/admin/register/movements', { type: m.move.type, amount: Number(m.move.amount), reason: m.move.reason }));
    if (r) { closeModal(m); toast('記録しました'); loadRegister(); }
  },
  'rg-move-del': async (el) => {
    if (!(await confirmDialog('この入出金の記録を取り消しますか？', { ok: '取り消す', danger: true }))) return;
    await run(() => api('DELETE', `/api/admin/register/movements/${el.dataset.id}`));
    loadRegister();
  },
  'rg-check': () => printReport({ ...R.data.session, summary: R.data.summary }),
  'rg-cnt': (el) => {
    const d = el.dataset.d;
    R.counts[d] = Math.max(0, (Number(R.counts[d]) || 0) + Number(el.dataset.v));
    hooks.renderMain();
  },
  'rg-close': async () => {
    const actual = countSum();
    const diff = actual - R.data.summary.expectedCash;
    if (!(await confirmDialog(`数えた現金 ${yen(actual)}（過不足 ${diff > 0 ? '+' : ''}${yen(diff)}）でレジを締めます。\n締めた後は今日の入出金を追加できません。`, { ok: '精算する' }))) return;
    const r = await run(() => api('POST', '/api/admin/register/close', { counts: R.counts, note: R.note }));
    if (!r) return;
    R.result = r.entry; R.counts = {}; R.note = '';
    await loadRegister();
    await refresh();
  },
  'rg-print': () => printReport(R.result || R.data.log.find((x) => x.id === R.data.log[0]?.id)),
  'rg-done': () => { R.result = null; hooks.renderMain(); },
  'rg-log': async (el) => {
    const e = await run(() => api('GET', `/api/admin/register/log/${el.dataset.id}`));
    if (!e) return;
    openModal({
      html: () => `<div class="modal-head"><h2>精算の記録</h2><span class="spacer"></span><button class="btn btn-ghost" data-act="modal-close">✕</button></div>
        <div class="modal-body">${reportHtml(e, 'レジ精算')}</div>
        <div class="modal-foot"><span class="spacer"></span><button class="btn btn-primary" data-act="rg-log-print" data-id="${e.id}">印刷</button></div>`,
      entry: e,
    });
  },
  'rg-log-print': () => printReport(S.modals.findLast((x) => x.entry).entry),
};

export const registerInputs = {
  'rg-note': (el) => { R.note = el.value; },
  'rg-move-reason': (el) => { S.modals.findLast((x) => x.move).move.reason = el.value; },
};

export function registerChange(el) {
  if (el.dataset.count == null) return false;
  R.counts[el.dataset.count] = Math.max(0, Math.floor(Number(el.value) || 0));
  hooks.renderMain();
  return true;
}
