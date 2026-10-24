"use client";

import { areaByOrientation, calculate, specValue, usedSpecs } from "./gaihi/calc";
import { ADJACENCY_LABEL, LAYER_CATEGORY_LABEL, ORIENTATION_LABEL, SPEC_KIND_LABEL } from "./gaihi/constants";
import type { Project } from "./gaihi/types";

/** 計算書を Excel（.xlsx）で作る。シート：結果 / 部位仕様 / 外皮面積 / 開口部 / 計算明細 */
export async function buildWorkbook(project: Project): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "外皮計算ツール";
  const r = calculate(project);

  const header = (ws: import("exceljs").Worksheet, cols: { header: string; key: string; width: number }[]) => {
    ws.columns = cols;
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3F3ED" } };
  };

  const sum = wb.addWorksheet("結果");
  sum.columns = [{ width: 30 }, { width: 18 }, { width: 18 }, { width: 18 }];
  sum.addRows([
    ["外皮性能計算書"],
    [],
    ["物件名", project.name],
    ["建設地", project.address],
    ["地域の区分", `${project.region}地域`],
    ["構造", project.structure],
    ["断熱構造", project.insulationType === "floor" ? "床断熱住戸" : "基礎断熱住戸"],
    ["延床面積 [㎡]", project.totalFloorArea],
    ["作成者", project.author],
    [],
    ["外皮面積の合計 ΣA [㎡]", r.totalArea],
    ["総熱損失量 q [W/K]", r.q],
    ["冷房期の日射熱取得量 mC", r.mC],
    ["暖房期の日射熱取得量 mH", r.mH ?? "―"],
    ["外皮平均熱貫流率 UA [W/(㎡・K)]", r.ua],
    ["冷房期の平均日射熱取得率 ηAC", r.etaAC],
    ["暖房期の平均日射熱取得率 ηAH", r.etaAH ?? "―"],
    ["熱損失係数 Q値（参考）", r.qValue ?? "―"],
    ["夏期日射取得係数 μ値（参考）", r.mu ?? "―"],
    [],
    ["基準", "UA 基準値", "ηAC 基準値", "判定"],
    ...r.judgments.map((j) => [j.label, j.uaStandard ?? "―", j.etaACStandard ?? "―", j.ok === null ? "―" : j.ok ? "適合" : "不適合"]),
  ]);
  sum.getCell("A1").font = { bold: true, size: 14 };
  sum.getRow(21).font = { bold: true };

  const specs = wb.addWorksheet("部位仕様");
  header(specs, [
    { header: "部位", key: "kind", width: 14 },
    { header: "仕様名", key: "name", width: 34 },
    { header: "U / ψ", key: "u", width: 10 },
    { header: "ηd", key: "etaD", width: 8 },
    { header: "算出方法", key: "method", width: 14 },
    { header: "材料構成・備考", key: "note", width: 60 },
  ]);
  for (const s of usedSpecs(project)) {
    specs.addRow({
      kind: SPEC_KIND_LABEL[s.kind],
      name: s.name,
      u: Number(specValue(s).toFixed(3)),
      etaD: s.kind === "window" ? s.etaD : "",
      method: s.method === "layers" ? "材料構成から計算" : "直接入力",
      note: [s.method === "layers" ? s.layers.map((l) => `${LAYER_CATEGORY_LABEL[l.category]}:${l.name} ${l.thickness}mm(λ${l.lambda})`).join(" / ") : "", s.note]
        .filter(Boolean)
        .join("　"),
    });
  }

  const sf = wb.addWorksheet("外皮面積");
  header(sf, [
    { header: "部位", key: "kind", width: 12 },
    { header: "名称", key: "name", width: 26 },
    { header: "方位", key: "o", width: 8 },
    { header: "隣接空間", key: "adj", width: 22 },
    { header: "面積[㎡]", key: "area", width: 10 },
    { header: "根拠", key: "basis", width: 60 },
  ]);
  for (const s of project.surfaces) {
    sf.addRow({ kind: SPEC_KIND_LABEL[s.kind], name: s.name, o: ORIENTATION_LABEL[s.orientation], adj: ADJACENCY_LABEL[s.adjacency], area: s.area, basis: s.basis });
  }
  sf.addRow({});
  sf.addRow({ kind: "方位", name: "外壁グロス", o: "", adj: "開口部", area: "正味外壁" });
  for (const [o, v] of areaByOrientation(project)) {
    sf.addRow({ kind: ORIENTATION_LABEL[o], name: v.wallGross, adj: v.opening, area: Number(v.wallNet.toFixed(3)) });
  }
  sf.addRow({});
  sf.addRow({ kind: "土間外周", name: "名称", o: "方位", adj: "隣接空間", area: "長さ[m]", basis: "根拠" });
  for (const p of project.perimeters) {
    sf.addRow({ kind: "", name: p.name, o: ORIENTATION_LABEL[p.orientation], adj: ADJACENCY_LABEL[p.adjacency], area: p.length, basis: p.basis });
  }

  const op = wb.addWorksheet("開口部");
  header(op, [
    { header: "名称", key: "name", width: 24 },
    { header: "種類", key: "kind", width: 8 },
    { header: "方位", key: "o", width: 8 },
    { header: "幅[m]", key: "w", width: 9 },
    { header: "高さ[m]", key: "h", width: 9 },
    { header: "個数", key: "n", width: 7 },
    { header: "面積[㎡]", key: "a", width: 10 },
    { header: "根拠", key: "basis", width: 40 },
  ]);
  for (const o of project.openings) {
    op.addRow({
      name: o.name,
      kind: o.kind === "door" ? "ドア" : "窓",
      o: ORIENTATION_LABEL[o.orientation],
      w: o.width,
      h: o.height,
      n: o.count,
      a: Number((o.width * o.height * o.count).toFixed(3)),
      basis: o.basis,
    });
  }

  const det = wb.addWorksheet("計算明細");
  header(det, [
    { header: "部位", key: "kind", width: 12 },
    { header: "名称", key: "name", width: 26 },
    { header: "方位", key: "o", width: 8 },
    { header: "A/L", key: "a", width: 10 },
    { header: "U/ψ", key: "u", width: 9 },
    { header: "H", key: "h", width: 6 },
    { header: "A・U・H", key: "q", width: 10 },
    { header: "η冷", key: "ec", width: 8 },
    { header: "ν冷", key: "nc", width: 8 },
    { header: "m冷", key: "mc", width: 10 },
    { header: "η暖", key: "eh", width: 8 },
    { header: "ν暖", key: "nh", width: 8 },
    { header: "m暖", key: "mh", width: 10 },
  ]);
  const n3 = (x: number | null) => (x === null ? "―" : Number(x.toFixed(3)));
  for (const row of r.rows) {
    det.addRow({
      kind: SPEC_KIND_LABEL[row.kind],
      name: row.name,
      o: ORIENTATION_LABEL[row.orientation],
      a: n3(row.amount),
      u: n3(row.value),
      h: row.h,
      q: n3(row.q),
      ec: n3(row.etaC),
      nc: n3(row.nuC),
      mc: n3(row.mC),
      eh: n3(row.etaH),
      nh: n3(row.nuH),
      mh: n3(row.mH),
    });
  }
  det.addRow({ kind: "合計", a: n3(r.totalArea), q: n3(r.q), mc: n3(r.mC), mh: n3(r.mH) }).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
