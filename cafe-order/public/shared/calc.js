// サーバーとブラウザの両方で使う純粋なロジック（料金計算・チケット・割り勘・提供可否）。
// 金額はすべて「税込・円・整数」で扱う。

export const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export function yen(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-¥' : '¥') + Math.abs(v).toLocaleString('ja-JP');
}

// ---- 日付・営業日 ---------------------------------------------------------

// 指定タイムゾーンでの現在日時の各要素を返す（サーバーがUTCで動いていても日本時間で判定するため）
export function zonedParts(date, timeZone = 'Asia/Tokyo') {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, hh: Number(p.hour), mm: Number(p.minute), dow };
}

function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// 営業日の日付。startHour(例:4)より前の深夜は前日の営業日として扱う
export function businessContext(now = new Date(), timeZone = 'Asia/Tokyo', startHour = 4) {
  const p = zonedParts(now, timeZone);
  let bizDate = p.date;
  let dow = p.dow;
  if (p.hh < startHour) {
    bizDate = addDays(p.date, -1);
    dow = (dow + 6) % 7;
  }
  const hhmm = `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
  return { bizDate, dow, hhmm };
}

// ---- 提供可否 -------------------------------------------------------------

export function isSoldOutToday(obj, bizDate) {
  return !!obj && obj.soldOutDate === bizDate;
}

// 本日の残数。null = 数量管理なし
export function stockLeft(item, bizDate) {
  if (!item.stock || item.stock.date !== bizDate || item.stock.qty == null) return null;
  return Math.max(0, Number(item.stock.qty) || 0);
}

function inTimeRange(hhmm, from, to) {
  if (!from && !to) return true;
  if (from && hhmm < from) return false;
  if (to && hhmm >= to) return false;
  return true;
}

// お客様メニューに出すか・注文できるか
// 戻り値: { show: 表示するか, orderable: 注文可, reason: 注文できない理由 }
export function itemStatus(item, ctx, { staff = false } = {}) {
  if (item.archived) return { show: false, orderable: false, reason: '取扱終了' };
  if (!staff && item.customerVisible === false) return { show: false, orderable: false, reason: 'スタッフ専用' };
  if (item.offDate === ctx.bizDate) return { show: staff, orderable: staff, reason: '本日はお休み' };
  const a = item.availability || {};
  if (a.startDate && ctx.bizDate < a.startDate) return { show: staff, orderable: staff, reason: `${a.startDate.slice(5).replace('-', '/')}から` };
  if (a.endDate && ctx.bizDate > a.endDate) return { show: staff, orderable: staff, reason: '期間終了' };
  if (Array.isArray(a.days) && a.days.length && !a.days.includes(ctx.dow)) {
    return { show: staff, orderable: staff, reason: `${a.days.map((d) => DOW_LABELS[d]).join('・')}曜限定` };
  }
  if (isSoldOutToday(item, ctx.bizDate) || stockLeft(item, ctx.bizDate) === 0) {
    return { show: true, orderable: false, reason: '売り切れ' };
  }
  if (!inTimeRange(ctx.hhmm, a.from, a.to)) {
    const label = a.from && a.to ? `${a.from}〜${a.to}` : a.from ? `${a.from}〜` : `〜${a.to}`;
    return { show: true, orderable: staff, reason: `${label}のご提供` };
  }
  return { show: true, orderable: true, reason: '' };
}

export function choiceLabel(choice) {
  return choice.detail ? `${choice.label} ${choice.detail}` : choice.label;
}

// ---- 1品の価格 -------------------------------------------------------------

// sel: { [groupId]: [choiceId, ...] }
// 戻り値: { ok, error, unitPrice, options:[{groupId, group, choiceId, label, price}] }
export function priceLine(item, sel = {}, bizDate = '') {
  let unit = Number(item.price) || 0;
  const options = [];
  for (const g of item.optionGroups || []) {
    const raw = Array.isArray(sel[g.id]) ? sel[g.id] : sel[g.id] ? [sel[g.id]] : [];
    const picked = [...new Set(raw)];
    const valid = (g.choices || []).filter((c) => !c.hidden);
    if (g.type === 'single' && picked.length > 1) return { ok: false, error: `「${g.name}」は1つだけ選べます` };
    if (g.required && picked.length === 0) return { ok: false, error: `「${g.name}」を選んでください` };
    if (g.type === 'multi' && g.min && picked.length > 0 && picked.length < g.min) return { ok: false, error: `「${g.name}」は${g.min}つ選んでください` };
    if (g.type === 'multi' && g.max && picked.length > g.max) return { ok: false, error: `「${g.name}」は${g.max}つまでです` };
    for (const cid of picked) {
      const c = valid.find((x) => x.id === cid);
      if (!c) return { ok: false, error: `「${g.name}」の選択肢が見つかりません` };
      if (isSoldOutToday(c, bizDate)) return { ok: false, error: `${choiceLabel(c)} は売り切れました` };
      const price = Number(c.price) || 0;
      unit += price;
      options.push({ groupId: g.id, group: g.name, choiceId: c.id, label: choiceLabel(c), price });
    }
  }
  return { ok: true, unitPrice: unit, options };
}

// ---- 会計計算 -------------------------------------------------------------

export function activeLines(check) {
  const out = [];
  for (const o of check.orders || []) {
    for (const l of o.lines || []) {
      if (l.status !== 'cancelled') out.push(l);
    }
  }
  return out;
}

export function lineGross(l) {
  return l.comp ? 0 : (Number(l.unitPrice) || 0) * (Number(l.qty) || 0);
}

// チケット適用対象の単位（1杯ずつ）
export function ticketCandidates(check) {
  const units = [];
  for (const l of activeLines(check)) {
    if (!l.ticketEligible || l.comp) continue;
    for (let i = 0; i < l.qty; i++) units.push({ lineId: l.id, unitPrice: l.unitPrice });
  }
  // 高い順に充てる（お客様の得になる順）
  units.sort((a, b) => b.unitPrice - a.unitPrice);
  return units;
}

export function computeTotals(check, settings = {}) {
  const lines = activeLines(check);
  const subtotal = lines.reduce((s, l) => s + lineGross(l), 0);

  // コーヒーチケット：1枚につき対象商品1点を (チケット額 と 単価 の小さい方) 値引き。差額はお客様負担
  const tvalue = Number(settings.ticket?.value) || 0;
  const units = ticketCandidates(check);
  const tickets = Math.max(0, Math.min(Number(check.tickets) || 0, units.length));
  const ticketByLine = {};
  let ticketDiscount = 0;
  for (let i = 0; i < tickets; i++) {
    const u = units[i];
    const amt = Math.min(tvalue, u.unitPrice);
    ticketByLine[u.lineId] = (ticketByLine[u.lineId] || 0) + amt;
    ticketDiscount += amt;
  }

  // 割引（％ / 円）。チケット適用後の金額に順番に適用
  let base = subtotal - ticketDiscount;
  const discounts = [];
  for (const d of check.discounts || []) {
    let amount = d.type === 'percent' ? Math.floor((base * (Number(d.value) || 0)) / 100) : Number(d.value) || 0;
    amount = Math.max(0, Math.min(amount, base));
    base -= amount;
    discounts.push({ ...d, amount });
  }
  const discountTotal = discounts.reduce((s, d) => s + d.amount, 0);
  const total = Math.max(0, subtotal - ticketDiscount - discountTotal);

  const rate = check.takeout ? Number(settings.takeoutTaxRate ?? 8) : Number(settings.taxRate ?? 10);
  const tax = Math.floor((total * rate) / (100 + rate));

  const paid = (check.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const remaining = total - paid;

  return {
    subtotal, tickets, ticketMax: units.length, ticketDiscount, ticketByLine,
    discounts, discountTotal, total, taxRate: rate, tax, paid, remaining,
    itemCount: lines.reduce((s, l) => s + l.qty, 0),
  };
}

// 個別会計用：各明細の「最終的な支払額」（チケット・割引を按分済み。合計は total と一致）
export function lineNetAmounts(check, settings = {}) {
  const t = computeTotals(check, settings);
  const lines = activeLines(check);
  const net1 = lines.map((l) => ({ id: l.id, v: lineGross(l) - (t.ticketByLine[l.id] || 0) }));
  const sum = net1.reduce((s, x) => s + x.v, 0);
  const out = {};
  if (sum <= 0) {
    for (const x of net1) out[x.id] = 0;
    return out;
  }
  let allocated = 0;
  const allocs = net1.map((x) => {
    const a = Math.floor((t.discountTotal * x.v) / sum);
    allocated += a;
    return { ...x, a };
  });
  // 端数は金額の大きい明細から1円ずつ
  let rest = t.discountTotal - allocated;
  const order = [...allocs].sort((a, b) => b.v - a.v);
  for (let i = 0; rest > 0 && order.length; i = (i + 1) % order.length) {
    if (order[i].v - order[i].a > 0) { order[i].a += 1; rest -= 1; }
  }
  for (const x of allocs) out[x.id] = x.v - x.a;
  return out;
}

// 均等割り。unit=10 や 100 で端数を切り捨て、端数分は1人目（幹事）が払う
export function splitEqual(amount, n, unit = 1) {
  n = Math.max(1, Math.floor(n));
  unit = Math.max(1, Math.floor(unit));
  const per = Math.floor(amount / n / unit) * unit;
  const shares = Array(n).fill(per);
  let rest = amount - per * n;
  if (unit === 1) {
    for (let i = 0; rest > 0; i++, rest--) shares[i] += 1;
  } else {
    shares[0] += rest;
  }
  return shares;
}

// 個別会計。assign: { lineId: ['Aさん','Bさん'] }（複数人ならシェアして等分）
// 戻り値: { people: {name: amount}, unassigned: amount }
export function splitByItems(check, settings, people, assign = {}) {
  const net = lineNetAmounts(check, settings);
  const res = Object.fromEntries(people.map((p) => [p, 0]));
  let unassigned = 0;
  for (const l of activeLines(check)) {
    const who = (assign[l.id] || []).filter((p) => p in res);
    const v = net[l.id] || 0;
    if (!who.length) { unassigned += v; continue; }
    const shares = splitEqual(v, who.length, 1);
    who.forEach((p, i) => { res[p] += shares[i]; });
  }
  return { people: res, unassigned };
}

// 支払いを split の各枠に紐付けた時の支払済額
export function paidByLabel(check) {
  const out = {};
  for (const p of check.payments || []) {
    if (!p.label) continue;
    out[p.label] = (out[p.label] || 0) + (Number(p.amount) || 0);
  }
  return out;
}

// 未提供の明細数
export function unservedCount(check) {
  return activeLines(check).filter((l) => l.status !== 'served').reduce((s, l) => s + l.qty, 0);
}
