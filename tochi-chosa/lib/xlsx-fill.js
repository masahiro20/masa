// 既存の Excel ファイル（書式・チェックボックス・印刷設定）を壊さずに、
// セルの値とチェックボックスだけを書き換えるための小さなヘルパー。
// openpyxl や exceljs で読み書きするとフォームコントロールが消えるため、XML を直接編集する。
import JSZip from "jszip";

const xmlEscape = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const colNum = (col) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const splitRef = (ref) => {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  return { col: m[1], row: Number(m[2]) };
};

export async function openWorkbook(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const read = (p) => zip.file(p).async("string");
  const wb = {
    zip,
    files: {},
    async get(path) {
      if (!(path in this.files)) this.files[path] = await read(path);
      return this.files[path];
    },
    set(path, text) {
      this.files[path] = text;
    },
  };
  return wb;
}

export async function saveWorkbook(wb) {
  for (const [path, text] of Object.entries(wb.files)) wb.zip.file(path, text);
  return wb.zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// シート名 → シート XML のパス
export async function sheetPath(wb, name) {
  const book = await wb.get("xl/workbook.xml");
  const rels = await wb.get("xl/_rels/workbook.xml.rels");
  const m = book.match(new RegExp(`<sheet [^>]*name="${name}"[^>]*r:id="([^"]+)"`));
  if (!m) throw new Error(`シート「${name}」が見つかりません`);
  const t = rels.match(new RegExp(`Id="${m[1]}"[^>]*Target="([^"]+)"`)) || rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${m[1]}"`));
  return "xl/" + t[1].replace(/^\/?xl\//, "");
}

// セルの値を設定する。value が null/"" なら値を消す（書式は残す）。style を渡すとスタイル番号も差し替える
export function setCell(sheetXml, ref, value, style) {
  const { row } = splitRef(ref);
  const cellRe = new RegExp(`<c r="${ref}"(?=[ >/])([^>]*?)(/>|>[\\s\\S]*?</c>)`);
  let attrs = "";
  const m = sheetXml.match(cellRe);
  if (m) attrs = m[1].replace(/\s+t="[^"]*"/, "");
  if (style != null) attrs = attrs.match(/\ss="/) ? attrs.replace(/\ss="\d+"/, ` s="${style}"`) : `${attrs} s="${style}"`;

  let cell;
  if (value === null || value === undefined || value === "") cell = `<c r="${ref}"${attrs}/>`;
  else if (typeof value === "number") cell = `<c r="${ref}"${attrs}><v>${value}</v></c>`;
  else cell = `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;

  if (m) return sheetXml.replace(cellRe, cell);

  // セルが無い場合は行の中の正しい列位置に挿入
  const rowRe = new RegExp(`(<row r="${row}"[^>]*?)(/>|>([\\s\\S]*?)</row>)`);
  const r = sheetXml.match(rowRe);
  if (!r) throw new Error(`行 ${row} がテンプレートにありません`);
  const inner = r[3] || "";
  const cells = [...inner.matchAll(/<c r="([A-Z]+)\d+"[\s\S]*?(?:\/>|<\/c>)/g)];
  const target = colNum(splitRef(ref).col);
  const after = cells.find((c) => colNum(c[1]) > target);
  const newInner = after ? inner.replace(after[0], cell + after[0]) : inner + cell;
  return sheetXml.replace(rowRe, `${r[1]}>${newInner}</row>`);
}

// 既存スタイル（cellXfs の index）を複製し、配置だけ差し替えた新しいスタイル番号を返す
export async function addAlignedStyle(wb, baseIndex, alignmentXml) {
  let styles = await wb.get("xl/styles.xml");
  const block = styles.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  const xfs = block[2].match(/<xf [\s\S]*?(?:\/>|<\/xf>)/g);
  let xf = xfs[baseIndex].replace(/<alignment[^>]*\/>/, "").replace(/<\/xf>$/, "").replace(/\/>$/, ">");
  if (!/applyAlignment=/.test(xf)) xf = xf.replace("<xf ", '<xf applyAlignment="1" ');
  xf = `${xf}${alignmentXml}</xf>`;
  const count = Number(block[1]) + 1;
  styles = styles.replace(block[0], `<cellXfs count="${count}">${block[2]}${xf}</cellXfs>`);
  wb.set("xl/styles.xml", styles);
  return count - 1;
}

// フォームコントロールのチェックボックスを、シェイプ ID ごとにオン/オフする
export async function setCheckboxes(wb, sheetFile, checks) {
  const sheet = await wb.get(sheetFile);
  const relsPath = sheetFile.replace(/worksheets\//, "worksheets/_rels/") + ".rels";
  const rels = await wb.get(relsPath);
  const vmlRel = [...rels.matchAll(/<Relationship [^>]*>/g)].map((x) => x[0]).find((x) => /vmlDrawing/.test(x));
  const vmlPath = vmlRel ? "xl/" + vmlRel.match(/Target="\.\.\/([^"]+)"/)[1] : null;
  let vml = vmlPath ? await wb.get(vmlPath) : null;

  for (const [shapeId, on] of Object.entries(checks)) {
    const ctrl = sheet.match(new RegExp(`<control shapeId="${shapeId}" r:id="([^"]+)"`));
    if (ctrl) {
      const rel = rels.match(new RegExp(`Id="${ctrl[1]}"[^>]*Target="\\.\\./([^"]+)"`));
      if (rel) {
        const path = "xl/" + rel[1];
        let prop = await wb.get(path);
        prop = prop.replace(/\schecked="[^"]*"/, "");
        if (on) prop = prop.replace("<formControlPr ", '<formControlPr checked="Checked" ');
        wb.set(path, prop);
      }
    }
    if (vml) {
      const shapeRe = new RegExp(`(<v:shape id="_x0000_s${shapeId}"[\\s\\S]*?)(</x:ClientData>)`);
      vml = vml.replace(shapeRe, (all, head, end) => {
        const cleaned = head.replace(/<x:Checked>[^<]*<\/x:Checked>\s*/g, "");
        return on ? `${cleaned}<x:Checked>1</x:Checked>${end}` : `${cleaned}${end}`;
      });
    }
  }
  if (vml) wb.set(vmlPath, vml);
}

// 2列（項目・内容）の簡単なシートを追加する
export async function addSimpleSheet(wb, name, rows, { headStyle, bodyStyle, widths = [22, 90] } = {}) {
  let book = await wb.get("xl/workbook.xml");
  let rels = await wb.get("xl/_rels/workbook.xml.rels");
  let types = await wb.get("[Content_Types].xml");
  const ids = [...book.matchAll(/sheetId="(\d+)"/g)].map((m) => Number(m[1]));
  const sheetId = Math.max(...ids) + 1;
  const n = Object.keys(wb.zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).length + 1;
  const rid = `rIdAuto${sheetId}`;
  const path = `xl/worksheets/sheet${n}.xml`;

  const cellXml = (ref, v, s) =>
    v === "" || v == null
      ? `<c r="${ref}"${s != null ? ` s="${s}"` : ""}/>`
      : `<c r="${ref}"${s != null ? ` s="${s}"` : ""} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
  const rowsXml = rows
    .map((r, i) => {
      const s = r.head ? headStyle : bodyStyle;
      return `<row r="${i + 1}">${cellXml(`A${i + 1}`, r[0], s)}${cellXml(`B${i + 1}`, r[1], s)}</row>`;
    })
    .join("");
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>` +
    `<cols><col min="1" max="1" width="${widths[0]}" customWidth="1"/><col min="2" max="2" width="${widths[1]}" customWidth="1"/></cols>` +
    `<sheetData>${rowsXml}</sheetData>` +
    `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="9" orientation="portrait" fitToHeight="0"/></worksheet>`;

  wb.zip.file(path, xml);
  book = book.replace("</sheets>", `<sheet name="${xmlEscape(name)}" sheetId="${sheetId}" r:id="${rid}"/></sheets>`);
  rels = rels.replace(
    "</Relationships>",
    `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/></Relationships>`
  );
  types = types.replace(
    "</Types>",
    `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
  );
  wb.set("xl/workbook.xml", book);
  wb.set("xl/_rels/workbook.xml.rels", rels);
  wb.set("[Content_Types].xml", types);
}

// 開いたときに TODAY() などを再計算させる
export async function forceRecalc(wb) {
  let book = await wb.get("xl/workbook.xml");
  book = book.replace(/<calcPr([^>]*?)\s*\/>/, (all, attrs) =>
    /fullCalcOnLoad/.test(attrs) ? all : `<calcPr${attrs} fullCalcOnLoad="1"/>`
  );
  wb.set("xl/workbook.xml", book);
}
