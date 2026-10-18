// メニュー編集：カテゴリ・商品・オプション（ホット/アイス、①②③の限定枠、ドリンクセット等）
import { DOW_LABELS } from '/shared/calc.js';
import {
  S, esc, yen, api, run, refresh, toast, openModal, closeModal, updateModal, confirmDialog, promptDialog, uid,
} from './core.js';

const ALLERGENS = ['卵', '乳', '小麦', 'そば', '落花生', 'えび', 'かに', 'くるみ', '大豆', 'ごま', 'ナッツ類'];
const STATION = { drink: 'ドリンク', food: 'フード', other: 'その他' };
let catFilter = 'all';

export function renderMenu() {
  const d = S.data;
  const items = d.items.filter((i) => catFilter === 'all' || i.categoryId === catFilter);
  let h = `<div class="view-head"><h1>メニュー</h1><span class="spacer"></span>
    <button class="btn" data-act="m-cats">カテゴリを編集</button>
    <button class="btn btn-primary" data-act="m-new">＋ 商品を追加</button></div>
    <div class="row wrap" style="margin-bottom:10px"><button class="pill ${catFilter === 'all' ? 'on' : ''}" data-act="m-filter" data-c="all">すべて</button>
    ${d.categories.map((c) => `<button class="pill ${catFilter === c.id ? 'on' : ''}" data-act="m-filter" data-c="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div>
    <div class="menu-list">`;
  for (const i of items) {
    const cat = d.categories.find((c) => c.id === i.categoryId);
    const a = i.availability || {};
    const tags = [];
    if (i.customerVisible === false) tags.push('<span class="chip">店内専用</span>');
    if (i.daily) tags.push('<span class="chip chip-warn">日替わり</span>');
    if (i.ticketEligible) tags.push('<span class="chip">🎫 チケット可</span>');
    if (a.from || a.to) tags.push(`<span class="chip">${esc(a.from || '')}〜${esc(a.to || '')}</span>`);
    if (a.days?.length) tags.push(`<span class="chip">${a.days.map((x) => DOW_LABELS[x]).join('')}曜</span>`);
    if (a.startDate || a.endDate) tags.push(`<span class="chip">${esc((a.startDate || '').slice(5))}〜${esc((a.endDate || '').slice(5))}</span>`);
    if (i.archived) tags.push('<span class="chip chip-danger">取扱終了</span>');
    h += `<div class="card menu-row ${i.archived ? 'dim' : ''}">
      <div class="mthumb">${i.image ? `<img src="${esc(i.image)}" alt="">` : esc(i.emoji || '•')}</div>
      <div class="grow" data-act="m-edit" data-id="${i.id}"><b>${esc(i.name)}</b> <span class="num muted">${yen(i.price)}</span>
        <div class="small muted">${esc(cat?.name || '')} · ${STATION[i.station] || ''}${(i.optionGroups || []).length ? ` · オプション ${i.optionGroups.map((g) => esc(g.name)).join('、')}` : ''}</div>
        <div class="row wrap" style="gap:4px">${tags.join('')}</div></div>
      <div class="col-btns"><button class="btn btn-sm" data-act="m-move" data-id="${i.id}" data-d="-1">↑</button><button class="btn btn-sm" data-act="m-move" data-id="${i.id}" data-d="1">↓</button></div>
      <button class="btn" data-act="m-edit" data-id="${i.id}">編集</button></div>`;
  }
  h += '</div>';
  return h;
}

// ---- 商品編集 ----
function blankItem() {
  return {
    name: '', price: 0, emoji: '☕', categoryId: catFilter !== 'all' ? catFilter : S.data.categories[0]?.id, description: '', station: 'drink',
    ticketEligible: false, customerVisible: true, recommended: false, daily: false, allergens: [], image: '',
    availability: { days: [], from: '', to: '', startDate: '', endDate: '' }, optionGroups: [],
  };
}

const PRESETS = {
  hotice: () => ({ id: `g${uid()}`, name: 'ホット / アイス', type: 'single', required: true, hint: '', choices: [{ id: 'hot', label: 'ホット', price: 0 }, { id: 'ice', label: 'アイス', price: 0 }] }),
  size: () => ({ id: `g${uid()}`, name: 'サイズ', type: 'single', required: false, hint: '', choices: [{ id: `c${uid()}`, label: '大盛り', price: 150 }] }),
  slots: () => ({
    id: `g${uid()}`, name: 'フレーバー', type: 'single', required: true, hint: '期間限定①〜③は店内の黒板をご覧ください',
    choices: [{ id: `c${uid()}`, label: 'プレーン', price: 0 }, ...['①', '②', '③'].map((n) => ({ id: `c${uid()}`, label: `期間限定${n}`, slot: true, detail: '', price: 0 }))],
  }),
  daily: () => ({
    id: `g${uid()}`, name: '種類', type: 'single', required: true, hint: '日替わりの味は黒板をご覧ください',
    choices: [{ id: `c${uid()}`, label: 'プレーン', price: 0 }, { id: `c${uid()}`, label: '日替わり', slot: true, detail: '', price: 0 }],
  }),
  set: () => ({
    id: `g${uid()}`, name: 'ドリンクセット', type: 'single', required: false, hint: '',
    choices: [['ブレンド（ホット）', 300], ['ブレンド（アイス）', 300], ['カフェラテ', 400], ['紅茶', 300]].map(([label, price]) => ({ id: `c${uid()}`, label, price })),
  }),
  topping: () => ({ id: `g${uid()}`, name: 'トッピング', type: 'multi', required: false, max: 3, hint: '', choices: [{ id: `c${uid()}`, label: 'バニラアイス', price: 150 }, { id: `c${uid()}`, label: '生クリーム', price: 100 }] }),
  blank: () => ({ id: `g${uid()}`, name: '', type: 'single', required: false, hint: '', choices: [{ id: `c${uid()}`, label: '', price: 0 }] }),
};

function openEditor(item) {
  const draft = structuredClone(item);
  draft.availability ||= { days: [], from: '', to: '', startDate: '', endDate: '' };
  draft.availability.days ||= [];
  draft.optionGroups ||= [];
  draft.allergens ||= [];
  openModal({ size: 'wide', draft, isNew: !item.id, html: () => editorHtml(draft, !item.id) });
}

const chk = (path, val, label) => `<label class="check"><input type="checkbox" data-path="${path}" data-type="bool" ${val ? 'checked' : ''}> ${label}</label>`;

function editorHtml(d, isNew) {
  const cats = S.data.categories;
  const a = d.availability;
  let h = `<div class="modal-head"><h2>${isNew ? '商品を追加' : '商品を編集'}</h2><span class="spacer"></span><button class="btn btn-ghost" data-act="modal-close">✕</button></div>
  <div class="modal-body editor">
    <div class="ed-grid">
      <div class="ed-img"><div class="mthumb lg">${d.image ? `<img src="${esc(d.image)}" alt="">` : esc(d.emoji || '•')}</div>
        <label class="btn btn-sm">写真を選ぶ<input type="file" accept="image/*" data-upload="1" hidden></label>
        ${d.image ? '<button class="btn btn-sm btn-ghost" data-act="ed-img-del">写真を外す</button>' : ''}
        <label class="small">絵文字<input data-path="emoji" value="${esc(d.emoji)}" maxlength="4"></label></div>
      <div class="ed-fields">
        <label>商品名<input data-path="name" value="${esc(d.name)}" placeholder="例：バスクチーズケーキ"></label>
        <div class="grid3"><label>価格（税込）<input type="number" inputmode="numeric" data-path="price" data-type="num" value="${d.price}"></label>
          <label>カテゴリ<select data-path="categoryId">${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === d.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label>作る場所<select data-path="station">${Object.entries(STATION).map(([k, v]) => `<option value="${k}" ${d.station === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
        <label>説明<textarea data-path="description" rows="2">${esc(d.description)}</textarea></label>
        <div class="row wrap">${chk('customerVisible', d.customerVisible !== false, 'お客様のメニューに表示')}${chk('recommended', d.recommended, 'おすすめ')}
          ${chk('daily', d.daily, '毎日内容が変わる（本日の準備に表示）')}${chk('ticketEligible', d.ticketEligible, `${esc(S.data.settings.ticket.name)}が使える`)}</div>
      </div></div>

    <h3 class="ed-h">提供する日・時間</h3>
    <div class="row wrap">${DOW_LABELS.map((l, i) => `<button class="pill ${a.days.includes(i) ? 'on' : ''}" data-act="ed-day" data-d="${i}">${l}</button>`).join('')}
      <span class="small muted">${a.days.length ? '選んだ曜日のみ' : '毎日（曜日指定なし）'}</span></div>
    <div class="grid4" style="margin-top:8px"><label>開始時刻<input type="time" data-path="availability.from" value="${esc(a.from)}"></label>
      <label>終了時刻<input type="time" data-path="availability.to" value="${esc(a.to)}"></label>
      <label>期間 開始日<input type="date" data-path="availability.startDate" value="${esc(a.startDate)}"></label>
      <label>期間 終了日<input type="date" data-path="availability.endDate" value="${esc(a.endDate)}"></label></div>
    <div class="small muted">例：モーニングは 07:00〜11:00 / 季節限定は期間を指定。終了後は自動でメニューから消えます。</div>

    <h3 class="ed-h">オプション・選択肢</h3>
    <div class="row wrap small">追加：
      <button class="pill" data-act="ed-preset" data-p="hotice">ホット/アイス</button>
      <button class="pill" data-act="ed-preset" data-p="daily">プレーン/日替わり</button>
      <button class="pill" data-act="ed-preset" data-p="slots">期間限定①②③の枠</button>
      <button class="pill" data-act="ed-preset" data-p="set">ドリンクセット</button>
      <button class="pill" data-act="ed-preset" data-p="size">サイズ</button>
      <button class="pill" data-act="ed-preset" data-p="topping">トッピング（複数可）</button>
      <button class="pill" data-act="ed-preset" data-p="blank">空の項目</button></div>`;

  d.optionGroups.forEach((g, gi) => {
    const p = `optionGroups.${gi}`;
    h += `<div class="og card">
      <div class="grid4"><label>項目名<input data-path="${p}.name" value="${esc(g.name)}" placeholder="例：フレーバー"></label>
        <label>選び方<select data-path="${p}.type"><option value="single" ${g.type === 'single' ? 'selected' : ''}>1つ選ぶ</option><option value="multi" ${g.type === 'multi' ? 'selected' : ''}>複数選べる</option></select></label>
        ${g.type === 'multi' ? `<label>最大数（0=制限なし）<input type="number" data-path="${p}.max" data-type="num" value="${g.max || 0}"></label>` : '<span></span>'}
        <div class="row" style="align-items:flex-end;gap:6px">${chk(`${p}.required`, g.required, '必須')}
          <button class="btn btn-sm" data-act="ed-g-move" data-g="${gi}" data-d="-1">↑</button><button class="btn btn-sm btn-danger" data-act="ed-g-del" data-g="${gi}">削除</button></div></div>
      <label class="small">お客様への案内（任意）<input data-path="${p}.hint" value="${esc(g.hint || '')}" placeholder="例：期間限定は店内の黒板をご覧ください"></label>
      <table class="ch-table"><thead><tr><th>選択肢名</th><th>中身（黒板の内容）</th><th>追加料金</th><th>黒板枠</th><th>非表示</th><th></th></tr></thead><tbody>
      ${g.choices.map((c, ci) => `<tr>
        <td><input data-path="${p}.choices.${ci}.label" value="${esc(c.label)}" placeholder="例：期間限定①"></td>
        <td>${c.slot ? `<input data-path="${p}.choices.${ci}.detail" value="${esc(c.detail || '')}" placeholder="本日の準備でも変更可">
          <input data-path="${p}.choices.${ci}.slotKey" value="${esc(c.slotKey || '')}" placeholder="🔗 連動キー（任意）" class="small" style="margin-top:4px">` : '<span class="small muted">—</span>'}</td>
        <td><input type="number" data-path="${p}.choices.${ci}.price" data-type="num" value="${c.price || 0}" style="width:90px"></td>
        <td><input type="checkbox" data-path="${p}.choices.${ci}.slot" data-type="bool" data-rerender="1" ${c.slot ? 'checked' : ''}></td>
        <td><input type="checkbox" data-path="${p}.choices.${ci}.hidden" data-type="bool" ${c.hidden ? 'checked' : ''}></td>
        <td><button class="btn btn-sm btn-ghost" data-act="ed-c-del" data-g="${gi}" data-c="${ci}">✕</button></td></tr>`).join('')}
      </tbody></table>
      <button class="btn btn-sm" data-act="ed-c-add" data-g="${gi}">＋ 選択肢を追加</button></div>`;
  });
  if (!d.optionGroups.length) h += '<div class="small muted" style="margin:8px 0">オプションなし（タップするとすぐカートに入ります）</div>';
  h += `<div class="small muted">「黒板枠」にチェックした選択肢は、毎日「本日の準備」で中身（例：栗・かぼちゃ）を入れられます。空欄の時はお客様に「黒板をご覧ください」と表示されます。<br>「連動キー」に同じ言葉（例：日替わりスコーン）を入れた枠どうしは、1か所の入力・売り切れでまとめて更新されます。</div>

    <h3 class="ed-h">アレルギー表示</h3>
    <div class="row wrap">${ALLERGENS.map((x) => `<button class="pill ${d.allergens.includes(x) ? 'on' : ''}" data-act="ed-allergen" data-v="${x}">${x}</button>`).join('')}</div>
  </div>
  <div class="modal-foot">${isNew ? '' : `<button class="btn btn-danger" data-act="ed-delete">削除</button>
    <button class="btn" data-act="ed-archive">${d.archived ? '取扱を再開' : '取扱終了にする'}</button><button class="btn" data-act="ed-dup">複製</button>`}
    <span class="spacer"></span><button class="btn" data-act="modal-close">キャンセル</button><button class="btn btn-primary btn-lg" data-act="ed-save">保存</button></div>`;
  return h;
}

const ed = () => S.modals.findLast((m) => m.draft);

function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (const k of ks.slice(0, -1)) o = o[k];
  o[ks.at(-1)] = val;
}

// 画像を縮小してからアップロード
async function uploadImage(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const max = 900;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  const r = await api('POST', '/api/admin/upload', { dataUrl: cv.toDataURL('image/jpeg', 0.82) });
  return r.url;
}

export function menuInput(el) {
  const m = ed();
  if (!m || !el.dataset.path) return false;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.type === 'num') v = Number(v) || 0;
  setPath(m.draft, el.dataset.path, v);
  if (el.dataset.rerender || el.tagName === 'SELECT' || el.type === 'checkbox') updateModal();
  return true;
}
export async function menuUpload(el) {
  const m = ed();
  const f = el.files?.[0];
  if (!m || !f) return;
  const url = await run(() => uploadImage(f));
  if (url) { m.draft.image = url; updateModal(); }
}

export const menuActions = {
  'm-filter': (el, ev, rerender) => { catFilter = el.dataset.c; rerender(); },
  'm-new': () => openEditor(blankItem()),
  'm-edit': (el) => openEditor(S.data.items.find((i) => i.id === el.dataset.id)),
  'm-move': async (el) => {
    const ids = S.data.items.map((i) => i.id);
    const i = ids.indexOf(el.dataset.id);
    const visible = S.data.items.filter((x) => catFilter === 'all' || x.categoryId === catFilter).map((x) => x.id);
    const vi = visible.indexOf(el.dataset.id);
    const other = visible[vi + Number(el.dataset.d)];
    if (!other) return;
    const j = ids.indexOf(other);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await run(async () => { await api('POST', '/api/admin/items/reorder', { ids }); await refresh(); });
  },
  'ed-day': (el) => {
    const a = ed().draft.availability; const dnum = Number(el.dataset.d);
    a.days = a.days.includes(dnum) ? a.days.filter((x) => x !== dnum) : [...a.days, dnum].sort();
    updateModal();
  },
  'ed-preset': (el) => { ed().draft.optionGroups.push(PRESETS[el.dataset.p]()); updateModal(); },
  'ed-g-del': (el) => { ed().draft.optionGroups.splice(Number(el.dataset.g), 1); updateModal(); },
  'ed-g-move': (el) => {
    const gs = ed().draft.optionGroups; const i = Number(el.dataset.g);
    if (i > 0) [gs[i - 1], gs[i]] = [gs[i], gs[i - 1]];
    updateModal();
  },
  'ed-c-add': (el) => { ed().draft.optionGroups[Number(el.dataset.g)].choices.push({ id: `c${uid()}`, label: '', price: 0 }); updateModal(); },
  'ed-c-del': (el) => { ed().draft.optionGroups[Number(el.dataset.g)].choices.splice(Number(el.dataset.c), 1); updateModal(); },
  'ed-allergen': (el) => {
    const d = ed().draft; const v = el.dataset.v;
    d.allergens = d.allergens.includes(v) ? d.allergens.filter((x) => x !== v) : [...d.allergens, v];
    updateModal();
  },
  'ed-img-del': () => { ed().draft.image = ''; updateModal(); },
  'ed-save': async () => {
    const m = ed(); const d = m.draft;
    if (!d.name.trim()) { toast('商品名を入力してください', 'error'); return; }
    for (const g of d.optionGroups) g.choices = g.choices.filter((c) => c.label.trim());
    const ok = await run(() => (d.id ? api('PUT', `/api/admin/items/${d.id}`, d) : api('POST', '/api/admin/items', d)));
    if (!ok) return;
    closeModal(m); toast('保存しました'); await refresh();
  },
  'ed-dup': async () => {
    const d = structuredClone(ed().draft);
    delete d.id; d.name = `${d.name}（コピー）`;
    closeModal(ed());
    openEditor(d);
  },
  'ed-archive': () => { const d = ed().draft; d.archived = !d.archived; updateModal(); },
  'ed-delete': async () => {
    const d = ed().draft;
    if (!(await confirmDialog(`「${d.name}」を削除しますか？\n売上履歴は残ります。一時的に出さないだけなら「取扱終了」が便利です。`, { ok: '削除', danger: true }))) return;
    await run(async () => { await api('DELETE', `/api/admin/items/${d.id}`); closeModal(ed()); await refresh(); });
  },

  // ---- カテゴリ ----
  'm-cats': () => {
    const st = { cats: structuredClone(S.data.categories) };
    openModal({
      cats: st,
      html: () => `<div class="modal-head"><h2>カテゴリ</h2><span class="spacer"></span><button class="btn btn-ghost" data-act="modal-close">✕</button></div>
        <div class="modal-body">${st.cats.map((c, i) => `<div class="row" style="margin-bottom:6px"><input data-cat="${i}" value="${esc(c.name)}">
          <button class="btn btn-sm" data-act="cat-move" data-i="${i}">↑</button><button class="btn btn-sm btn-danger" data-act="cat-del" data-i="${i}">削除</button></div>`).join('')}
          <button class="btn btn-sm" data-act="cat-add">＋ カテゴリを追加</button>
          <p class="small muted">カテゴリを削除すると、その商品は先頭のカテゴリへ移ります。</p></div>
        <div class="modal-foot"><span class="spacer"></span><button class="btn btn-primary btn-lg" data-act="cat-save">保存</button></div>`,
    });
  },
  'cat-add': async () => {
    const name = await promptDialog('カテゴリ名', { placeholder: '例：季節のおすすめ' });
    if (!name) return;
    S.modals.findLast((m) => m.cats).cats.cats.push({ id: `cat${uid()}`, name });
    updateModal();
  },
  'cat-move': (el) => { const cs = S.modals.at(-1).cats.cats; const i = Number(el.dataset.i); if (i > 0) [cs[i - 1], cs[i]] = [cs[i], cs[i - 1]]; updateModal(); },
  'cat-del': (el) => { S.modals.at(-1).cats.cats.splice(Number(el.dataset.i), 1); updateModal(); },
  'cat-save': async () => {
    const m = S.modals.findLast((x) => x.cats);
    const ok = await run(() => api('PUT', '/api/admin/categories', { categories: m.cats.cats }));
    if (ok) { closeModal(m); await refresh(); }
  },
};
export function catInput(el) {
  const m = S.modals.findLast((x) => x.cats);
  if (!m || el.dataset.cat == null) return false;
  m.cats.cats[Number(el.dataset.cat)].name = el.value;
  return true;
}
