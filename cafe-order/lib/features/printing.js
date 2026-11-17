// レシートプリンター直結とキャッシュドロア。
//  type: 'none'       … iPadのAirPrintで印刷（従来どおり）
//        'escpos-net' … 店内LANのレシートプリンターへ直接送る（EPSON TM-m30 / Star mC-Print など、ポート9100）
//                       サーバーを店内のPCで動かす場合向け
//        'epson-sdp'  … EPSON「Server Direct Print」。プリンターがサーバーへ印刷データを取りに来る
//                       サーバーがクラウドでも使える
// 印刷内容は「行のリスト」で組み立て、ESC/POS（バイト列）か ePOS-Print XML に変換する。
import net from 'node:net';
import { activeLines, computeTotals, lineGross, yen } from '../../public/shared/calc.js';
import { DENOMINATIONS } from './register.js';

// ---- 文字幅（全角=2、半角=1） ----
export function textWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += /[\u0020-\u007e\u00a5\uff61-\uff9f]/.test(ch) ? 1 : 2; // ¥ は半角（0x5C）
  return w;
}
function clip(s, max) {
  let out = '';
  let w = 0;
  for (const ch of String(s)) {
    const cw = textWidth(ch);
    if (w + cw > max) break;
    out += ch; w += cw;
  }
  return out;
}
// 左右に振り分けた1行（右側の金額は必ず出す）
export function twoCol(left, right, cols) {
  const rw = textWidth(right);
  const l = clip(left, Math.max(0, cols - rw - 1));
  return l + ' '.repeat(Math.max(1, cols - textWidth(l) - rw)) + right;
}

// ---- 印刷内容 ----
// op: {t:'text', s, align, bold, big} | {t:'row', l, r, bold, big} | {t:'hr'} | {t:'feed', n} | {t:'cut'} | {t:'pulse'}
const tz = (s) => s.timeZone || 'Asia/Tokyo';
const fmt = (iso, s) => new Date(iso || Date.now()).toLocaleString('ja-JP', { timeZone: tz(s) });
const tagLabel = (c) => (c.tagNo == null ? 'カウンター' : `${c.tagNo}番`);

export function receiptDoc(check, s) {
  const t = check.totals || computeTotals(check, s);
  const r = s.receipt || {};
  const ops = [
    { t: 'text', s: s.shopName, align: 'center', big: true },
    r.address && { t: 'text', s: r.address, align: 'center' },
    r.phone && { t: 'text', s: `TEL ${r.phone}`, align: 'center' },
    r.invoiceNumber && { t: 'text', s: `登録番号 ${r.invoiceNumber}`, align: 'center' },
    { t: 'text', s: fmt(check.closedAt, s) },
    { t: 'text', s: `${tagLabel(check)}${check.people ? ` / ${check.people}名` : ''} / ${check.takeout ? '持ち帰り' : '店内'}` },
    { t: 'text', s: '領 収 証', align: 'center', bold: true },
    { t: 'hr' },
  ];
  for (const l of activeLines(check)) {
    ops.push({ t: 'row', l: `${l.name}${l.qty > 1 ? ` x${l.qty}` : ''}${check.takeout ? ' ※' : ''}`, r: l.comp ? 'サービス' : yen(lineGross(l)) });
    if (l.options?.length) ops.push({ t: 'text', s: `  ${l.options.map((o) => o.label).join(' / ')}` });
  }
  ops.push({ t: 'hr' }, { t: 'row', l: '小計', r: yen(t.subtotal) });
  if (t.ticketDiscount) ops.push({ t: 'row', l: `${s.ticket?.name || 'チケット'} ${t.tickets}枚`, r: `-${yen(t.ticketDiscount)}` });
  for (const d of t.discounts || []) ops.push({ t: 'row', l: d.name, r: `-${yen(d.amount)}` });
  ops.push(
    { t: 'row', l: '合計', r: yen(t.total), bold: true, big: true },
    { t: 'row', l: `${t.taxRate}%対象${check.takeout ? '(軽減税率)' : ''}`, r: yen(t.total) },
    { t: 'row', l: '(内消費税等', r: `${yen(t.tax)})` },
    { t: 'hr' },
  );
  for (const p of check.payments || []) {
    ops.push({ t: 'row', l: `${p.method}${p.label ? `(${p.label})` : ''}`, r: yen(p.received ?? p.amount) });
    if (p.change) ops.push({ t: 'row', l: 'おつり', r: yen(p.change) });
  }
  if (check.takeout) ops.push({ t: 'text', s: '※は軽減税率対象' });
  if (r.footer) ops.push({ t: 'hr' }, { t: 'text', s: r.footer, align: 'center' });
  ops.push({ t: 'feed', n: 3 }, { t: 'cut' });
  return ops.filter(Boolean);
}

const TIMING = { first: '先に', with: '食事と一緒', after: '食後' };
export function kitchenDoc(check, order, s) {
  const ops = [
    { t: 'text', s: `${tagLabel(check)}${check.takeout ? ' 持ち帰り' : ''}`, big: true, bold: true },
    { t: 'text', s: `${fmt(order.at, s)} ${order.source === 'staff' ? 'スタッフ' : order.name || 'スマホ'}` },
    { t: 'hr' },
  ];
  for (const l of order.lines) {
    if (l.station === 'other') continue;
    ops.push({ t: 'text', s: `${l.qty} x ${l.name}`, big: true });
    if (l.options?.length) ops.push({ t: 'text', s: `  ${l.options.map((o) => o.label).join(' / ')}` });
    if (l.timing) ops.push({ t: 'text', s: `  [${TIMING[l.timing]}]`, bold: true });
    if (l.note) ops.push({ t: 'text', s: `  「${l.note}」`, bold: true });
  }
  ops.push({ t: 'feed', n: 3 }, { t: 'cut' });
  return ops;
}

export function registerDoc(entry, s, { title = 'レジ精算' } = {}) {
  const sum = entry.summary;
  const ops = [
    { t: 'text', s: `${title}`, align: 'center', big: true, bold: true },
    { t: 'text', s: s.shopName, align: 'center' },
    { t: 'text', s: `開始 ${fmt(entry.openedAt, s)}` },
    { t: 'text', s: `${entry.closedAt ? '精算' : '点検'} ${fmt(entry.closedAt, s)}` },
    { t: 'hr' },
    { t: 'row', l: '売上（税込）', r: yen(sum.sales) },
    { t: 'row', l: '会計数 / 客数', r: `${sum.salesChecks}組 / ${sum.guests}名` },
    { t: 'hr' },
  ];
  for (const [m, v] of Object.entries(sum.byMethod)) ops.push({ t: 'row', l: `${m}（${v.count}件）`, r: yen(v.amount) });
  ops.push(
    { t: 'hr' },
    { t: 'row', l: '釣銭準備金', r: yen(sum.float) },
    { t: 'row', l: '現金売上', r: yen(sum.cashSales) },
    { t: 'row', l: '入金', r: yen(sum.moneyIn) },
    { t: 'row', l: '出金', r: `-${yen(sum.moneyOut)}` },
    { t: 'row', l: '理論在高', r: yen(sum.expectedCash), bold: true },
  );
  if (entry.counts) {
    ops.push({ t: 'hr' });
    for (const d of DENOMINATIONS) if (entry.counts[d]) ops.push({ t: 'row', l: `${d.toLocaleString()}円 x ${entry.counts[d]}`, r: yen(d * entry.counts[d]) });
    ops.push(
      { t: 'row', l: '実在高', r: yen(entry.actual), bold: true },
      { t: 'row', l: '過不足', r: `${entry.difference > 0 ? '+' : ''}${yen(entry.difference)}`, bold: true, big: true },
    );
    if (entry.note) ops.push({ t: 'text', s: `メモ: ${entry.note}` });
  }
  ops.push({ t: 'feed', n: 3 }, { t: 'cut' });
  return ops;
}

export function testDoc(s) {
  return [
    { t: 'text', s: 'まめレジ テスト印刷', align: 'center', big: true, bold: true },
    { t: 'text', s: s.shopName, align: 'center' },
    { t: 'hr' },
    { t: 'row', l: 'バスクチーズケーキ', r: yen(500) },
    { t: 'row', l: '本日の珈琲（ホット）', r: yen(500) },
    { t: 'row', l: '合計', r: yen(1000), bold: true, big: true },
    { t: 'text', s: 'この印刷が読めれば設定は完了です' },
    { t: 'feed', n: 3 }, { t: 'cut' },
  ];
}

// ---- Shift_JIS（日本語のESC/POSプリンター用）----
let sjisMap = null;
function buildSjis() {
  sjisMap = new Map();
  const dec = new TextDecoder('shift_jis');
  for (let b = 0xa1; b <= 0xdf; b++) sjisMap.set(dec.decode(Uint8Array.of(b)), [b]); // 半角カナ
  const leads = [];
  for (let b = 0x81; b <= 0x9f; b++) leads.push(b);
  for (let b = 0xe0; b <= 0xfc; b++) leads.push(b);
  for (const hi of leads) {
    for (let lo = 0x40; lo <= 0xfc; lo++) {
      if (lo === 0x7f) continue;
      const ch = dec.decode(Uint8Array.of(hi, lo));
      if (ch.length === 1 && ch !== '�' && !sjisMap.has(ch)) sjisMap.set(ch, [hi, lo]);
    }
  }
  // よく使うのに表が分かれている文字
  const alias = { '～': '〜', '−': '－', '¥': '\\', '—': '―' };
  for (const [a, b] of Object.entries(alias)) if (!sjisMap.has(a) && sjisMap.has(b)) sjisMap.set(a, sjisMap.get(b));
}
export function encodeSjis(str) {
  if (!sjisMap) buildSjis();
  const out = [];
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (c === 0xa5) out.push(0x5c); // ¥（日本語モデルでは0x5Cが円記号）
    else if (c < 0x80) out.push(c);
    else out.push(...(sjisMap.get(ch) || [0x3f]));
  }
  return out;
}

// ---- ESC/POS ----
const ESC = 0x1b; const GS = 0x1d; const FS = 0x1c;
export function toEscPos(ops, cols = 48) {
  const b = [ESC, 0x40, FS, 0x26, FS, 0x43, 0x01]; // 初期化・漢字モード・Shift_JIS
  const line = (s, { align = 'left', bold = false, big = false } = {}) => {
    b.push(ESC, 0x61, { left: 0, center: 1, right: 2 }[align] ?? 0);
    b.push(ESC, 0x45, bold ? 1 : 0);
    b.push(GS, 0x21, big ? 0x11 : 0x00, FS, 0x21, big ? 0x0c : 0x00);
    b.push(...encodeSjis(s), 0x0a);
  };
  for (const op of ops) {
    if (op.t === 'text') line(op.s, op);
    else if (op.t === 'row') line(twoCol(op.l, op.r, op.big ? Math.floor(cols / 2) : cols), op);
    else if (op.t === 'hr') line('-'.repeat(cols));
    else if (op.t === 'feed') b.push(ESC, 0x64, op.n || 1);
    else if (op.t === 'cut') b.push(GS, 0x56, 0x42, 0x00);
    else if (op.t === 'pulse') b.push(ESC, 0x70, 0x00, 0x19, 0xfa);
  }
  b.push(ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0);
  return Buffer.from(b);
}

// ---- ePOS-Print XML（EPSON Server Direct Print 用）----
const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function toEposXml(ops, cols = 48) {
  const parts = [];
  const text = (s, { align = 'left', bold = false, big = false } = {}) => {
    parts.push(`<text lang="ja" align="${align}" em="${bold}" width="${big ? 2 : 1}" height="${big ? 2 : 1}">${xmlEsc(s)}&#10;</text>`);
  };
  for (const op of ops) {
    if (op.t === 'text') text(op.s, op);
    else if (op.t === 'row') text(twoCol(op.l, op.r, op.big ? Math.floor(cols / 2) : cols), op);
    else if (op.t === 'hr') text('-'.repeat(cols));
    else if (op.t === 'feed') parts.push(`<feed line="${op.n || 1}"/>`);
    else if (op.t === 'cut') parts.push('<cut type="feed"/>');
    else if (op.t === 'pulse') parts.push('<pulse drawer="drawer_1" time="pulse_100"/>');
  }
  return `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${parts.join('')}</epos-print>`;
}

export function sdpRequestXml(jobId, eposXml) {
  return `<?xml version="1.0" encoding="utf-8"?>
<PrintRequestInfo Version="2.00"><ePOSPrint><Parameter><devid>local_printer</devid><timeout>10000</timeout><printjobid>${jobId}</printjobid></Parameter>
<PrintData>${eposXml}</PrintData></ePOSPrint></PrintRequestInfo>`;
}

// ---- 送信 ----
function sendTcp(host, port, data) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port, timeout: 5000 }, () => sock.end(data));
    sock.on('close', (hadErr) => { if (!hadErr) resolve(); });
    sock.on('timeout', () => { sock.destroy(); reject(new Error('プリンターが応答しません')); });
    sock.on('error', (e) => reject(new Error(`プリンターに接続できません（${e.code || e.message}）`)));
  });
}

export function installPrinting(f) {
  const { route, S, store, fail, str, int, clampInt, randomToken, newId, notifyAdmin, on, onSettings, findOpen, printerTransport } = f;
  const cfg = () => {
    const p = (S().settings.printer ||= { type: 'none', host: '', port: 9100, paper: 80, autoReceipt: false, drawer: true, kitchenTicket: false });
    if (!p.token) { p.token = randomToken(16); store.save(); }
    return p;
  };
  const cols = () => (cfg().paper === 58 ? 32 : 48);
  const queue = () => (S().printQueue ||= []);

  // ops を実際のプリンターへ。'none' のときは何もしない（画面側でAirPrint）
  async function print(ops, label = '印刷') {
    const p = cfg();
    if (p.type === 'none') return { sent: false };
    if (printerTransport) { await printerTransport(p, ops, { escpos: toEscPos(ops, cols()), xml: toEposXml(ops, cols()) }); return { sent: true }; }
    if (p.type === 'escpos-net') {
      if (!p.host) fail(400, 'プリンターのIPアドレスを設定してください');
      try {
        await sendTcp(p.host, p.port || 9100, toEscPos(ops, cols()));
      } catch (e) {
        notifyAdmin('print-error', { message: `${label}：${e.message}` });
        throw e;
      }
      return { sent: true };
    }
    if (p.type === 'epson-sdp') {
      queue().push({ id: newId('job_'), label, xml: toEposXml(ops, cols()), at: new Date().toISOString() });
      if (queue().length > 50) queue().splice(0, queue().length - 50);
      store.save();
      return { sent: true, queued: true };
    }
    return { sent: false };
  }
  const printQuiet = (ops, label) => print(ops, label).catch(() => {});

  // ---- 自動印刷・ドロア ----
  on('payment', ({ check, payment, closed }) => {
    const p = cfg();
    const ops = [];
    if (payment.method === '現金' && p.drawer) ops.push({ t: 'pulse' });
    if (closed && p.autoReceipt) ops.push(...receiptDoc(check, S().settings));
    if (ops.length) return printQuiet(ops, closed ? 'レシート' : 'ドロア');
    return undefined;
  });
  on('drawer', () => (cfg().drawer ? printQuiet([{ t: 'pulse' }], 'ドロア') : undefined));
  on('order', ({ check, order }) => {
    if (!cfg().kitchenTicket || !order.lines.some((l) => l.station !== 'other')) return undefined;
    return printQuiet(kitchenDoc(check, order, S().settings), 'キッチン伝票');
  });
  on('register-close', ({ entry }) => (cfg().type !== 'none' ? printQuiet([{ t: 'pulse' }, ...registerDoc(entry, S().settings)], '精算レシート') : undefined));

  onSettings((b, s) => {
    if (!b.printer) return;
    const cur = cfg();
    s.printer = {
      type: ['none', 'escpos-net', 'epson-sdp'].includes(b.printer.type) ? b.printer.type : 'none',
      host: str(b.printer.host, 60).replace(/[^\w.:-]/g, ''),
      port: clampInt(b.printer.port, 1, 65535, 9100),
      paper: Number(b.printer.paper) === 58 ? 58 : 80,
      autoReceipt: !!b.printer.autoReceipt, drawer: !!b.printer.drawer, kitchenTicket: !!b.printer.kitchenTicket,
      token: cur.token,
    };
  });

  // ---- 画面から ----
  route('POST', '/api/admin/print/receipt', ({ body }) => {
    let check = S().openChecks.find((c) => c.id === body.checkId);
    if (!check && body.date) check = store.getHistory(str(body.date, 10)).find((c) => c.id === body.checkId);
    if (!check) fail(404, '伝票が見つかりません');
    return print(receiptDoc(check, S().settings), 'レシート');
  });
  route('POST', '/api/admin/print/test', () => print(testDoc(S().settings), 'テスト印刷'));
  route('POST', '/api/admin/print/register', ({ body }) => {
    const entry = body.entry;
    if (!entry?.summary) fail(400, '印刷する内容がありません');
    return print(registerDoc(entry, S().settings, { title: entry.closedAt ? 'レジ精算' : 'レジ点検' }), 'レジ点検');
  });
  route('POST', '/api/admin/drawer/open', () => print([{ t: 'pulse' }], 'ドロア'));
  route('POST', '/api/admin/print/kitchen', ({ body }) => {
    const check = findOpen(str(body.checkId, 60));
    const order = check.orders.find((o) => o.id === body.orderId) || fail(404, '注文が見つかりません');
    return print(kitchenDoc(check, order, S().settings), 'キッチン伝票');
  });

  // ---- EPSON Server Direct Print：プリンターが定期的に取りに来る ----
  // プリンター設定の URL： https://（このサーバー）/api/printer/epson?token=（設定画面に表示）
  route('POST', '/api/printer/epson', ({ query, body, res }) => {
    if (!query.token || query.token !== cfg().token) fail(403, 'forbidden');
    const form = Object.fromEntries(new URLSearchParams(String(body || '')));
    if (form.ConnectionType === 'SetResponse') {
      const ok = /success="true"/.test(form.ResponseFile || '');
      if (!ok) notifyAdmin('print-error', { message: 'プリンターが印刷に失敗しました（用紙・カバーを確認してください）' });
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('');
    }
    const job = queue().shift();
    if (!job) { res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' }); return res.end(''); }
    store.save();
    res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
    return res.end(sdpRequestXml(job.id, job.xml));
  }, { raw: true });

  return {
    state: () => {
      const p = cfg();
      return { printer: { type: p.type, autoReceipt: p.autoReceipt, drawer: p.drawer, queued: queue().length } };
    },
    print,
  };
}
