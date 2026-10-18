// 本日の準備：朝の数分で終わるように、日替わり・期間限定の中身／売り切れ／残数／受付状態をこの1画面に集約
import { itemStatus, stockLeft, isSoldOutToday } from '../shared/calc.js';
import { S, esc, yen, api, run, refresh, toast, localStorageGet, localStorageSet } from './core.js';

let filter = localStorageGet('cafe_today_filter', 'daily');

export function renderToday() {
  const d = S.data;
  const s = d.settings;
  const biz = d.ctx.bizDate;
  const items = d.items.filter((i) => !i.archived);
  const daily = items.filter((i) => i.daily);
  const stale = items.flatMap((i) => (i.optionGroups || []).flatMap((g) => g.choices.filter((c) => c.slot && !c.hidden && c.detailDate !== biz)));

  let h = `<div class="view-head"><h1>本日の準備</h1><span class="chip">${biz.replace(/-/g, '/')}（営業日）</span><span class="spacer"></span></div>
  <div class="today-top">
    <div class="card pad"><div class="row"><b class="grow">お客様のスマホ注文</b>
      <button class="switch ${s.orderingPaused ? '' : 'on'}" data-act="t-pause">${s.orderingPaused ? '停止中' : '受付中'}</button></div>
      <div class="small muted">混雑時は一時停止できます。停止中もスタッフ入力は可能です。</div>
      <input data-setting="pauseMessage" value="${esc(s.pauseMessage)}" placeholder="停止中にお客様へ表示する文" style="margin-top:8px"></div>
    <div class="card pad"><b>お客様へのお知らせ</b><div class="small muted">メニュー画面の上に表示されます</div>
      <textarea data-setting="notice" rows="2" placeholder="例：本日のスコーンは売り切れ次第終了です">${esc(s.notice)}</textarea></div>
    <div class="card pad"><b>ラストオーダー</b><div class="small muted">この時刻を過ぎるとスマホ注文を締め切ります</div>
      <input type="time" data-setting="lastOrder" value="${esc(s.lastOrder)}" style="margin-top:8px"></div>
  </div>`;

  if (stale.length) {
    h += `<div class="warnbox" style="margin:12px 0">✏️ 日替わり・期間限定の中身が今日まだ更新されていない枠が ${stale.length} 件あります（空欄のままでも「黒板をご覧ください」と表示されます）</div>`;
  }

  h += `<div class="seg-tabs" style="margin:10px 0"><button class="${filter === 'daily' ? 'on' : ''}" data-act="t-filter" data-f="daily">日替わり・限定 (${daily.length})</button>
    <button class="${filter === 'all' ? 'on' : ''}" data-act="t-filter" data-f="all">すべての商品</button>
    <button class="${filter === 'sold' ? 'on' : ''}" data-act="t-filter" data-f="sold">売り切れ・休み中</button></div>`;

  const show = filter === 'daily' ? daily : filter === 'sold' ? items.filter((i) => isSoldOutToday(i, biz) || i.offDate === biz || stockLeft(i, biz) === 0 || (i.optionGroups || []).some((g) => g.choices.some((c) => isSoldOutToday(c, biz)))) : items;
  if (!show.length) {
    h += `<div class="empty">${filter === 'daily' ? '「日替わり」に設定された商品はありません。メニュー編集で「毎日内容が変わる」をオンにするとここに並びます。' : '該当する商品はありません'}</div>`;
  }
  h += '<div class="today-list">';
  for (const cat of d.categories) {
    const list = show.filter((i) => i.categoryId === cat.id);
    if (!list.length) continue;
    h += `<div class="today-cat">${esc(cat.name)}</div>`;
    for (const i of list) h += todayRow(i, d);
  }
  h += '</div>';
  return h;
}

function todayRow(i, d) {
  const biz = d.ctx.bizDate;
  const st = itemStatus(i, d.ctx);
  const sold = isSoldOutToday(i, biz);
  const off = i.offDate === biz;
  const left = stockLeft(i, biz);
  let h = `<div class="card today-item ${sold || off || left === 0 ? 'dim' : ''}">
    <div class="row wrap"><span class="e">${esc(i.emoji || '•')}</span><b class="grow">${esc(i.name)} <span class="muted small num">${yen(i.price)}</span></b>
      ${!st.orderable && !sold && !off ? `<span class="chip">${esc(st.reason)}</span>` : ''}
      <button class="tog ${i.recommended ? 'on' : ''}" data-act="t-item" data-id="${i.id}" data-f="recommended">おすすめ</button>
      <button class="tog danger ${sold ? 'on' : ''}" data-act="t-item" data-id="${i.id}" data-f="soldOut">売り切れ</button>
      <button class="tog ${off ? 'on' : ''}" data-act="t-item" data-id="${i.id}" data-f="offToday">本日休み</button>
      <label class="stock">残数<input type="number" inputmode="numeric" min="0" data-stock="${i.id}" value="${left ?? ''}" placeholder="—"></label></div>`;
  for (const g of i.optionGroups || []) {
    const choices = g.choices || [];
    if (!choices.length) continue;
    h += `<div class="slot-group"><div class="small muted">${esc(g.name)}</div><div class="slots">`;
    for (const c of choices) {
      const csold = isSoldOutToday(c, biz);
      const updated = c.detailDate === biz;
      h += `<div class="slot ${c.hidden ? 'hidden-slot' : ''} ${csold ? 'sold' : ''}">
        <span class="slot-label">${esc(c.label)}${c.slotKey ? `<br><span class="chip" title="同じ連動キーの枠はまとめて更新されます">🔗 ${esc(c.slotKey)}</span>` : ''}</span>
        ${c.slot ? `<input class="slot-input ${updated ? 'fresh' : ''}" data-detail="${i.id}|${g.id}|${c.id}" value="${esc(c.detail || '')}" placeholder="中身（黒板と同じ名前）">` : '<span class="grow"></span>'}
        ${c.price ? `<span class="small num muted">${c.price > 0 ? '+' : ''}${yen(c.price)}</span>` : ''}
        <button class="tog sm danger ${csold ? 'on' : ''}" data-act="t-choice" data-id="${i.id}" data-g="${g.id}" data-c="${c.id}" data-f="soldOut">売切</button>
        <button class="tog sm ${c.hidden ? 'on' : ''}" data-act="t-choice" data-id="${i.id}" data-g="${g.id}" data-c="${c.id}" data-f="hidden">${c.hidden ? '非表示' : '表示中'}</button></div>`;
    }
    h += '</div></div>';
  }
  h += '</div>';
  return h;
}

async function patchItem(id, body) {
  await run(async () => { await api('PATCH', `/api/admin/items/${id}`, body); await refresh(); });
}
async function saveSetting(k, v) {
  await run(async () => { await api('PUT', '/api/admin/settings', { [k]: v }); await refresh(); toast('保存しました'); });
}

export const todayActions = {
  't-pause': () => saveSetting('orderingPaused', !S.data.settings.orderingPaused),
  't-filter': (el, ev, rerender) => { filter = el.dataset.f; localStorageSet('cafe_today_filter', filter); rerender(); },
  't-item': (el) => {
    const i = S.data.items.find((x) => x.id === el.dataset.id);
    const biz = S.data.ctx.bizDate;
    const f = el.dataset.f;
    const cur = f === 'soldOut' ? isSoldOutToday(i, biz) : f === 'offToday' ? i.offDate === biz : !!i[f];
    patchItem(i.id, { [f]: !cur });
  },
  't-choice': (el) => {
    const i = S.data.items.find((x) => x.id === el.dataset.id);
    const c = i.optionGroups.find((g) => g.id === el.dataset.g).choices.find((x) => x.id === el.dataset.c);
    const f = el.dataset.f;
    const cur = f === 'soldOut' ? isSoldOutToday(c, S.data.ctx.bizDate) : !!c.hidden;
    patchItem(i.id, { choice: { groupId: el.dataset.g, choiceId: c.id, [f]: !cur } });
  },
};

// 入力欄は確定（フォーカスが外れた／Enter）時に保存
export function todayChange(el) {
  if (el.dataset.setting) { saveSetting(el.dataset.setting, el.value); return true; }
  if (el.dataset.stock) { patchItem(el.dataset.stock, { stock: el.value === '' ? null : Number(el.value) }); return true; }
  if (el.dataset.detail) {
    const [id, groupId, choiceId] = el.dataset.detail.split('|');
    patchItem(id, { choice: { groupId, choiceId, detail: el.value } });
    return true;
  }
  return false;
}
