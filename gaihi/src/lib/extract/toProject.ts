import { ORIENTATION_LABEL } from "../gaihi/constants";
import { newId, pickSpec } from "../gaihi/defaults";
import type { Opening, Perimeter, Project, Region, Surface } from "../gaihi/types";
import type { Extraction } from "./schema";

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * 図面から読み取った数量を物件データに流し込む。
 * 仕様（U値など）は物件側の仕様セットを使い、面積・寸法・方位は読み取り結果で置き換える。
 */
export function applyExtraction(base: Project, ex: Extraction): Project {
  const p: Project = structuredClone(base);
  const spec = (kind: Parameters<typeof pickSpec>[1], keyword?: string) => pickSpec(p.specs, kind, keyword)?.id ?? "";

  if (ex.project.name) p.name = ex.project.name;
  if (ex.project.address) p.address = ex.project.address;
  if (ex.project.region >= 1 && ex.project.region <= 8) p.region = ex.project.region as Region;
  if (ex.project.total_floor_area_m2 > 0) p.totalFloorArea = round3(ex.project.total_floor_area_m2);
  if (ex.project.structure) p.structure = ex.project.structure;

  const surfaces: Surface[] = [];
  for (const w of ex.walls) {
    surfaces.push({
      id: newId("sf"),
      name: w.label || `外壁 ${ORIENTATION_LABEL[w.orientation]}`,
      kind: "wall",
      specId: spec("wall"),
      orientation: w.orientation,
      area: round3(w.gross_area_m2),
      adjacency: w.adjacency,
      basis: w.basis,
    });
  }
  for (const c of ex.ceilings) {
    surfaces.push({
      id: newId("sf"),
      name: c.label || (c.kind === "roof" ? "屋根" : "天井"),
      kind: c.kind,
      specId: spec(c.kind) || spec(c.kind === "roof" ? "ceiling" : "roof"),
      orientation: "TOP",
      area: round3(c.area_m2),
      adjacency: "outside",
      basis: c.basis,
    });
  }
  for (const f of ex.floors) {
    surfaces.push({
      id: newId("sf"),
      name: f.label || "床",
      kind: "floor",
      specId: spec("floor"),
      orientation: "BOTTOM",
      area: round3(f.area_m2),
      adjacency: f.adjacency,
      basis: f.basis,
    });
  }

  const perimeters: Perimeter[] = [];
  for (const d of ex.domas) {
    const useLabel = d.use === "bath" ? "浴室" : "玄関";
    surfaces.push({
      id: newId("sf"),
      name: d.label || `${useLabel}土間`,
      kind: "doma",
      specId: spec("doma"),
      orientation: "BOTTOM",
      area: round3(d.area_m2),
      adjacency: "underfloor",
      basis: d.basis,
    });
    for (const e of d.perimeters) {
      const outside = e.adjacency === "outside";
      perimeters.push({
        id: newId("pm"),
        name: `${d.label || useLabel} 外周 ${outside ? ORIENTATION_LABEL[e.orientation] : "床下側"}`,
        specId: spec("perimeter", useLabel),
        orientation: outside ? e.orientation : "BOTTOM",
        length: round3(e.length_m),
        adjacency: e.adjacency,
        basis: d.basis,
      });
      // 外気に接する辺の基礎立上り（地上部分）は基礎壁として外皮に入れる
      if (outside && d.foundation_rise_m > 0) {
        surfaces.push({
          id: newId("sf"),
          name: `基礎壁 ${d.label || useLabel} ${ORIENTATION_LABEL[e.orientation]}`,
          kind: "baseWall",
          specId: spec("baseWall"),
          orientation: e.orientation,
          area: round3(e.length_m * d.foundation_rise_m),
          adjacency: "outside",
          basis: `${e.length_m}m × 立上り ${d.foundation_rise_m}m`,
        });
      }
    }
  }

  const wallFor = (o: Opening["orientation"]) => surfaces.find((s) => s.kind === "wall" && s.orientation === o)?.id ?? null;
  const openings: Opening[] = ex.openings.map((o) => ({
    id: newId("op"),
    name: o.label || (o.kind === "door" ? "ドア" : "窓"),
    kind: o.kind,
    specId: spec(o.kind),
    orientation: o.orientation,
    width: round3(o.width_m),
    height: round3(o.height_m),
    count: Math.max(1, o.count),
    surfaceId: wallFor(o.orientation),
    basis: o.basis,
  }));

  p.surfaces = surfaces;
  p.openings = openings;
  p.perimeters = perimeters;

  // 基本情報の選択肢も読み取り結果に合わせる
  const diagonal = ex.walls.filter((w) => w.orientation.length === 2).length;
  p.rotation = diagonal > ex.walls.length / 2 ? 45 : 0;
  const tops = new Set(ex.ceilings.map((c) => c.kind));
  if (tops.size > 0) p.topInsulation = tops.size === 2 ? "both" : tops.has("roof") ? "roof" : "ceiling";
  p.overhang = ex.floors.some((f) => f.adjacency === "outside");

  const specLines = Object.entries({
    "天井/屋根": ex.specs_found.ceiling_or_roof,
    外壁: ex.specs_found.wall,
    床: ex.specs_found.floor,
    窓: ex.specs_found.window,
    ドア: ex.specs_found.door,
    基礎: ex.specs_found.foundation,
  })
    .filter(([, v]) => v)
    .map(([k, v]) => `図面の仕様（${k}）：${v}`);
  p.notes = [
    ...(ex.project.region_reason ? [`地域区分：${ex.project.region_reason}`] : []),
    ...(ex.orientation_note ? [`方位：${ex.orientation_note}`] : []),
    ...specLines,
    ...ex.warnings.map((w) => `要確認：${w}`),
  ];
  p.updatedAt = new Date().toISOString();
  return p;
}
