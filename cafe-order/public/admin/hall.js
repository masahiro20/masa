// ホール：番号札ごとの利用状況と伝票の詳細
import { computeTotals, unservedCount, activeLines } from '../shared/calc.js';
import {
  S, esc, yen, api, run, toast, openModal, closeModal, updateModal, elapsed, minutesSince, timeStr, tagLabel, checkById,
  refresh, confirmDialog, promptDialog, hooks, localStorageGet, localStorageSet,
} from './core.js';
import { openStaffOrder, TIMING_LABEL } from './ordering.js';

// 新着（まだ開いて見ていない）注文
const seen = new Set(localStorageGet('cafe_seen_orders', []));
export function markSeen(check) {
  for (const o of check.orders) seen.add(o.id);
  localStorageSet('cafe_seen_orders', [...seen].slice(-800));
}
export const isNewOrder = (o) => o.source === 'customer' && !seen.has(o.id);

export function callsFor(check) {
  return S.data.calls.filter((c) => (c.checkId ? c.checkId === check.id : c.tagNo === check.tagNo));
}

export function renderHall() {
  const d = S.data;
  const byTag = new Map(d.openChecks.filter((c) => c.tagNo != null).map((c) => [c.tagNo, c]));
  const tagNos = new Set(d.tags.map((t) => t.no));
  // 札なし（カウンター）と、札の枚数を減らした後も残っている番号の伝票
  const counter = d.openChecks.filter((c) => c.tagNo == null || !tagNos.has(c.tagNo));
  const active = d.openChecks.length;
  const guests = d.openChecks.reduce((s, c) => s + (c.people || 0), 0);

  let h = `<div class="view-head"><h1>ホール</h1>
    <span class="chip chip-accent">ご利用中 ${active}組${guests ? ` / ${guests}名` : ''}</span>
    <span class="spacer"></span>
    <button class="btn" data-act="counter-order">🧾 カウンター注文（札なし）</button></div>`;

  if (d.calls.length) {
    h += `<div class="calls-bar">${d.calls.map((c) => `<div class="call-pill"><span class="bell">🔔</span><b>${c.tagNo}番</b> ${esc(c.type)}
      <span class="small muted">${elapsed(c.at)}前</span><button class="btn btn-sm btn-ok" data-act="call-done" data-id="${c.id}">対応済</button></div>`).join('')}</div>`;
  }

  h += '<div class="tag-grid">';
  for (const t of d.tags) {
    const c = byTag.get(t.no);
    if (!c) {
      const waiting = (d.pendingServe || []).some((p) => p.tagNo === t.no);
      h += `<button class="tag free" data-act="tag-free" data-no="${t.no}"><span class="no">${t.no}</span><span class="small muted">${waiting ? '会計済・提供待ち' : '空き'}</span></button>`;
      continue;
    }
    h += tagCard(c);
  }
  for (const c of counter) h += tagCard(c);
  h += '</div>';
  return h;
}

function tagCard(c) {
  const t = computeTotals(c, S.data.settings);
  const un = unservedCount(c);
  const calls = callsFor(c);
  const isNew = c.orders.some(isNewOrder);
  const m = minutesSince(c.openedAt);
  const lastOrder = c.orders.at(-1);
  const waitMin = activeLines(c).filter((l) => l.status === 'new' && l.timing !== 'after').length && lastOrder ? minutesSince(oldestUnserved(c)) : 0;
  const askBill = calls.some((x) => x.type.includes('会計'));
  return `<button class="tag busy ${isNew ? 'new' : ''} ${calls.length ? 'calling' : ''}" data-act="open-check" data-id="${c.id}">
    <div class="row"><span class="no">${c.tagNo ?? '🧾'}</span><span class="spacer"></span>
      ${isNew ? '<span class="chip chip-danger">NEW</span>' : ''}${calls.length ? '<span class="bell">🔔</span>' : ''}</div>
    <div class="tag-meta">${c.tagNo == null ? 'カウンター · ' : ''}${c.people ? `${c.people}名 · ` : ''}${m}分${c.takeout ? ' · 持帰' : ''}</div>
    <div class="tag-total num">${yen(t.total)}</div>
    <div class="row" style="gap:4px;flex-wrap:wrap">
      ${un ? `<span class="chip ${waitMin >= 15 ? 'chip-danger' : 'chip-warn'}">未提供 ${un}${waitMin ? ` · ${waitMin}分` : ''}</span>` : c.orders.length ? '<span class="chip chip-ok">提供済</span>' : '<span class="chip">注文待ち</span>'}
      ${askBill ? '<span class="chip chip-accent">お会計希望</span>' : ''}
      ${t.paid ? `<span class="chip">一部支払済</span>` : ''}
    </div></button>`;
}

function oldestUnserved(c) {
  let oldest = null;
  for (const o of c.orders) if (o.lines.some((l) => l.status === 'new')) { oldest = o.at; break; }
  return oldest || c.openedAt;
}

// ---- 空き札をタップ ----
function openFreeTag(no) {
  const st = { people: 0 };
  openModal({
    html: () => `<div class="modal-head"><h2>${no}番 を受付</h2><span class="spacer"></span><button class="btn btn-ghost" data-act="modal-close">✕</button></div>
      <div class="modal-body"><div class="small muted" style="margin-bottom:6px">人数（あとで変更できます）</div>
      <div class="people-pick">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<button class="pill ${st.people === n ? 'on' : ''}" data-act="free-people" data-n="${n}">${n}名</button>`).join('')}</div>
      <div class="grid2" style="margin-top:16px">
        <button class="btn btn-lg btn-primary" data-act="free-open" data-no="${no}" data-mode="order">スタッフが注文を入力</button>
        <button class="btn btn-lg" data-act="free-open" data-no="${no}" data-mode="phone">受付のみ（スマホで注文）</button>
      </div>
      <p class="small muted">「受付のみ」はスマホで注文するお客様用です。${S.data.settings.requireStaffOpen ? '現在「スタッフ受付後のみ注文可」の設定なので、受付するとこの札からスマホ注文できるようになります。' : 'お客様がQRから最初に注文した時点でも自動で受付されます。'}</p></div>`,
    free: st,
  });
}

// ---- 伝票の詳細（右から出るパネル） ----
export function openCheckPanel(id) {
  const c = checkById(id);
  if (!c) return;
  markSeen(c);
  openModal({ size: 'side', live: true, checkId: id, html: () => checkPanelHtml(id) });
  hooks.renderMain();
}

const LSTATUS = { new: '未提供', served: '提供済', cancelled: '取消' };

function checkPanelHtml(id) {
  const c = checkById(id);
  if (!c) {
    return `<div class="modal-head"><h2>伝票</h2><span class="spacer"></span><button class="btn btn-ghost" data-act="modal-close">✕</button></div>
      <div class="empty">この伝票は会計済み、または移動されました。</div>`;
  }
  markSeen(c);
  const t = computeTotals(c, S.data.settings);
  const calls = callsFor(c);
  const devices = Object.values(c.devices || {});
  let h = `<div class="modal-head"><h2><span class="tagno">${c.tagNo ?? '🧾'}</span> ${c.tagNo == null ? 'カウンター' : '番'}</h2>
    <span class="small muted">${timeStr(c.openedAt)}〜（${elapsed(c.openedAt)}）</span><span class="spacer"></span>
    <button class="btn btn-ghost" data-act="modal-close">✕</button></div><div class="modal-body">`;
  if (calls.length) {
    h += calls.map((x) => `<div class="call-pill"><span class="bell">🔔</span>${esc(x.type)}<span class="small muted">${elapsed(x.at)}前</span><span class="spacer"></span><button class="btn btn-sm btn-ok" data-act="call-done" data-id="${x.id}">対応済</button></div>`).join('');
  }
  h += `<div class="row wrap" style="margin:8px 0 12px">
    <div class="stepper sm"><button data-act="ck-people" data-d="-1">−</button><span>${c.people || '—'}名</span><button data-act="ck-people" data-d="1">＋</button></div>
    <button class="pill ${c.takeout ? 'on' : ''}" data-act="ck-takeout">${c.takeout ? '持ち帰り' : '店内'}</button>
    ${devices.length ? `<span class="chip">📱 ${devices.length}台${devices.filter(Boolean).length ? `（${esc(devices.filter(Boolean).join('、'))}）` : ''}</span>` : ''}
    </div>`;
  if (!c.orders.length) h += '<div class="empty small">まだ注文がありません</div>';
  for (const o of c.orders) {
    const pending = o.lines.some((l) => l.status === 'new');
    h += `<div class="ord"><div class="ord-h"><b>${timeStr(o.at)}</b><span class="chip ${o.source === 'staff' ? '' : 'chip-accent'}">${o.source === 'staff' ? 'スタッフ入力' : `📱 ${esc(o.name || 'スマホ')}`}</span>
      <span class="spacer"></span>${pending ? `<button class="btn btn-sm" data-act="serve-order" data-check="${c.id}" data-order="${o.id}">すべて提供済に</button>` : ''}</div>`;
    for (const l of o.lines) {
      h += `<div class="ln ${l.status}">
        <button class="ln-status ${l.status}" data-act="line-toggle" data-check="${c.id}" data-line="${l.id}" ${l.status === 'cancelled' ? 'disabled' : ''}>${LSTATUS[l.status]}</button>
        <div class="grow"><div><b>${esc(l.name)}</b> × ${l.qty}${l.comp ? ' <span class="chip chip-ok">サービス</span>' : ''}${l.ticketEligible ? ' <span class="chip">🎫</span>' : ''}</div>
          ${l.options.length ? `<div class="small muted">${esc(l.options.map((x) => x.label).join(' / '))}</div>` : ''}
          ${l.timing ? `<div class="small"><span class="chip chip-warn">${TIMING_LABEL[l.timing]}</span></div>` : ''}
          ${l.note ? `<div class="small note">「${esc(l.note)}」</div>` : ''}</div>
        <div class="num">${l.comp ? '¥0' : yen(l.unitPrice * l.qty)}</div>
        ${l.status !== 'cancelled' ? `<button class="btn btn-sm btn-ghost" data-act="line-menu" data-check="${c.id}" data-line="${l.id}">…</button>` : ''}</div>`;
    }
    h += '</div>';
  }
  h += `<label class="small muted" style="display:block;margin-top:12px">メモ（スタッフのみ）<textarea data-change="ck-note" rows="2" placeholder="アレルギー・常連さん など">${esc(c.note || '')}</textarea></label>`;
  h += `</div><div class="modal-foot col">
    <div class="row" style="width:100%"><span class="muted">合計（${t.itemCount}点）</span><span class="spacer"></span><b class="num" style="font-size:24px">${yen(t.total)}</b></div>
    <div class="grid3" style="width:100%">
      <button class="btn" data-act="ck-add">＋ 追加注文</button>
      <button class="btn" data-act="ck-move">札を移動</button>
      <button class="btn" data-act="ck-merge">合流</button>
    </div>
    <div class="grid2" style="width:100%">
      <button class="btn btn-danger" data-act="ck-void">伝票を取消</button>
      <button class="btn btn-primary btn-lg" data-act="ck-checkout">会計へ ›</button>
    </div></div>`;
  return h;
}

const panelCheck = () => checkById(S.modals.findLast((m) => m.checkId)?.checkId);

async function patchCheck(c, body) {
  await run(async () => { await api('PATCH', `/api/admin/checks/${c.id}`, body); await refresh(); });
}

export const hallActions = {
  'counter-order': () => openStaffOrder({ tagNo: null, people: 1, takeout: false }),
  'tag-free': (el) => openFreeTag(Number(el.dataset.no)),
  'free-people': (el) => { S.modals.at(-1).free.people = Number(el.dataset.n); updateModal(); },
  'free-open': async (el) => {
    const no = Number(el.dataset.no);
    const people = S.modals.at(-1).free.people;
    closeModal();
    if (el.dataset.mode === 'order') { openStaffOrder({ tagNo: no, people, takeout: false }); return; }
    await run(async () => { await api('POST', '/api/admin/checks', { tagNo: no, people }); toast(`${no}番を受付しました`); await refresh(); });
  },
  'open-check': (el) => openCheckPanel(el.dataset.id),
  'call-done': async (el) => run(async () => { await api('POST', `/api/admin/calls/${el.dataset.id}/done`); await refresh(); }),
  'serve-order': async (el) => run(async () => { await api('POST', `/api/admin/checks/${el.dataset.check}/serve`, { orderId: el.dataset.order }); await refresh(); }),
  'line-toggle': async (el) => {
    const c = checkById(el.dataset.check);
    const l = c?.orders.flatMap((o) => o.lines).find((x) => x.id === el.dataset.line);
    if (!l) return;
    await run(async () => { await api('POST', `/api/admin/checks/${c.id}/lines/${l.id}`, { status: l.status === 'served' ? 'new' : 'served' }); await refresh(); });
  },
  'line-menu': (el) => {
    const c = checkById(el.dataset.check);
    const l = c?.orders.flatMap((o) => o.lines).find((x) => x.id === el.dataset.line);
    if (!l) return;
    openModal({
      html: () => `<div class="modal-head"><h2>${esc(l.name)}</h2><span class="spacer"></span><button class="btn btn-ghost" data-act="modal-close">✕</button></div>
        <div class="modal-body"><div class="row" style="justify-content:center;margin-bottom:14px">数量
          <div class="stepper"><button data-act="lm-qty" data-d="-1">−</button><span>${l.qty}</span><button data-act="lm-qty" data-d="1">＋</button></div></div>
        <div class="grid2">
          <button class="btn btn-lg" data-act="lm-comp">${l.comp ? 'サービスを解除' : 'サービス（無料）にする'}</button>
          <button class="btn btn-lg btn-danger" data-act="lm-cancel">この品を取消</button></div>
        <p class="small muted">取消すると在庫数が戻ります。「サービス」は提供したまま金額だけ0円にします。</p></div>`,
      line: { checkId: c.id, line: l },
    });
  },
  'lm-qty': async (el) => {
    const m = S.modals.at(-1); const { checkId, line } = m.line;
    const q = Math.max(1, line.qty + Number(el.dataset.d));
    await run(async () => { const r = await api('POST', `/api/admin/checks/${checkId}/lines/${line.id}`, { qty: q }); line.qty = r.check.orders.flatMap((o) => o.lines).find((x) => x.id === line.id).qty; await refresh(); updateModal(); });
  },
  'lm-comp': async () => {
    const m = S.modals.at(-1); const { checkId, line } = m.line;
    await run(async () => { await api('POST', `/api/admin/checks/${checkId}/lines/${line.id}`, { comp: !line.comp }); closeModal(m); await refresh(); });
  },
  'lm-cancel': async () => {
    const m = S.modals.at(-1); const { checkId, line } = m.line;
    const reason = await promptDialog(`「${line.name}」を取り消します。理由（任意）`, { placeholder: '例：お客様都合 / 品切れ / 誤入力', ok: '取り消す' });
    if (reason === null) return;
    await run(async () => { await api('POST', `/api/admin/checks/${checkId}/lines/${line.id}`, { status: 'cancelled', reason }); closeModal(m); await refresh(); });
  },
  'ck-people': async (el) => { const c = panelCheck(); await patchCheck(c, { people: Math.max(0, (c.people || 0) + Number(el.dataset.d)) }); },
  'ck-takeout': async () => { const c = panelCheck(); await patchCheck(c, { takeout: !c.takeout }); },
  'ck-add': () => openStaffOrder({ checkId: panelCheck().id }),
  'ck-move': async () => {
    const c = panelCheck();
    const v = await promptDialog(`${tagLabel(c)} を別の番号札に移動します。移動先の番号（空欄でカウンター扱い）`, { type: 'number', ok: '移動' });
    if (v === null) return;
    await patchCheck(c, { tagNo: v === '' ? null : Number(v) });
    toast('移動しました');
  },
  'ck-merge': () => {
    const c = panelCheck();
    const others = S.data.openChecks.filter((x) => x.id !== c.id);
    if (!others.length) { toast('合流できる伝票がありません'); return; }
    openModal({
      html: () => `<div class="modal-head"><h2>${esc(tagLabel(c))} に合流させる伝票</h2><span class="spacer"></span><button class="btn btn-ghost" data-act="modal-close">✕</button></div>
        <div class="modal-body"><p class="small muted">選んだ伝票の注文・支払いをこの伝票にまとめます（後から来たお連れ様など）。</p>
        <div class="grid3">${others.map((o) => `<button class="btn btn-lg" data-act="merge-from" data-id="${o.id}">${esc(tagLabel(o))}<br><span class="small">${yen(computeTotals(o, S.data.settings).total)}</span></button>`).join('')}</div></div>`,
    });
  },
  'merge-from': async (el) => {
    const c = panelCheck();
    closeModal();
    await run(async () => { await api('POST', `/api/admin/checks/${c.id}/merge`, { fromId: el.dataset.id }); toast('合流しました'); await refresh(); });
  },
  'ck-void': async () => {
    const c = panelCheck();
    if (computeTotals(c, S.data.settings).paid) { toast('支払い済みの記録があります。会計画面で支払いを取り消してください', 'error'); return; }
    const reason = c.orders.length ? await promptDialog(`${tagLabel(c)} の伝票を取り消します（売上に計上されません）。理由`, { placeholder: '例：誤って受付 / お客様が退店', ok: '取り消す' }) : '';
    if (reason === null) return;
    await run(async () => { await api('POST', `/api/admin/checks/${c.id}/void`, { reason }); closeModal(); toast('取り消しました'); await refresh(); });
  },
  'ck-checkout': () => { const c = panelCheck(); closeModal(); hooks.goCheckout(c.id); },
};

export const hallChanges = {
  'ck-note': async (el) => { const c = panelCheck(); if (c) await patchCheck(c, { note: el.value }); },
};

export { confirmDialog };
