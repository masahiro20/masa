/* 請求書の計算とPDF生成。ブラウザ（アプリ画面）とNode（テスト）の両方で使う。
 * PDFは和文標準フォント（HeiseiKakuGo-W5 / UniJIS-UCS2-H）を埋め込まずに参照するため、
 * フォントファイル不要で数KBに収まる。 */
(function (root) {
  "use strict";

  // ---------- 日付・金額 ----------
  const pad = (n) => String(n).padStart(2, "0");
  const yen = (n) => Math.round(n).toLocaleString("ja-JP");

  function todayJST(now = new Date()) {
    const d = new Date(now.getTime() + 9 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  function addMonths(ym, delta) {
    const [y, m] = ym.split("-").map(Number);
    const t = y * 12 + (m - 1) + delta;
    return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
  }
  function monthEnd(ym) {
    const [y, m] = ym.split("-").map(Number);
    return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
  }
  function slashDate(iso) { return iso.replace(/-/g, "/"); }
  function jpDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return `${y}年${m}月${d}日`;
  }
  // 請求日から請求対象月を決める（前月分 or 当月分）
  function billingMonthFor(issueDate, settings) {
    const ym = issueDate.slice(0, 7);
    return (settings.billingMonth || "previous") === "previous" ? addMonths(ym, -1) : ym;
  }
  function dueDateFor(issueDate, settings) {
    const ym = issueDate.slice(0, 7);
    return monthEnd(settings.due === "end_of_next_month" ? addMonths(ym, 1) : ym);
  }
  function fill(tpl, vars) {
    return String(tpl || "").replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  }

  // 請求書1通分の数字を全部計算する
  function calc(inv, settings) {
    const c = inv.client;
    const [year, month] = inv.ym.split("-").map(Number);
    const vars = { year, month };
    const rate = settings.taxRate ?? 0.1;
    const items = (c.items || []).map((it) => {
      const quantity = Number(it.quantity ?? 1);
      const unitPrice = Number(it.unitPrice);
      return { name: fill(it.name, vars), quantity, unitPrice, amount: quantity * unitPrice,
        date: it.date || "", unit: it.unit || "", note: it.note || "" };
    });
    const gross = items.reduce((s, i) => s + i.amount, 0);
    let subtotal, tax, total;
    if (settings.pricesIncludeTax !== false) {
      total = gross;
      tax = Math.floor((total * rate) / (1 + rate)); // 内税: 1円未満切り捨て
      subtotal = total - tax;
      // 明細は税抜で表示する。端数の差は最後の行で合わせる
      let rest = subtotal;
      items.forEach((it, i) => {
        const net = i === items.length - 1 ? rest : Math.round(it.amount / (1 + rate));
        rest -= net;
        it.netAmount = net;
        it.netUnitPrice = it.quantity ? Math.round(net / it.quantity) : net;
      });
    } else {
      subtotal = gross;
      tax = Math.floor(subtotal * rate);
      total = subtotal + tax;
      items.forEach((it) => { it.netAmount = it.amount; it.netUnitPrice = it.unitPrice; });
    }
    const dueDate = inv.dueDate || dueDateFor(inv.issueDate, settings);
    const recipient = `${c.name} ${c.honorific || "御中"}`;
    const lines = (t) => String(t || "").split("\n").map((x) => x.trim()).filter(Boolean);
    const mailVars = {
      ...vars, client_name: recipient, contact: c.contact || "", total: yen(total),
      greeting: c.greeting || [recipient, c.contact].filter(Boolean).join("\n"),
      due_date: jpDate(dueDate), issuer_name: settings.name || "", invoice_no: inv.no,
    };
    return {
      year, month, items, subtotal, tax, total, rate, dueDate, recipient, lines,
      subject: fill(c.subject, vars),
      mailSubject: fill(settings.mailSubject, mailVars),
      mailBody: fill(settings.mailBody, mailVars),
      // ファイル名はこれまでドライブに保存してきた形に統一: 「ルミネル御中_26_8月請求書.pdf」
      filename: `${c.name}${c.honorific || "御中"}_${String(year).slice(2)}_${month}月請求書.pdf`,
    };
  }

  // ---------- PDF ----------
  const A4 = { w: 595.28, h: 841.89 };
  const MM = 72 / 25.4;

  // HeiseiKakuGo-W5 の欧文プロポーショナル幅（UniJIS-UCS2-H では U+0020..U+007E が CID 1..95）
  const W_1_16 = [277, 305, 500, 668, 668, 906, 727, 305, 445, 445, 508, 668, 305, 379, 305, 539];
  const W_27 = [305, 305, 668, 668, 668, 566, 871, 727, 637, 652, 699, 574, 555, 676, 687, 242, 492, 664, 582, 789,
    707, 734, 582, 734, 605, 605, 641, 668, 727, 945, 609, 609, 574, 445, 668, 445, 668, 668, 590, 555, 609, 547,
    602, 574, 391, 609, 582, 234, 277, 539, 234, 895, 582, 605, 602, 602, 387, 508, 441, 582, 562, 781, 531, 570,
    555, 449, 246, 449, 668];
  const charW = (ch) => {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c <= 0x2f) return W_1_16[c - 0x20];
    if (c >= 0x30 && c <= 0x39) return 668;
    if (c >= 0x3a && c <= 0x7e) return W_27[c - 0x3a];
    if (c >= 0xff61 && c <= 0xff9f) return 500;
    return 1000;
  };
  const textW = (s, size) => ([...s].reduce((a, ch) => a + charW(ch), 0) * size) / 1000;
  const hex = (s) => {
    let out = "";
    for (let i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).padStart(4, "0");
    return out.toUpperCase();
  };
  const num = (n) => (Math.round(n * 100) / 100).toString();
  const rgb = (h) => [1, 3, 5].map((i) => num(parseInt(h.slice(i, i + 2), 16) / 255)).join(" ");

  function wrap(s, size, maxW) {
    const lines = [];
    let cur = "";
    for (const ch of s) {
      if (textW(cur + ch, size) > maxW && cur) { lines.push(cur); cur = ""; }
      cur += ch;
    }
    if (cur || !lines.length) lines.push(cur);
    return lines;
  }

  function Canvas() {
    const ops = [];
    // y は上端からの距離(pt)で指定する
    const Y = (y) => A4.h - y;
    return {
      ops,
      text(x, y, s, size, { align = "left", color = "#1d2430" } = {}) {
        s = String(s);
        const w = textW(s, size);
        const tx = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
        ops.push(`BT ${rgb(color)} rg /F1 ${num(size)} Tf ${num(tx)} ${num(Y(y))} Td <${hex(s)}> Tj ET`);
      },
      line(x1, y1, x2, y2, { width = 0.5, color = "#9aa0a6" } = {}) {
        ops.push(`${rgb(color)} RG ${num(width)} w ${num(x1)} ${num(Y(y1))} m ${num(x2)} ${num(Y(y2))} l S`);
      },
      rect(x, y, w, h, { fill, stroke, width = 0.5 } = {}) {
        let op = "";
        if (fill) op += `${rgb(fill)} rg `;
        if (stroke) op += `${rgb(stroke)} RG ${num(width)} w `;
        op += `${num(x)} ${num(Y(y + h))} ${num(w)} ${num(h)} re ${fill && stroke ? "B" : fill ? "f" : "S"}`;
        ops.push(op);
      },
    };
  }

  function drawInvoice(cv, inv, settings, r) {
    const L = 34, R = A4.w - 34, INK = "#1a1a1a", RULE = "#9a9a9a", LIGHT = "#cfcfcf";
    const c = inv.client, lines = r.lines;

    cv.text(A4.w / 2, 50, "請求書", 20, { align: "center", color: INK });

    // 宛先（左）
    let y = 88;
    cv.text(L, y, r.recipient, 11);
    y += 20;
    for (const s of [c.postal && `〒${String(c.postal).replace(/^〒/, "")}`, ...lines(c.address), c.contact].filter(Boolean)) {
      cv.text(L, y, s, 9.5); y += 13.5;
    }

    // 発行者（右）
    const RX = 432;
    let ry = 84;
    cv.text(RX, ry, settings.name || "", 9.5); ry += 13;
    if (settings.registrationNumber) { cv.text(RX, ry, `登録番号:${settings.registrationNumber}`, 9.5); ry += 13; }
    ry += 7;
    const addr = [settings.postal && `〒${String(settings.postal).replace(/^〒/, "")}`, ...lines(settings.address),
      settings.tel && `TEL: ${settings.tel}`].filter(Boolean);
    for (const s of addr) { cv.text(RX, ry, s, 9.5); ry += 13; }
    ry = Math.max(ry + 14, 186);
    [["請求書番号:", inv.no], ["請求日:", slashDate(inv.issueDate)], ["お支払期限:", slashDate(r.dueDate)]].forEach(([k, v]) => {
      cv.text(RX, ry, k, 9.5); cv.text(RX + 52, ry, v, 9.5); ry += 12;
    });

    // 件名・ご請求金額
    y = Math.max(y, ry) + 26;
    cv.text(L, y, `件名: ${r.subject}`, 10.5);
    y += 20;
    cv.rect(L, y, R - L, 38, { stroke: RULE, width: 0.8 });
    cv.text(L + 14, y + 24, "ご請求金額", 12.5);
    cv.text(L + 96, y + 24, `${yen(r.total)} 円`, 12.5);

    // 明細
    y += 64;
    const X = { date: L, name: L + 70, price: 355, qty: 408, unit: 418, amount: R };
    cv.text(X.date, y, "納品日", 8.5); cv.text(X.name, y, "品目・納品書番号", 8.5);
    cv.text(X.price, y, "単価", 8.5, { align: "right" }); cv.text(X.qty, y, "数量", 8.5, { align: "right" });
    cv.text(X.unit, y, "単位", 8.5); cv.text(X.amount, y, "価格", 8.5, { align: "right" });
    y += 5; cv.line(L, y, R, y, { color: RULE });
    for (const it of r.items) {
      const nameLines = wrap(it.name, 9, X.price - X.name - 60);
      if (it.date) cv.text(X.date, y + 14, slashDate(it.date), 9);
      if (it.unit) cv.text(X.unit, y + 14, it.unit, 9);
      nameLines.forEach((s, i) => cv.text(X.name, y + 14 + i * 12, s, 9));
      if (it.note) cv.text(X.name, y + 14 + nameLines.length * 12 - 1, it.note, 7.5, { color: "#8a8a8a" });
      cv.text(X.price, y + 14, yen(it.netUnitPrice), 9, { align: "right" });
      cv.text(X.qty, y + 14, yen(it.quantity), 9, { align: "right" });
      cv.text(X.amount, y + 14, yen(it.netAmount), 9, { align: "right" });
      y += 8 + nameLines.length * 12 + 2 + (it.note ? 11 : 0);
    }
    y += 12;

    // 合計（右）
    const SX = 326;
    cv.line(SX, y, R, y, { color: RULE });
    cv.text(SX + 4, y + 15, "小計", 9); cv.text(R, y + 15, yen(r.subtotal), 9, { align: "right" });
    cv.text(SX + 4, y + 33, "消費税額合計", 9); cv.text(R, y + 33, yen(r.tax), 9, { align: "right" });
    cv.line(SX, y + 42, R, y + 42, { color: RULE });
    cv.text(SX + 4, y + 62, "合計", 10.5); cv.text(R, y + 62, yen(r.total), 12, { align: "right" });
    cv.line(SX, y + 72, R, y + 72, { color: RULE });

    // 税率別内訳（左）
    const TX = [L, L + 60, 170, 228, 286];
    const ty = y + 28;
    cv.text(L, ty, "税率別内訳", 7.5);
    cv.line(L, ty + 5, TX[4], ty + 5, { color: LIGHT });
    ["税抜金額", "消費税額", "税込金額"].forEach((h, i) => cv.text(TX[i + 2], ty + 16, h, 6.5, { align: "right" }));
    cv.line(L, ty + 21, TX[4], ty + 21, { color: LIGHT });
    cv.text(L + 2, ty + 32, `${Math.round(r.rate * 100)}%`, 7);
    [r.subtotal, r.tax, r.total].forEach((v, i) => cv.text(TX[i + 2], ty + 32, yen(v), 7, { align: "right" }));
    cv.line(L + 58, ty + 5, L + 58, ty + 37, { color: LIGHT });
    cv.line(L, ty + 37, TX[4], ty + 37, { color: LIGHT });

    // 振込先・備考
    y += 104;
    cv.text(L, y, "振込先", 9);
    const bank = lines(settings.bank);
    const bh = Math.max(46, 14 + bank.length * 12);
    cv.rect(L, y + 6, R - L, bh, { stroke: LIGHT, width: 0.8 });
    bank.forEach((s, i) => cv.text(L + 10, y + 22 + i * 12, s, 9.5));
    y += bh + 30;
    cv.text(L, y, "備考", 9);
    const memo = lines(c.memo || settings.memo);
    const mh = Math.max(24, 12 + memo.length * 12);
    cv.rect(L, y + 6, R - L, mh, { stroke: LIGHT, width: 0.8 });
    memo.forEach((s, i) => cv.text(L + 10, y + 20 + i * 12, s, 9));

    cv.text(A4.w / 2, A4.h - 24, "1 / 1", 9, { align: "center" });
  }

  // 請求書PDFを作り、PDFのバイト列をlatin1文字列で返す（中身はすべてASCII）
  function buildPdf(inv, settings) {
    const r = calc(inv, settings);
    const cv = Canvas();
    drawInvoice(cv, inv, settings, r);
    const content = cv.ops.join("\n");
    const title = `請求書 ${inv.no}`;
    const objs = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>`,
      "<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5-UniJIS-UCS2-H /Encoding /UniJIS-UCS2-H /DescendantFonts [5 0 R] >>",
      `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 6 0 R /DW 1000 /W [1 [${W_1_16.join(" ")}] 17 26 668 27 [${W_27.join(" ")}] 231 632 500] >>`,
      "<< /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 /FontBBox [-92 -250 1010 922] /ItalicAngle 0 /Ascent 752 /Descent -221 /CapHeight 737 /StemV 114 >>",
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      `<< /Title <FEFF${hex(title)}> /Author <FEFF${hex(settings.name || "")}> /Producer (invoice-app) >>`,
    ];
    let out = "%PDF-1.4\n";
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return { pdf: out, r };
  }

  function pdfBase64(pdf) {
    return typeof btoa === "function" ? btoa(pdf) : Buffer.from(pdf, "latin1").toString("base64");
  }

  root.InvoiceCore = {
    yen, todayJST, slashDate, addMonths, monthEnd, jpDate, billingMonthFor, dueDateFor, fill, calc, buildPdf, pdfBase64,
  };
})(typeof window !== "undefined" ? window : globalThis);
