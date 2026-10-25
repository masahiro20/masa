import { usedSpecs, type CalcResult } from "./calc";
import { DEFAULT_FC, DEFAULT_FH, SPEC_KIND_LABEL } from "./constants";
import type { Project } from "./types";

// 申請に出す前の確認。審査で指摘されやすい「書いていない・根拠がない・つじつまが合わない」を拾う。
// error は直さないと申請に使えないもの、warn は審査で聞かれやすいもの。

export interface Check {
  level: "error" | "warn";
  message: string;
}

export function applicationChecks(project: Project, r: CalcResult): Check[] {
  const out: Check[] = [];
  const error = (message: string) => out.push({ level: "error", message });
  const warn = (message: string) => out.push({ level: "warn", message });

  // 基本事項
  const missing = [
    ["住宅名称", project.name],
    ["建設地", project.address],
    ["建築主", project.client],
    ["作成者", project.author],
  ].filter(([, v]) => !v.trim());
  if (missing.length) error(`基本事項が未入力です：${missing.map(([k]) => k).join("・")}`);
  if (!project.designer.trim()) warn("設計者が未入力です（建築士事務所名・建築士名）");
  if (!(project.totalFloorArea > 0)) error("延床面積が入力されていません");
  if (!(project.mainRoomArea > 0) || !(project.otherRoomArea > 0)) {
    warn("主たる居室・その他の居室の床面積が未入力です（一次エネルギー消費量の計算に必要）");
  } else if (project.mainRoomArea + project.otherRoomArea > project.totalFloorArea + 1e-6) {
    error("主たる居室とその他の居室の床面積の合計が、延床面積を超えています");
  }

  // 計算そのもの
  for (const w of r.warnings) error(w);
  if (!r.rows.some((x) => x.kind === "window")) warn("窓が1つも入力されていません");
  if (!r.rows.some((x) => x.kind === "wall")) error("外壁が入力されていません");
  if (!r.rows.some((x) => x.kind === "ceiling" || x.kind === "roof")) error("屋根・天井が入力されていません");
  const hasDoma = project.surfaces.some((s) => s.kind === "doma");
  if (hasDoma && project.perimeters.length === 0) error("土間床があるのに、土間床等の外周部（ψ）が入力されていません");
  if (project.insulationType === "foundation" && project.perimeters.length === 0) error("基礎断熱なのに、基礎の外周部（ψ）が入力されていません");
  if (project.insulationType === "floor" && !r.rows.some((x) => x.kind === "floor")) warn("床断熱なのに、床が入力されていません");

  // 根拠（面積の拾い・開口部の寸法）
  const noBasis = project.surfaces.filter((s) => !s.basis.trim()).map((s) => s.name);
  if (noBasis.length) warn(`面積の根拠（寸法・求積）が書かれていない部位があります：${noBasis.slice(0, 5).join("、")}${noBasis.length > 5 ? ` ほか${noBasis.length - 5}件` : ""}`);

  // 仕様の根拠
  for (const s of usedSpecs(project)) {
    const label = `【${SPEC_KIND_LABEL[s.kind]}】${s.name}`;
    if (s.kind === "window" || s.kind === "door") {
      if (!s.note.trim()) warn(`${label}：U値・日射熱取得率の根拠（試験値・カタログ値・告示の表など）が書かれていません`);
      if (s.kind === "window" && !(s.etaD > 0)) error(`${label}：日射熱取得率 ηd が入力されていません`);
      if (s.kind === "window" && (s.fC !== DEFAULT_FC || s.fH !== DEFAULT_FH) && !/庇|ひさし|補正/.test(s.note)) {
        warn(`${label}：取得日射熱補正係数が既定値（${DEFAULT_FC}・${DEFAULT_FH}）ではありません。庇等の計算根拠を添付してください`);
      }
    } else if (s.kind === "perimeter") {
      if (!(s.psi > 0)) error(`${label}：線熱貫流率 ψ が入力されていません`);
    } else if (s.kind !== "doma") {
      if (s.method === "direct" && !s.note.trim()) warn(`${label}：U値を直接入力しています。根拠（計算書・カタログ等）を書いてください`);
      if (s.method === "layers" && s.layers.some((l) => !(l.lambda > 0) || !(l.thickness > 0))) error(`${label}：厚さか熱伝導率が 0 の材料があります`);
    }
  }

  // 図面読み取りの要確認事項
  if (project.notes.length) warn(`図面読み取りのメモが ${project.notes.length} 件残っています。確認して消してから申請してください`);

  return out;
}
