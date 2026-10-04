// 喫茶ヌア → ホームランディック の請求書PDFを作る。
// 使い方: node kissa-nua/make.js <設定JSON> <出力PDF>
// 設定JSON（住所・口座などの個人情報を含むため、リポジトリには置かない。前回のPDFを見て作る）:
//   { "issuer": {name, postal, address, tel, bank}, "client": {name, honorific, postal, address},
//     "no": "17", "issueDate": "YYYY-MM-DD", "dueDate": "YYYY-MM-DD", "ym": "YYYY-MM", "subject": "9月度御請求書",
//     "items": [{date, name, note, unitPrice(税込), quantity, unit}] }
require("../invoice-app/invoice-core.js");
const fs = require("fs");
const C = globalThis.InvoiceCore;
const [cfgPath, out] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const settings = { ...cfg.issuer, taxRate: 0.1, pricesIncludeTax: true };
const inv = { ym: cfg.ym, no: cfg.no, issueDate: cfg.issueDate, dueDate: cfg.dueDate,
  client: { ...cfg.client, subject: cfg.subject, items: cfg.items } };
const { pdf, r } = C.buildPdf(inv, settings);
fs.writeFileSync(out, pdf, "latin1");
console.log(`税抜 ${r.subtotal} / 消費税 ${r.tax} / 税込 ${r.total} / 期限 ${r.dueDate}`);
