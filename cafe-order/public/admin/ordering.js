// スタッフによる注文入力（スマホを使わないお客様・カウンター販売・追加注文の代行）
import { priceLine, itemStatus, choiceLabel, isSoldOutToday, stockLeft } from '/shared/calc.js';
import { S, esc, yen, api, run, toast, openModal, closeModal, updateModal, itemById, uid, refresh, hooks } from './core.js';

const TIMING = [['', 'おまかせ'], ['first', '先に'], ['with', '一緒に'], ['after', '食後']];
export const TIMING_LABEL = { first: '先に', with: '食事と一緒', after: '食後' };

// 商品オプション選択
function openOptionPicker(item, onAdd, init = {}) {
  const st = { item, sel: init.sel ? structuredClone(init.sel) : {}, qty: init.qty || 1, note: init.note || '', timing: init.timing || '' };
  for (const g of item.optionGroups || []) {
    const avail = (g.choices || []).filter((c) => !c.hidden && !isSoldOutToday(c, S.data.ctx.bizDate));
    if (!init.sel && g.type === 'single' && g.required && avail.length === 1) st.sel[g.id] = [avail[0].id];
  }
  const m = openModal({
    picker: st,
    html: () => {
      const pl = priceLine(item, st.sel, S.data.ctx.bizDate);
      let h = `<div class="modal-head"><h2>${esc(item.emoji || '')} ${esc(item.name)}</h2><span class="spacer"></span><b class="num">${yen(item.price)}</b>
        <button class="btn btn-ghost" data-act="modal-close">✕</button></div><div class="modal-body">`;
      for (const g of item.optionGroups || []) {
        const picked = st.sel[g.id] || [];
        h += `<div class="opt-group"><div class="row"><b>${esc(g.name)}</b>${g.required ? '<span class="chip chip-danger">必須</span>' : '<span class="chip">任意</span>'}</div><div class="opt-choices">`;
        for (const c of (g.choices || []).filter((x) => !x.hidden)) {
          const sold = isSoldOutToday(c, S.data.ctx.bizDate);
          h += `<button class="opt ${picked.includes(c.id) ? 'on' : ''}" data-act="pick-choice" data-g="${esc(g.id)}" data-c="${esc(c.id)}" ${sold ? 'disabled' : ''}>
            ${esc(choiceLabel(c))}${c.price ? ` <span class="small">${c.price > 0 ? '+' : ''}${yen(c.price)}</span>` : ''}${sold ? ' <span class="chip chip-danger">売切</span>' : ''}</button>`;
        }
        h += '</div></div>';
      }
      if (item.station === 'drink') {
        h += `<div class="opt-group"><b>提供タイミング</b><div class="opt-choices">${TIMING.map(([v, l]) => `<button class="opt ${st.timing === v ? 'on' : ''}" data-act="pick-timing" data-v="${v}">${l}</button>`).join('')}</div></div>`;
      }
      h += `<div class="opt-group"><b>メモ</b><input data-input="pick-note" value="${esc(st.note)}" placeholder="氷少なめ など"></div></div>
        <div class="modal-foot"><div class="stepper"><button data-act="pick-qty" data-d="-1">−</button><span>${st.qty}</span><button data-act="pick-qty" data-d="1">＋</button></div>
        <span class="spacer"></span><span class="small" style="color:var(--danger)">${pl.ok ? '' : esc(pl.error)}</span>
        <button class="btn btn-primary btn-lg" data-act="pick-add" ${pl.ok ? '' : 'disabled'}>追加 ${pl.ok ? yen(pl.unitPrice * st.qty) : ''}</button></div>`;
      return h;
    },
  });
  m.onAdd = onAdd;
}

export const pickerActions = {
  'pick-choice': (el) => {
    const m = S.modals.at(-1); const st = m.picker;
    const g = st.item.optionGroups.find((x) => x.id === el.dataset.g);
    const cur = st.sel[g.id] || [];
    const c = el.dataset.c;
    if (g.type === 'single') st.sel[g.id] = cur.includes(c) && !g.required ? [] : [c];
    else if (cur.includes(c)) st.sel[g.id] = cur.filter((x) => x !== c);
    else if (!g.max || cur.length < g.max) st.sel[g.id] = [...cur, c];
    updateModal();
  },
  'pick-timing': (el) => { S.modals.at(-1).picker.timing = el.dataset.v; updateModal(); },
  'pick-qty': (el) => { const st = S.modals.at(-1).picker; st.qty = Math.max(1, Math.min(30, st.qty + Number(el.dataset.d))); updateModal(); },
  'pick-add': () => {
    const m = S.modals.at(-1); const st = m.picker;
    closeModal(m);
    m.onAdd({ itemId: st.item.id, sel: st.sel, qty: st.qty, note: st.note.trim(), timing: st.timing });
  },
};
export const pickerInputs = {
  'pick-note': (el) => { S.modals.at(-1).picker.note = el.value; },
};

// ---- 注文入力モーダル ----
// target: { checkId } もしくは { tagNo, people, takeout }（新規受付）
export function openStaffOrder(target, { thenCheckout = false } = {}) {
  const st = { ...target, lines: [], cat: 'all', q: '', thenCheckout, sending: false, cid: uid() };
  openModal({
    size: 'wide', staffOrder: st,
    html: () => staffOrderHtml(st),
  });
}

function linePrice(l) {
  const it = itemById(l.itemId);
  const pl = it ? priceLine(it, l.sel, S.data.ctx.bizDate) : { ok: false };
  return pl.ok ? pl.unitPrice * l.qty : 0;
}
function lineLabels(l) {
  const it = itemById(l.itemId);
  const pl = it ? priceLine(it, l.sel, S.data.ctx.bizDate) : { ok: false };
  return pl.ok ? pl.options.map((o) => o.label) : [];
}

function staffOrderHtml(st) {
  const d = S.data;
  const check = st.checkId ? d.openChecks.find((c) => c.id === st.checkId) : null;
  const title = check ? `${check.tagNo == null ? 'カウンター' : `${check.tagNo}番`} に追加注文` : st.tagNo == null ? 'カウンター注文（番号札なし）' : `${st.tagNo}番 受付・注文入力`;
  const cats = d.categories;
  const q = st.q.trim();
  const items = d.items.filter((i) => !i.archived && (st.cat === 'all' || i.categoryId === st.cat) && (!q || i.name.includes(q)));
  const total = st.lines.reduce((s, l) => s + linePrice(l), 0);
  return `<div class="modal-head"><h2>${esc(title)}</h2><span class="spacer"></span>
      ${!check ? `<label class="row small">人数 <select data-change="so-people" style="width:auto">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}" ${Number(st.people) === n ? 'selected' : ''}>${n || '—'}</option>`).join('')}</select></label>
        <label class="row small"><input type="checkbox" data-change="so-takeout" ${st.takeout ? 'checked' : ''} style="width:auto"> 持ち帰り</label>` : ''}
      <button class="btn btn-ghost" data-act="modal-close">✕</button></div>
    <div class="so-body">
      <div class="so-menu">
        <div class="so-cats"><button class="pill ${st.cat === 'all' ? 'on' : ''}" data-act="so-cat" data-c="all">すべて</button>
          ${cats.map((c) => `<button class="pill ${st.cat === c.id ? 'on' : ''}" data-act="so-cat" data-c="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
          <input class="so-search" placeholder="検索" value="${esc(st.q)}" data-input="so-q"></div>
        <div class="so-grid">${items.map((i) => {
          const s = itemStatus(i, d.ctx, { staff: true });
          const left = stockLeft(i, d.ctx.bizDate);
          const sold = !s.orderable;
          return `<button class="so-item ${sold ? 'sold' : ''}" data-act="so-add" data-id="${esc(i.id)}" ${sold ? 'disabled' : ''}>
            <span class="e">${esc(i.emoji || '•')}</span><span class="n">${esc(i.name)}</span>
            <span class="p num">${yen(i.price)}</span>
            ${sold ? `<span class="chip chip-danger">${esc(s.reason)}</span>` : left != null ? `<span class="chip chip-warn">残${left}</span>` : ''}
            ${i.customerVisible === false ? '<span class="chip">店内専用</span>' : ''}</button>`;
        }).join('') || '<div class="empty">該当する商品がありません</div>'}</div>
      </div>
      <div class="so-ticket">
        <div class="so-lines">${st.lines.map((l, idx) => {
          const it = itemById(l.itemId);
          return `<div class="so-line"><div class="grow" data-act="so-edit" data-i="${idx}"><b>${esc(it?.name)}</b>
            <div class="small muted">${esc(lineLabels(l).join(' / '))}${l.timing ? ` / ${TIMING_LABEL[l.timing]}` : ''}${l.note ? ` / ${esc(l.note)}` : ''}</div>
            <div class="num small">${yen(linePrice(l))}</div></div>
            <div class="stepper sm"><button data-act="so-qty" data-i="${idx}" data-d="-1">−</button><span>${l.qty}</span><button data-act="so-qty" data-i="${idx}" data-d="1">＋</button></div></div>`;
        }).join('') || '<div class="empty small">左のメニューをタップして追加</div>'}</div>
        <div class="so-total"><span>合計</span><b class="num">${yen(total)}</b></div>
        <button class="btn btn-primary btn-lg btn-block" data-act="so-submit" data-then="0" ${st.lines.length && !st.sending ? '' : 'disabled'}>注文を確定</button>
        <button class="btn btn-lg btn-block" style="margin-top:8px" data-act="so-submit" data-then="1" ${st.lines.length && !st.sending ? '' : 'disabled'}>確定してすぐ会計</button>
      </div>
    </div>`;
}

const soState = () => S.modals.findLast((m) => m.staffOrder)?.staffOrder;

export const staffOrderActions = {
  'so-cat': (el) => { soState().cat = el.dataset.c; updateModal(); },
  'so-add': (el) => {
    const st = soState();
    const item = itemById(el.dataset.id);
    const add = (line) => {
      const k = JSON.stringify([line.itemId, line.sel, line.note, line.timing]);
      const same = st.lines.find((l) => JSON.stringify([l.itemId, l.sel, l.note, l.timing]) === k);
      if (same) same.qty += line.qty; else st.lines.push(line);
      updateModal();
    };
    if ((item.optionGroups || []).length) openOptionPicker(item, add);
    else add({ itemId: item.id, sel: {}, qty: 1, note: '', timing: '' });
  },
  'so-edit': (el) => {
    const st = soState();
    const i = Number(el.dataset.i);
    const l = st.lines[i];
    openOptionPicker(itemById(l.itemId), (nl) => { st.lines[i] = nl; updateModal(); }, l);
  },
  'so-qty': (el) => {
    const st = soState();
    const l = st.lines[Number(el.dataset.i)];
    l.qty += Number(el.dataset.d);
    if (l.qty <= 0) st.lines.splice(Number(el.dataset.i), 1);
    updateModal();
  },
  'so-submit': async (el) => {
    const st = soState();
    if (st.sending) return;
    st.sending = true; updateModal();
    const ok = await run(async () => {
      let id = st.checkId;
      if (!id) {
        const r = await api('POST', '/api/admin/checks', { tagNo: st.tagNo, people: st.people, takeout: st.takeout });
        id = r.check.id;
        st.checkId = id; // 注文送信に失敗しても伝票を二重に作らない
      }
      await api('POST', `/api/admin/checks/${id}/orders`, {
        clientOrderId: st.cid,
        lines: st.lines.map((l) => ({ itemId: l.itemId, sel: l.sel, qty: l.qty, note: l.note, timing: l.timing })),
      });
      return id;
    });
    st.sending = false;
    if (!ok) { updateModal(); return; }
    const m = S.modals.findLast((x) => x.staffOrder);
    closeModal(m);
    toast('注文を登録しました');
    await refresh();
    if (el.dataset.then === '1' || st.thenCheckout) hooks.goCheckout(ok);
  },
};
export const staffOrderInputs = {
  'so-q': (el) => {
    soState().q = el.value;
    // 検索欄のフォーカスを保ったままグリッドだけ更新
    const pos = el.selectionStart;
    updateModal();
    const ne = document.querySelector('.so-search');
    if (ne) { ne.focus(); ne.setSelectionRange(pos, pos); }
  },
};
export const staffOrderChanges = {
  'so-people': (el) => { soState().people = Number(el.value); },
  'so-takeout': (el) => { soState().takeout = el.checked; },
};
