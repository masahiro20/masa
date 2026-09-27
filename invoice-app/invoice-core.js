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
      return { name: fill(it.name, vars), quantity, unitPrice, amount: quantity * unitPrice };
    });
    const gross = items.reduce((s, i) => s + i.amount, 0);
    let subtotal, tax, total;
    if (settings.pricesIncludeTax !== false) {
      total = gross;
      tax = Math.floor((total * rate) / (1 + rate)); // 内税: 1円未満切り捨て
      subtotal = total - tax;
    } else {
      subtotal = gross;
      tax = Math.floor(subtotal * rate);
      total = subtotal + tax;
    }
    const dueDate = inv.dueDate || dueDateFor(inv.issueDate, settings);
    const recipient = `${c.name} ${c.honorific || "御中"}`;
    const mailVars = {
      ...vars, client_name: recipient, contact: c.contact || "", total: yen(total),
      greeting: c.greeting || [recipient, c.contact].filter(Boolean).join("\n"),
      due_date: jpDate(dueDate), issuer_name: settings.name || "", invoice_no: inv.no,
    };
    return {
      year, month, items, subtotal, tax, total, rate, dueDate, recipient,
      subject: fill(c.subject, vars),
      mailSubject: fill(settings.mailSubject, mailVars),
      mailBody: fill(settings.mailBody, mailVars),
      filename: `${c.name}${c.honorific || "御中"} ${year}.${pad(month)}ご請求書.pdf`,
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
    const L = 20 * MM, R = A4.w - 20 * MM, W = R - L;
    const INK = "#1d2430", MUTED = "#5b6470", RULE = "#b9bec4", TINT = "#eef1f4", HEAD = "#2b3645";

    cv.text(A4.w / 2, 70, "請 求 書", 22, { align: "center" });

    // 宛先
    cv.text(L, 118, r.recipient, 14);
    cv.line(L, 126, L + 95 * MM, 126, { width: 0.8, color: INK });
    if (inv.client.contact) cv.text(L, 142, inv.client.contact, 10);

    // 請求番号・日付
    cv.text(R, 110, `請求番号：${inv.no}`, 9, { align: "right", color: MUTED });
    cv.text(R, 124, `請求日：${jpDate(inv.issueDate)}`, 9, { align: "right", color: MUTED });

    // 発行者
    const iss = [settings.name, settings.representative, settings.postal, settings.address,
      settings.tel && `TEL：${settings.tel}`, settings.email,
      settings.registrationNumber && `登録番号：${settings.registrationNumber}`].filter(Boolean);
    let y = 150;
    iss.forEach((s, i) => { cv.text(R, y, s, i === 0 ? 11 : 9, { align: "right" }); y += i === 0 ? 16 : 13; });

    // 件名と金額
    y = Math.max(y + 10, 226);
    if (r.subject) cv.text(L, y, `件名：${r.subject}`, 10);
    cv.text(L, y + 16, "下記のとおりご請求申し上げます。", 10);
    y += 30;
    const bw1 = 45 * MM, bw2 = 60 * MM, bh = 30;
    cv.rect(L, y, bw1, bh, { fill: TINT, stroke: RULE });
    cv.rect(L + bw1, y, bw2, bh, { stroke: RULE });
    cv.text(L + 8, y + 19, "ご請求金額（税込）", 10);
    cv.text(L + bw1 + bw2 - 8, y + 21, `￥${yen(r.total)}-`, 16, { align: "right" });
    y += bh;
    cv.rect(L, y, bw1, 22, { fill: TINT, stroke: RULE });
    cv.rect(L + bw1, y, bw2, 22, { stroke: RULE });
    cv.text(L + 8, y + 15, "お支払期限", 10);
    cv.text(L + bw1 + bw2 - 8, y + 15, jpDate(r.dueDate), 10, { align: "right" });

    // 明細
    y += 44;
    const cols = [W - 70 * MM, 18 * MM, 26 * MM, 26 * MM];
    const xs = cols.reduce((a, w) => [...a, a[a.length - 1] + w], [L]);
    const hh = 20;
    cv.rect(L, y, W, hh, { fill: HEAD });
    ["品目", "数量", "単価", "金額"].forEach((h, i) =>
      cv.text((xs[i] + xs[i + 1]) / 2, y + 13.5, h, 9, { align: "center", color: "#ffffff" }));
    y += hh;
    for (const it of r.items) {
      const lines = wrap(it.name, 9, cols[0] - 12);
      const rh = Math.max(20, 8 + lines.length * 13);
      cv.rect(L, y, W, rh, { stroke: RULE });
      for (let i = 1; i < 4; i++) cv.line(xs[i], y, xs[i], y + rh, { color: RULE });
      lines.forEach((s, i) => cv.text(L + 6, y + 13.5 + i * 13, s, 9));
      cv.text(xs[2] - 6, y + 13.5, yen(it.quantity), 9, { align: "right" });
      cv.text(xs[3] - 6, y + 13.5, yen(it.unitPrice), 9, { align: "right" });
      cv.text(xs[4] - 6, y + 13.5, yen(it.amount), 9, { align: "right" });
      y += rh;
    }
    const sums = [
      ["小計（税抜）", r.subtotal], [`消費税（${Math.round(r.rate * 100)}%）`, r.tax], ["合計（税込）", r.total],
    ];
    sums.forEach(([label, v], i) => {
      const last = i === sums.length - 1;
      cv.rect(xs[2], y, cols[2], 20, { fill: TINT, stroke: RULE });
      cv.rect(xs[3], y, cols[3], 20, { stroke: RULE });
      cv.text(xs[3] - 6, y + 13.5, label, last ? 9 : 8.5, { align: "right" });
      cv.text(xs[4] - 6, y + 13.5, yen(v), last ? 10 : 9, { align: "right" });
      y += 20;
    });
    cv.text(L, y + 16, `10%対象 ${yen(r.total)}円（うち消費税 ${yen(r.tax)}円）`, 8.5, { color: MUTED });

    // 振込先
    y += 44;
    cv.text(L, y, "【お振込先】", 10);
    y += 16;
    for (const s of String(settings.bank || "").split("\n").filter((s) => s.trim())) {
      cv.text(L + 4, y, s.trim(), 10);
      y += 15;
    }
    cv.text(L, y + 6, "※お振込手数料は貴社にてご負担くださいますようお願いいたします。", 8, { color: MUTED });
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
    yen, todayJST, addMonths, monthEnd, jpDate, billingMonthFor, dueDateFor, fill, calc, buildPdf, pdfBase64,
  };
})(typeof window !== "undefined" ? window : globalThis);
