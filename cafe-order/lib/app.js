// HTTPサーバー本体（APIと画面配信）。外部フレームワークに依存しない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { newId, newTagKey, randomToken } from './base-store.js';
import {
  businessContext, itemStatus, priceLine, computeTotals, activeLines, isSoldOutToday, stockLeft, unservedCount, yen,
} from '../public/shared/calc.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const fail = (status, message, code) => { throw new HttpError(status, message, code); };

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const int = (v, def = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : def);
const clampInt = (v, min, max, def = min) => Math.max(min, Math.min(max, int(v, def)));
const hhmmOk = (v) => (v === '' || /^\d{2}:\d{2}$/.test(v) ? v : '');
const dateOk = (v) => (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');

// store: 保存先（lib/store.js のファイル保存など）
// onEvent: リアルタイム通知を外へ流すフック（ブラウザ版デモで使用）
export function createApp({ store, now = () => new Date(), onEvent = null } = {}) {
  if (!store) throw new Error('store is required');
  const S = () => store.state;
  const ctx = () => businessContext(now(), S().settings.timeZone, S().settings.businessDayStartHour);

  // ---- リアルタイム配信 (Server-Sent Events) ----
  const adminClients = new Set();
  const customerClients = new Map(); // tagNo -> Set<res>

  function sse(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  function notifyAdmin(event, data = {}) {
    for (const res of adminClients) sse(res, event, data);
    onEvent?.({ target: 'admin', event, data });
  }
  function notifyTag(tagNo, data = {}) {
    if (tagNo == null) return;
    for (const res of customerClients.get(tagNo) || []) sse(res, 'changed', data);
    onEvent?.({ target: 'tag', tagNo, event: 'changed', data });
  }
  function notifyAllCustomers(data = {}) {
    for (const set of customerClients.values()) for (const res of set) sse(res, 'changed', data);
    onEvent?.({ target: 'customers', event: 'changed', data });
  }
  const ping = setInterval(() => {
    for (const res of adminClients) res.write(': ping\n\n');
    for (const set of customerClients.values()) for (const res of set) res.write(': ping\n\n');
  }, 25000);
  ping.unref?.();

  function changed(check, event = 'changed', extra = {}) {
    store.save();
    notifyAdmin(event, { checkId: check?.id, tagNo: check?.tagNo ?? null, ...extra });
    if (check) notifyTag(check.tagNo, { checkId: check.id });
  }

  // ---- 伝票まわり ----
  const openCheckByTag = (no) => S().openChecks.find((c) => c.tagNo === no);
  const findOpen = (id) => S().openChecks.find((c) => c.id === id) || fail(404, '伝票が見つかりません（すでに会計済みの可能性があります）');
  const findItem = (id) => S().items.find((i) => i.id === id);

  function openCheck({ tagNo = null, people = 0, takeout = false, by = 'staff' }) {
    if (tagNo != null) {
      if (!S().tags.some((t) => t.no === tagNo)) fail(400, `${tagNo}番の番号札はありません`);
      if (openCheckByTag(tagNo)) fail(409, `${tagNo}番はすでにご利用中です`);
    }
    const c = ctx();
    const check = {
      id: newId('c_'), tagNo, status: 'open', openedAt: now().toISOString(), openedBy: by, businessDate: c.bizDate,
      people: clampInt(people, 0, 99), takeout: !!takeout, orders: [], devices: {}, tickets: 0, discounts: [],
      payments: [], split: null, note: '',
    };
    S().openChecks.push(check);
    return check;
  }

  function adjustStock(item, delta) {
    const c = ctx();
    if (!item || !item.stock || item.stock.date !== c.bizDate || item.stock.qty == null) return;
    item.stock.qty = Math.max(0, item.stock.qty + delta);
  }

  // 注文明細を検証して価格をサーバー側で確定する（お客様側の金額は信用しない）
  function buildLines(rawLines, { staff }) {
    if (!Array.isArray(rawLines) || rawLines.length === 0) fail(400, '注文する商品がありません');
    if (rawLines.length > 50) fail(400, '一度に注文できるのは50件までです');
    const c = ctx();
    const lines = [];
    const need = new Map();
    const problems = [];
    for (const r of rawLines) {
      const item = findItem(str(r.itemId, 60));
      if (!item) { problems.push('メニューが更新されました。もう一度お選びください'); continue; }
      const st = itemStatus(item, c, { staff });
      if (!st.orderable) { problems.push(`${item.name}：${st.reason || '現在ご注文いただけません'}`); continue; }
      const pl = priceLine(item, r.sel || {}, c.bizDate);
      if (!pl.ok) { problems.push(`${item.name}：${pl.error}`); continue; }
      const qty = clampInt(r.qty, 1, 30, 1);
      need.set(item.id, (need.get(item.id) || 0) + qty);
      lines.push({
        id: newId('l_'), itemId: item.id, name: item.name, emoji: item.emoji || '', station: item.station || 'food',
        ticketEligible: !!item.ticketEligible, basePrice: Number(item.price) || 0, unitPrice: pl.unitPrice,
        options: pl.options, qty, note: str(r.note, 120),
        timing: ['first', 'with', 'after'].includes(r.timing) ? r.timing : '',
        // 物販（チケット・豆など）は作る必要がないので提供済みで登録
        status: item.station === 'other' ? 'served' : 'new', comp: false,
      });
    }
    for (const [id, q] of need) {
      const item = findItem(id);
      const left = stockLeft(item, c.bizDate);
      if (left != null && q > left) problems.push(`${item.name}：残り${left}点です`);
    }
    if (problems.length) fail(409, [...new Set(problems)].join('\n'), 'unavailable');
    for (const [id, q] of need) adjustStock(findItem(id), -q);
    return lines;
  }

  function addOrder(check, rawLines, { staff, deviceId = '', name = '', clientOrderId = '' }) {
    if (clientOrderId) {
      const dup = check.orders.find((o) => o.clientOrderId === clientOrderId);
      if (dup) return dup; // 通信のやり直しによる二重注文を防ぐ
    }
    const lines = buildLines(rawLines, { staff });
    const order = {
      id: newId('o_'), at: now().toISOString(), source: staff ? 'staff' : 'customer', deviceId, name, clientOrderId, lines,
    };
    check.orders.push(order);
    return order;
  }

  function allLines(check) {
    return check.orders.flatMap((o) => o.lines);
  }

  function closeCheck(check, status = 'closed', extra = {}) {
    const c = ctx();
    check.status = status;
    check.closedAt = now().toISOString();
    check.closedBizDate = c.bizDate;
    check.totals = computeTotals(check, S().settings);
    Object.assign(check, extra);
    S().openChecks = S().openChecks.filter((x) => x.id !== check.id);
    for (const call of S().calls) if (call.checkId === check.id) call.done = true;
    S().calls = S().calls.filter((x) => !x.done);
    store.getHistory(c.bizDate).push(check);
    store.saveHistory(c.bizDate);
    // 先にお会計（カウンター注文など）して、まだ作っていない品はキッチンの注文ボードに残す
    if (status === 'closed' && activeLines(check).some((l) => l.status === 'new')) {
      S().pendingServe.push(structuredClone(check));
    }
    changed(check, 'closed');
    return check;
  }

  // 提供状態だけを変更できる伝票（営業中＋会計済みで未提供あり）
  function findServable(id) {
    const open = S().openChecks.find((c) => c.id === id);
    if (open) return { check: open, paid: false };
    const paid = S().pendingServe.find((c) => c.id === id);
    if (paid) return { check: paid, paid: true };
    return fail(404, '伝票が見つかりません');
  }
  function afterServe(check, paid) {
    if (paid && !activeLines(check).some((l) => l.status === 'new')) {
      S().pendingServe = S().pendingServe.filter((c) => c.id !== check.id);
    }
    if (paid) { store.save(); notifyAdmin('changed', { checkId: check.id }); } else changed(check);
  }

  // ---- 表示用データ ----
  function customerMenu() {
    const c = ctx();
    const items = [];
    for (const item of S().items) {
      const st = itemStatus(item, c);
      if (!st.show) continue;
      const left = stockLeft(item, c.bizDate);
      items.push({
        id: item.id, categoryId: item.categoryId, name: item.name, emoji: item.emoji || '', image: item.image || '',
        price: item.price, description: item.description || '', allergens: item.allergens || [],
        recommended: !!item.recommended, daily: !!item.daily, station: item.station, ticketEligible: !!item.ticketEligible,
        orderable: st.orderable, reason: st.reason, stockLeft: left,
        optionGroups: (item.optionGroups || []).map((g) => ({
          id: g.id, name: g.name, type: g.type, required: !!g.required, max: g.max || 0, hint: g.hint || '',
          choices: (g.choices || []).filter((ch) => !ch.hidden).map((ch) => ({
            id: ch.id, label: ch.label, detail: ch.detail || '', slot: !!ch.slot, price: Number(ch.price) || 0,
            soldOut: isSoldOutToday(ch, c.bizDate),
          })),
        })),
      });
    }
    const used = new Set(items.map((i) => i.categoryId));
    return { categories: S().categories.filter((x) => used.has(x.id)), items };
  }

  function orderingState() {
    const s = S().settings;
    const c = ctx();
    if (s.orderingPaused) return { open: false, reason: s.pauseMessage || 'ただいま注文を停止しています' };
    const start = `${String(s.businessDayStartHour).padStart(2, '0')}:00`;
    if (s.lastOrder && (c.hhmm >= s.lastOrder || c.hhmm < start)) {
      return { open: false, reason: `ラストオーダー（${s.lastOrder}）を過ぎました。追加はスタッフにお声がけください` };
    }
    return { open: true, reason: '' };
  }

  function customerCheckView(check, deviceId) {
    if (!check) return null;
    const t = computeTotals(check, S().settings);
    return {
      id: check.id, people: check.people, openedAt: check.openedAt, myName: check.devices[deviceId] || '',
      orders: check.orders.map((o) => ({
        id: o.id, at: o.at, name: o.name || (o.source === 'staff' ? 'スタッフ受付' : ''), mine: !!deviceId && o.deviceId === deviceId,
        lines: o.lines.map((l) => ({
          id: l.id, name: l.name, emoji: l.emoji, options: l.options.map((x) => x.label), qty: l.qty,
          unitPrice: l.unitPrice, status: l.status, timing: l.timing, note: l.note, comp: l.comp,
        })),
      })),
      subtotal: t.subtotal, total: t.total, discount: t.ticketDiscount + t.discountTotal, itemCount: t.itemCount,
    };
  }

  function tagAuth(q) {
    const no = int(q.tag, -1);
    const tag = S().tags.find((t) => t.no === no);
    if (!tag || !q.k || tag.key !== q.k) fail(403, 'この番号札のQRコードが確認できませんでした。お手数ですがスタッフにお声がけください', 'bad_tag');
    return tag;
  }

  function adminState() {
    const s = S();
    const { adminPin, ...settings } = s.settings;
    return {
      settings, categories: s.categories, items: s.items, tags: s.tags, openChecks: s.openChecks, pendingServe: s.pendingServe, calls: s.calls,
      ctx: ctx(), serverTime: now().toISOString(), ordering: orderingState(),
    };
  }

  // ---- 売上集計 ----
  function report(date) {
    const checks = store.getHistory(date);
    const done = checks.filter((c) => c.status === 'closed');
    const r = {
      date, sales: 0, checks: done.length, guests: 0, voids: checks.length - done.length, takeout: 0,
      tickets: 0, ticketDiscount: 0, discountTotal: 0, tax: 0, byMethod: {}, byItem: {}, byHour: {}, byCategory: {},
    };
    for (const c of done) {
      const t = c.totals || computeTotals(c, S().settings);
      r.sales += t.total;
      r.guests += c.people || 1;
      r.tickets += t.tickets;
      r.ticketDiscount += t.ticketDiscount;
      r.discountTotal += t.discountTotal;
      r.tax += t.tax;
      if (c.takeout) r.takeout += 1;
      for (const p of c.payments) r.byMethod[p.method] = (r.byMethod[p.method] || 0) + p.amount;
      const h = businessContextHour(c.closedAt);
      r.byHour[h] = (r.byHour[h] || 0) + t.total;
      for (const l of activeLines(c)) {
        const k = l.itemId;
        r.byItem[k] ||= { name: l.name, qty: 0, amount: 0 };
        r.byItem[k].qty += l.qty;
        r.byItem[k].amount += l.comp ? 0 : l.unitPrice * l.qty;
        const item = findItem(l.itemId);
        const cat = S().categories.find((x) => x.id === item?.categoryId)?.name || 'その他';
        r.byCategory[cat] = (r.byCategory[cat] || 0) + (l.comp ? 0 : l.unitPrice * l.qty);
      }
    }
    r.perGuest = r.guests ? Math.round(r.sales / r.guests) : 0;
    r.list = checks.map((c) => ({
      id: c.id, tagNo: c.tagNo, closedAt: c.closedAt, openedAt: c.openedAt, status: c.status, people: c.people,
      total: (c.totals || computeTotals(c, S().settings)).total, methods: [...new Set(c.payments.map((p) => p.method))],
      takeout: c.takeout, voidReason: c.voidReason || '',
    }));
    return r;
  }
  function businessContextHour(iso) {
    const h = new Intl.DateTimeFormat('en-GB', { timeZone: S().settings.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
    return Number(h);
  }

  function csvCell(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function exportCsv(from, to, type) {
    const dates = store.historyDates().filter((d) => d >= from && d <= to);
    const rows = [];
    const tz = S().settings.timeZone;
    const fmt = (iso) => new Date(iso).toLocaleString('ja-JP', { timeZone: tz });
    if (type === 'items') {
      rows.push(['営業日', '伝票ID', '番号札', '会計日時', '商品', 'オプション', '数量', '単価', '金額', 'サービス', 'ステータス']);
      for (const d of dates) for (const c of store.getHistory(d)) for (const l of allLines(c)) {
        rows.push([d, c.id, c.tagNo ?? 'カウンター', fmt(c.closedAt), l.name, l.options.map((o) => o.label).join(' / '), l.qty, l.unitPrice,
          l.status === 'cancelled' || l.comp ? 0 : l.unitPrice * l.qty, l.comp ? '○' : '', c.status === 'void' ? '取消' : l.status === 'cancelled' ? '明細取消' : '']);
      }
    } else {
      rows.push(['営業日', '伝票ID', '番号札', '来店', '会計', '人数', '店内/持帰', '小計', 'チケット枚数', 'チケット値引', '割引', '合計', '内消費税', '支払方法', '状態']);
      for (const d of dates) for (const c of store.getHistory(d)) {
        const t = c.totals || computeTotals(c, S().settings);
        rows.push([d, c.id, c.tagNo ?? 'カウンター', fmt(c.openedAt), fmt(c.closedAt), c.people, c.takeout ? '持ち帰り' : '店内',
          t.subtotal, t.tickets, t.ticketDiscount, t.discountTotal, t.total, t.tax,
          c.payments.map((p) => `${p.method}:${p.amount}`).join(' '), c.status === 'void' ? `取消(${c.voidReason || ''})` : '会計済']);
      }
    }
    return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  }

  // ---- メニュー保存時の整形 ----
  function sanitizeItem(b, prev = {}) {
    const groups = (Array.isArray(b.optionGroups) ? b.optionGroups : []).slice(0, 12).map((g) => ({
      id: str(g.id, 40) || newId('g_'), name: str(g.name, 40) || 'オプション', type: g.type === 'multi' ? 'multi' : 'single',
      required: !!g.required, max: clampInt(g.max, 0, 20), hint: str(g.hint, 120),
      choices: (Array.isArray(g.choices) ? g.choices : []).slice(0, 30).map((ch) => {
        const old = (prev.optionGroups || []).find((x) => x.id === g.id)?.choices?.find((x) => x.id === ch.id) || {};
        return {
          id: str(ch.id, 40) || newId('ch_'), label: str(ch.label, 40) || '選択肢', detail: str(ch.detail, 60), price: clampInt(ch.price, -100000, 100000),
          hidden: !!ch.hidden, slot: !!ch.slot, slotKey: ch.slot ? str(ch.slotKey, 30) : '', soldOutDate: ch.soldOutDate ?? old.soldOutDate ?? '', detailDate: ch.detail !== old.detail ? ctx().bizDate : old.detailDate || '',
        };
      }).filter((ch) => ch.label),
    }));
    const a = b.availability || {};
    return {
      ...prev,
      id: prev.id || str(b.id, 40) || newId('i_'),
      categoryId: str(b.categoryId, 40) || S().categories[0]?.id || '',
      name: str(b.name, 60) || '新しい商品',
      emoji: str(b.emoji, 8),
      image: str(b.image, 300),
      price: clampInt(b.price, 0, 1000000),
      description: str(b.description, 300),
      station: ['drink', 'food', 'other'].includes(b.station) ? b.station : 'food',
      ticketEligible: !!b.ticketEligible,
      customerVisible: b.customerVisible !== false,
      recommended: !!b.recommended,
      daily: !!b.daily,
      allergens: (Array.isArray(b.allergens) ? b.allergens : []).map((x) => str(x, 20)).filter(Boolean).slice(0, 30),
      availability: {
        days: (Array.isArray(a.days) ? a.days : []).map((d) => int(d)).filter((d) => d >= 0 && d <= 6),
        from: hhmmOk(str(a.from, 5)), to: hhmmOk(str(a.to, 5)), startDate: dateOk(str(a.startDate, 10)), endDate: dateOk(str(a.endDate, 10)),
      },
      optionGroups: groups,
      archived: !!b.archived,
    };
  }

  // ---- 認証 ----
  const loginFails = new Map();
  function getCookie(req, name) {
    const m = (req.headers.cookie || '').split(/;\s*/).find((x) => x.startsWith(`${name}=`));
    return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
  }
  function isAdmin(req) {
    const tok = getCookie(req, 'cafe_admin') || req.headers['x-admin-token'] || '';
    const exp = tok && S().sessions[tok];
    return !!exp && exp > Date.now();
  }

  // ---- ルーティング ----
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, admin: pattern.startsWith('/api/admin') && !opts.public });
  };

  // ===== お客様向け API =====
  route('GET', '/api/c/session', ({ query }) => {
    const tag = tagAuth(query);
    const check = openCheckByTag(tag.no);
    const s = S().settings;
    return {
      shop: { name: s.shopName, notice: s.notice, welcome: s.welcome },
      tagNo: tag.no, ordering: orderingState(), requireStaffOpen: !!s.requireStaffOpen, askPeople: !!s.askPeople,
      callOptions: s.callOptions, ticket: s.ticket.enabled ? { name: s.ticket.name } : null,
      menu: customerMenu(), check: customerCheckView(check, str(query.device, 60)),
    };
  });

  route('POST', '/api/c/order', ({ body }) => {
    const tag = tagAuth(body);
    const st = orderingState();
    if (!st.open) fail(423, st.reason, 'closed');
    const deviceId = str(body.device, 60);
    const name = str(body.name, 20);
    let check = openCheckByTag(tag.no);
    const known = body.knownCheckId || null;
    if ((check?.id || null) !== known) {
      // 画面を開いている間に会計済みになった／別のご利用が始まった
      fail(409, check ? 'この番号札で新しいご利用が始まっています。画面を更新しました。' : 'この番号札のお会計は完了しています。新しくご注文しますか？', 'check_changed');
    }
    if (!check) {
      if (S().settings.requireStaffOpen) fail(403, 'スタッフが受付するまで少々お待ちください', 'not_open');
      check = openCheck({ tagNo: tag.no, people: body.people, by: 'customer' });
    } else if (body.people && !check.people) {
      check.people = clampInt(body.people, 0, 99);
    }
    let order;
    try {
      order = addOrder(check, body.lines, { staff: false, deviceId, name, clientOrderId: str(body.clientOrderId, 60) });
    } catch (e) {
      if (!check.orders.length) S().openChecks = S().openChecks.filter((x) => x.id !== check.id);
      throw e;
    }
    if (deviceId) check.devices[deviceId] = name || check.devices[deviceId] || '';
    changed(check, 'order', { orderId: order.id, count: order.lines.reduce((s, l) => s + l.qty, 0) });
    return { ok: true, orderId: order.id, check: customerCheckView(check, deviceId) };
  });

  route('POST', '/api/c/call', ({ body }) => {
    const tag = tagAuth(body);
    const type = str(body.type, 40);
    if (!S().settings.callOptions.includes(type)) fail(400, '呼び出し内容が不正です');
    const check = openCheckByTag(tag.no);
    const existing = S().calls.find((c) => c.tagNo === tag.no && c.type === type && !c.done);
    if (existing) existing.at = now().toISOString();
    else S().calls.push({ id: newId('call_'), tagNo: tag.no, checkId: check?.id || null, type, at: now().toISOString(), done: false });
    store.save();
    notifyAdmin('call', { tagNo: tag.no, type });
    return { ok: true };
  });

  route('POST', '/api/c/profile', ({ body }) => {
    const tag = tagAuth(body);
    const check = openCheckByTag(tag.no);
    if (!check) return { ok: true };
    const deviceId = str(body.device, 60);
    if (deviceId && body.name != null) check.devices[deviceId] = str(body.name, 20);
    if (body.people) check.people = clampInt(body.people, 0, 99);
    changed(check);
    return { ok: true };
  });

  // ===== 管理者 API =====
  route('POST', '/api/admin/login', ({ body, req, res }) => {
    const ip = req.socket.remoteAddress || '';
    const f = loginFails.get(ip) || { n: 0, until: 0 };
    if (f.until > Date.now()) fail(429, 'しばらく待ってからお試しください');
    if (str(body.pin, 20) !== String(S().settings.adminPin)) {
      f.n += 1;
      if (f.n >= 5) { f.until = Date.now() + 60_000; f.n = 0; }
      loginFails.set(ip, f);
      fail(401, 'PINが違います');
    }
    loginFails.delete(ip);
    const tok = randomToken(32);
    const sessions = S().sessions;
    for (const [k, exp] of Object.entries(sessions)) if (exp < Date.now()) delete sessions[k];
    sessions[tok] = Date.now() + 90 * 24 * 3600 * 1000;
    store.save();
    res.setHeader('Set-Cookie', `cafe_admin=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${90 * 24 * 3600}`);
    return { ok: true, defaultPin: String(S().settings.adminPin) === '1234' };
  }, { public: true });

  route('POST', '/api/admin/logout', ({ req, res }) => {
    delete S().sessions[getCookie(req, 'cafe_admin')];
    store.save();
    res.setHeader('Set-Cookie', 'cafe_admin=; Path=/; Max-Age=0');
    return { ok: true };
  });

  route('GET', '/api/admin/state', ({ req }) => ({ ...adminState(), publicBase: publicBase(req) }));

  // --- 設定 ---
  route('PUT', '/api/admin/settings', ({ body }) => {
    const s = S().settings;
    const b = body || {};
    const setStr = (k, max) => { if (k in b) s[k] = str(b[k], max); };
    setStr('shopName', 40); setStr('pauseMessage', 120); setStr('notice', 300); setStr('welcome', 200); setStr('timeZone', 40);
    if ('publicBaseUrl' in b) s.publicBaseUrl = str(b.publicBaseUrl, 200).replace(/\/+$/, '');
    if ('lastOrder' in b) s.lastOrder = hhmmOk(str(b.lastOrder, 5));
    if ('businessDayStartHour' in b) s.businessDayStartHour = clampInt(b.businessDayStartHour, 0, 12, 4);
    if ('tagCount' in b) { s.tagCount = clampInt(b.tagCount, 1, 200, 20); store.syncTags(); }
    for (const k of ['orderingPaused', 'requireStaffOpen', 'askPeople', 'newOrderSound']) if (k in b) s[k] = !!b[k];
    if ('taxRate' in b) s.taxRate = clampInt(b.taxRate, 0, 30, 10);
    if ('takeoutTaxRate' in b) s.takeoutTaxRate = clampInt(b.takeoutTaxRate, 0, 30, 8);
    if (Array.isArray(b.callOptions)) s.callOptions = b.callOptions.map((x) => str(x, 30)).filter(Boolean).slice(0, 6);
    if (Array.isArray(b.paymentMethods)) s.paymentMethods = b.paymentMethods.map((x) => str(x, 20)).filter(Boolean).slice(0, 10);
    if (!s.paymentMethods.includes('現金')) s.paymentMethods.unshift('現金');
    if (Array.isArray(b.discounts)) {
      s.discounts = b.discounts.slice(0, 20).map((d) => ({
        id: str(d.id, 40) || newId('d_'), name: str(d.name, 30) || '割引', type: d.type === 'percent' ? 'percent' : 'amount',
        value: d.type === 'percent' ? clampInt(d.value, 0, 100) : clampInt(d.value, 0, 1000000),
      }));
    }
    if (b.ticket) s.ticket = { enabled: !!b.ticket.enabled, name: str(b.ticket.name, 30) || 'コーヒーチケット', value: clampInt(b.ticket.value, 0, 100000, 500) };
    if (b.receipt) s.receipt = { address: str(b.receipt.address, 120), phone: str(b.receipt.phone, 30), invoiceNumber: str(b.receipt.invoiceNumber, 20), footer: str(b.receipt.footer, 120) };
    if ('adminPin' in b) {
      const pin = str(b.adminPin, 20);
      if (!/^\d{4,12}$/.test(pin)) fail(400, 'PINは4〜12桁の数字にしてください');
      s.adminPin = pin;
    }
    store.save();
    notifyAdmin('settings');
    notifyAllCustomers({ menu: true });
    return { ok: true };
  });

  route('POST', '/api/admin/tags/:no/rekey', ({ params }) => {
    const tag = S().tags.find((t) => t.no === int(params.no));
    if (!tag) fail(404, '番号札がありません');
    tag.key = newTagKey();
    store.save();
    notifyAdmin('settings');
    return { ok: true };
  });

  route('GET', '/api/admin/qr/:no', async ({ params, req, res }) => {
    const tag = S().tags.find((t) => t.no === int(params.no));
    if (!tag) fail(404, '番号札がありません');
    const svg = await QRCode.toString(`${publicBase(req)}/t/${tag.no}?k=${tag.key}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    res.end(svg);
  });

  // --- メニュー ---
  route('PUT', '/api/admin/categories', ({ body }) => {
    if (!Array.isArray(body.categories)) fail(400, 'カテゴリが不正です');
    const cats = body.categories.slice(0, 50).map((c) => ({ id: str(c.id, 40) || newId('cat_'), name: str(c.name, 30) || 'カテゴリ' }));
    if (!cats.length) fail(400, 'カテゴリは1つ以上必要です');
    S().categories = cats;
    for (const it of S().items) if (!cats.some((c) => c.id === it.categoryId)) it.categoryId = cats[0].id;
    store.save(); notifyAdmin('menu'); notifyAllCustomers({ menu: true });
    return { ok: true };
  });

  route('POST', '/api/admin/items', ({ body }) => {
    const item = sanitizeItem(body);
    if (findItem(item.id)) item.id = newId('i_');
    S().items.push(item);
    store.save(); notifyAdmin('menu'); notifyAllCustomers({ menu: true });
    return { ok: true, item };
  });

  route('PUT', '/api/admin/items/:id', ({ params, body }) => {
    const idx = S().items.findIndex((i) => i.id === params.id);
    if (idx < 0) fail(404, '商品が見つかりません');
    S().items[idx] = sanitizeItem(body, S().items[idx]);
    store.save(); notifyAdmin('menu'); notifyAllCustomers({ menu: true });
    return { ok: true, item: S().items[idx] };
  });

  route('DELETE', '/api/admin/items/:id', ({ params }) => {
    S().items = S().items.filter((i) => i.id !== params.id);
    store.save(); notifyAdmin('menu'); notifyAllCustomers({ menu: true });
    return { ok: true };
  });

  route('POST', '/api/admin/items/reorder', ({ body }) => {
    const order = Array.isArray(body.ids) ? body.ids : [];
    const pos = new Map(order.map((id, i) => [id, i]));
    S().items.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
    store.save(); notifyAdmin('menu'); notifyAllCustomers({ menu: true });
    return { ok: true };
  });

  // 本日の準備：売り切れ・本日休み・残数・おすすめ・日替わりの中身をワンタップで更新
  route('PATCH', '/api/admin/items/:id', ({ params, body }) => {
    const item = findItem(params.id) || fail(404, '商品が見つかりません');
    const c = ctx();
    if ('soldOut' in body) item.soldOutDate = body.soldOut ? c.bizDate : '';
    if ('offToday' in body) item.offDate = body.offToday ? c.bizDate : '';
    if ('recommended' in body) item.recommended = !!body.recommended;
    if ('price' in body) item.price = clampInt(body.price, 0, 1000000);
    if ('stock' in body) item.stock = body.stock === null || body.stock === '' ? null : { date: c.bizDate, qty: clampInt(body.stock, 0, 9999) };
    if (body.choice) {
      const { groupId, choiceId } = body.choice;
      const ch = item.optionGroups?.find((g) => g.id === groupId)?.choices?.find((x) => x.id === choiceId) || fail(404, '選択肢が見つかりません');
      // 連動キーが同じ枠（例：スコーン単品とブランチのスコーン）はまとめて更新
      const linked = ch.slotKey
        ? S().items.flatMap((it) => (it.optionGroups || []).flatMap((g) => g.choices || [])).filter((x) => x.slotKey === ch.slotKey)
        : [ch];
      if ('detail' in body.choice) for (const x of linked) { x.detail = str(body.choice.detail, 60); x.detailDate = c.bizDate; }
      if ('soldOut' in body.choice) for (const x of linked) x.soldOutDate = body.choice.soldOut ? c.bizDate : '';
      if ('hidden' in body.choice) ch.hidden = !!body.choice.hidden;
      if ('price' in body.choice) ch.price = clampInt(body.choice.price, -100000, 100000);
    }
    store.save(); notifyAdmin('menu'); notifyAllCustomers({ menu: true });
    return { ok: true, item };
  });

  route('POST', '/api/admin/upload', ({ body }) => {
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(body.dataUrl || ''));
    if (!m) fail(400, '画像はJPEG/PNG/WebPでアップロードしてください');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 3 * 1024 * 1024) fail(413, '画像が大きすぎます（3MBまで）');
    return { ok: true, url: store.saveUpload(buf, m[1] === 'jpeg' ? 'jpg' : m[1]) };
  });

  // --- 伝票 ---
  route('POST', '/api/admin/checks', ({ body }) => {
    const tagNo = body.tagNo == null || body.tagNo === '' ? null : int(body.tagNo);
    const check = openCheck({ tagNo, people: body.people, takeout: body.takeout });
    changed(check, 'opened');
    return { ok: true, check };
  });

  route('POST', '/api/admin/checks/:id/orders', ({ params, body }) => {
    const check = findOpen(params.id);
    const order = addOrder(check, body.lines, { staff: true, name: 'スタッフ', clientOrderId: str(body.clientOrderId, 60) });
    changed(check, 'staff-order', { orderId: order.id });
    return { ok: true, check };
  });

  route('PATCH', '/api/admin/checks/:id', ({ params, body }) => {
    const check = findOpen(params.id);
    if ('people' in body) check.people = clampInt(body.people, 0, 99);
    if ('takeout' in body) check.takeout = !!body.takeout;
    if ('note' in body) check.note = str(body.note, 300);
    if ('tickets' in body) check.tickets = clampInt(body.tickets, 0, 999);
    if ('split' in body) check.split = body.split && typeof body.split === 'object' ? JSON.parse(JSON.stringify(body.split)) : null;
    if (Array.isArray(body.discounts)) {
      check.discounts = body.discounts.slice(0, 10).map((d) => ({
        id: str(d.id, 40) || newId('d_'), name: str(d.name, 30) || '割引', type: d.type === 'percent' ? 'percent' : 'amount',
        value: d.type === 'percent' ? clampInt(d.value, 0, 100) : clampInt(d.value, 0, 1000000),
      }));
    }
    if ('tagNo' in body) {
      const to = body.tagNo == null || body.tagNo === '' ? null : int(body.tagNo);
      if (to !== check.tagNo) {
        if (to != null && !S().tags.some((t) => t.no === to)) fail(400, `${to}番の番号札はありません`);
        if (to != null && openCheckByTag(to)) fail(409, `${to}番はご利用中です。「合流」をお使いください`);
        const from = check.tagNo;
        check.tagNo = to;
        for (const call of S().calls) if (call.checkId === check.id) call.tagNo = to;
        notifyTag(from, { moved: true });
      }
    }
    if (computeTotals(check, S().settings).remaining < 0) fail(409, '支払済みの金額が合計を超えます。先に支払いを取り消してください');
    changed(check);
    return { ok: true, check };
  });

  route('POST', '/api/admin/checks/:id/lines/:lineId', ({ params, body }) => {
    const { check, paid } = findServable(params.id);
    const line = allLines(check).find((l) => l.id === params.lineId) || fail(404, '明細が見つかりません');
    if (paid) {
      if (body.status !== 'served' && body.status !== 'new') fail(409, '会計済みの伝票です。修正は「売上」から会計を取り消して行ってください');
      line.status = body.status;
      line.servedAt = body.status === 'served' ? now().toISOString() : null;
      afterServe(check, true);
      return { ok: true, check };
    }
    const before = JSON.stringify(line);
    if (body.status === 'served' || body.status === 'new') {
      line.status = body.status;
      line.servedAt = body.status === 'served' ? now().toISOString() : null;
    }
    if (body.status === 'cancelled' && line.status !== 'cancelled') {
      adjustStock(findItem(line.itemId), line.qty);
      line.status = 'cancelled';
      line.cancelReason = str(body.reason, 60);
    }
    if ('qty' in body && line.status !== 'cancelled') {
      const q = clampInt(body.qty, 1, 30, line.qty);
      adjustStock(findItem(line.itemId), line.qty - q);
      line.qty = q;
    }
    if ('comp' in body) line.comp = !!body.comp;
    if (computeTotals(check, S().settings).remaining < 0) {
      Object.assign(line, JSON.parse(before));
      fail(409, '支払済みの金額が合計を超えます。先に支払いを取り消してください');
    }
    changed(check);
    return { ok: true, check };
  });

  route('POST', '/api/admin/checks/:id/serve', ({ params, body }) => {
    const { check, paid } = findServable(params.id);
    const at = now().toISOString();
    for (const o of check.orders) {
      if (body.orderId && o.id !== body.orderId) continue;
      for (const l of o.lines) {
        if (l.status !== 'new') continue;
        if (body.station && l.station !== body.station) continue;
        l.status = 'served'; l.servedAt = at;
      }
    }
    afterServe(check, paid);
    return { ok: true, check };
  });

  route('POST', '/api/admin/checks/:id/merge', ({ params, body }) => {
    const check = findOpen(params.id);
    const other = findOpen(str(body.fromId, 60));
    if (other.id === check.id) fail(400, '同じ伝票です');
    check.orders.push(...other.orders);
    check.orders.sort((a, b) => a.at.localeCompare(b.at));
    check.payments.push(...other.payments);
    check.discounts.push(...other.discounts);
    check.tickets += other.tickets;
    check.people += other.people;
    Object.assign(check.devices, other.devices);
    check.note = [check.note, other.note].filter(Boolean).join(' / ');
    check.split = null;
    if (check.openedAt > other.openedAt) check.openedAt = other.openedAt;
    S().openChecks = S().openChecks.filter((x) => x.id !== other.id);
    for (const call of S().calls) if (call.checkId === other.id) { call.checkId = check.id; call.tagNo = check.tagNo; }
    notifyTag(other.tagNo, { moved: true });
    changed(check);
    return { ok: true, check };
  });

  route('POST', '/api/admin/checks/:id/payments', ({ params, body }) => {
    const check = findOpen(params.id);
    const t = computeTotals(check, S().settings);
    const method = str(body.method, 20) || '現金';
    const amount = int(body.amount);
    if (amount <= 0) fail(400, '金額を入力してください');
    if (amount > t.remaining) fail(400, `残りは${yen(t.remaining)}です`);
    const p = { id: newId('p_'), method, amount, label: str(body.label, 30), at: now().toISOString() };
    if (method === '現金' && body.received != null && body.received !== '') {
      const received = int(body.received);
      if (received < amount) fail(400, 'お預かり金額が足りません');
      p.received = received; p.change = received - amount;
    }
    check.payments.push(p);
    const after = computeTotals(check, S().settings);
    if (after.remaining <= 0 && after.total > 0) {
      closeCheck(check);
      return { ok: true, payment: p, closed: true, check };
    }
    changed(check, 'payment');
    return { ok: true, payment: p, closed: false, check };
  });

  route('DELETE', '/api/admin/checks/:id/payments/:pid', ({ params }) => {
    const check = findOpen(params.id);
    check.payments = check.payments.filter((p) => p.id !== params.pid);
    changed(check);
    return { ok: true, check };
  });

  route('POST', '/api/admin/checks/:id/close', ({ params }) => {
    const check = findOpen(params.id);
    const t = computeTotals(check, S().settings);
    if (t.remaining > 0) fail(409, `未払いが${yen(t.remaining)}あります`);
    closeCheck(check);
    return { ok: true, check };
  });

  route('POST', '/api/admin/checks/:id/void', ({ params, body }) => {
    const check = findOpen(params.id);
    if (check.payments.length) fail(409, '支払い済みの記録があります。先に支払いを取り消してください');
    for (const l of activeLines(check)) adjustStock(findItem(l.itemId), l.qty);
    if (!check.orders.length) {
      // 注文のない空伝票はそのまま削除
      S().openChecks = S().openChecks.filter((x) => x.id !== check.id);
      changed(check, 'closed');
      return { ok: true };
    }
    closeCheck(check, 'void', { voidReason: str(body.reason, 60) });
    return { ok: true };
  });

  route('POST', '/api/admin/calls/:id/done', ({ params }) => {
    S().calls = S().calls.filter((c) => c.id !== params.id);
    store.save(); notifyAdmin('call-done');
    return { ok: true };
  });

  // --- 売上・履歴 ---
  route('GET', '/api/admin/report', ({ query }) => report(dateOk(str(query.date, 10)) || ctx().bizDate));
  route('GET', '/api/admin/history/:date/:id', ({ params }) => {
    const c = store.getHistory(dateOk(params.date) || fail(400, '日付が不正です')).find((x) => x.id === params.id);
    return c || fail(404, '伝票が見つかりません');
  });
  route('POST', '/api/admin/history/:date/:id/reopen', ({ params }) => {
    const date = dateOk(params.date) || fail(400, '日付が不正です');
    const list = store.getHistory(date);
    const idx = list.findIndex((x) => x.id === params.id);
    if (idx < 0) fail(404, '伝票が見つかりません');
    const [check] = list.splice(idx, 1);
    store.saveHistory(date);
    S().pendingServe = S().pendingServe.filter((c) => c.id !== check.id);
    check.reopenLog = [...(check.reopenLog || []), { at: now().toISOString(), payments: check.payments, status: check.status }];
    if (check.status === 'void') for (const l of activeLines(check)) adjustStock(findItem(l.itemId), -l.qty);
    check.status = 'open';
    check.payments = [];
    delete check.closedAt; delete check.closedBizDate; delete check.totals; delete check.voidReason;
    if (check.tagNo != null && openCheckByTag(check.tagNo)) check.tagNo = null;
    S().openChecks.push(check);
    changed(check, 'opened');
    return { ok: true, check };
  });
  route('GET', '/api/admin/export.csv', ({ query, res }) => {
    const today = ctx().bizDate;
    const from = dateOk(str(query.from, 10)) || today;
    const to = dateOk(str(query.to, 10)) || from;
    const type = query.type === 'items' ? 'items' : 'checks';
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${type}_${from}_${to}.csv"`,
    });
    res.end(exportCsv(from, to, type));
  });
  route('GET', '/api/admin/backup', ({ res }) => {
    const { sessions, ...state } = S();
    const history = Object.fromEntries(store.historyDates().map((d) => [d, store.getHistory(d)]));
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="cafe-backup-${ctx().bizDate}.json"`,
    });
    res.end(JSON.stringify({ exportedAt: now().toISOString(), state, history }));
  });

  function publicBase(req) {
    if (S().settings.publicBaseUrl) return S().settings.publicBaseUrl;
    const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] || (req.socket.encrypted ? 'https' : 'http');
    return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  }

  // ---- リクエスト処理 ----
  async function readBody(req) {
    if (req.body !== undefined) return req.body; // 解析済みの本文（デモ用）
    const chunks = [];
    let size = 0;
    for await (const ch of req) {
      size += ch.length;
      if (size > 6 * 1024 * 1024) throw new HttpError(413, 'データが大きすぎます');
      chunks.push(ch);
    }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSONが不正です'); }
  }

  function sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  function serveFile(res, file, cache = 'no-cache') {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache });
      fs.createReadStream(file).pipe(res);
    });
  }

  function openStream(req, res, set) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    set.add(res);
    req.on('close', () => set.delete(res));
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const query = Object.fromEntries(url.searchParams);
    try {
      // SSE
      if (req.method === 'GET' && p === '/api/admin/stream') {
        if (!isAdmin(req)) return sendJson(res, 401, { error: 'ログインしてください' });
        return openStream(req, res, adminClients);
      }
      if (req.method === 'GET' && p === '/api/c/stream') {
        const tag = tagAuth(query);
        if (!customerClients.has(tag.no)) customerClients.set(tag.no, new Set());
        return openStream(req, res, customerClients.get(tag.no));
      }

      if (p.startsWith('/api/')) {
        for (const r of routes) {
          if (r.method !== req.method) continue;
          const m = r.re.exec(p);
          if (!m) continue;
          if (r.admin && !isAdmin(req)) return sendJson(res, 401, { error: 'ログインしてください', code: 'auth' });
          const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
          const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
          const out = await r.handler({ req, res, params, query, body });
          if (!res.headersSent) sendJson(res, 200, out ?? { ok: true });
          return;
        }
        return sendJson(res, 404, { error: 'Not found' });
      }

      // 画面
      if (p === '/' || p === '/index.html') return serveFile(res, path.join(PUBLIC, 'index.html'));
      if (p === '/admin' || p === '/admin/') return serveFile(res, path.join(PUBLIC, 'admin.html'));
      if (/^\/t\/\d+$/.test(p)) return serveFile(res, path.join(PUBLIC, 'order.html'));
      if (p.startsWith('/uploads/')) {
        const f = path.join(store.uploadsDir, path.basename(p));
        return serveFile(res, f, 'public, max-age=31536000, immutable');
      }
      const f = path.normalize(path.join(PUBLIC, p));
      if (!f.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
      return serveFile(res, f);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, code: e.code });
      console.error(e);
      return sendJson(res, 500, { error: 'サーバーでエラーが発生しました' });
    }
  }

  return { handle, store };
}
