import { describe, expect, it } from "vitest";
import { calculate } from "@/lib/gaihi/calc";
import { newProject } from "@/lib/gaihi/defaults";
import { ExtractionSchema, extractionJsonSchema, type Extraction } from "@/lib/extract/schema";
import { applyExtraction } from "@/lib/extract/toProject";
import { classifyPage } from "@/lib/drawings";

const ex: Extraction = {
  project: { name: "テスト邸", address: "愛知県小牧市", region: 6, region_reason: "小牧市", total_floor_area_m2: 100, structure: "木造" },
  orientation_note: "上が北",
  walls: [
    { orientation: "S", label: "南", gross_area_m2: 40, adjacency: "outside", basis: "a" },
    { orientation: "N", label: "北", gross_area_m2: 40, adjacency: "outside", basis: "b" },
  ],
  openings: [
    { orientation: "S", kind: "window", label: "掃出し", width_m: 1.69, height_m: 2.03, count: 2, basis: "" },
    { orientation: "N", kind: "door", label: "玄関", width_m: 0.9, height_m: 2.3, count: 1, basis: "" },
  ],
  ceilings: [{ kind: "ceiling", label: "2階天井", area_m2: 50, basis: "" }],
  floors: [{ adjacency: "underfloor", label: "1階床", area_m2: 45, basis: "" }],
  domas: [
    {
      use: "bath",
      label: "浴室",
      area_m2: 3.3,
      perimeters: [
        { orientation: "N", adjacency: "outside", length_m: 1.82 },
        { orientation: "E", adjacency: "underfloor", length_m: 1.82 },
      ],
      foundation_rise_m: 0.4,
      basis: "",
    },
  ],
  specs_found: { ceiling_or_roof: "", wall: "高性能GW16K 105mm", floor: "", window: "", door: "", foundation: "" },
  warnings: ["窓サイズは推定"],
};

describe("図面の読み取り結果 → 物件データ", () => {
  it("スキーマに合う", () => {
    expect(ExtractionSchema.parse(ex)).toEqual(ex);
  });

  it("structured outputs 用の JSON Schema に数値範囲の制約が残っていない", () => {
    const s = JSON.stringify(extractionJsonSchema());
    expect(s).not.toContain("minimum");
    expect(s).not.toContain("maximum");
    expect(s).toContain('"additionalProperties":false');
  });

  it("各部位・開口部・外周部に展開され、仕様が割り当たる", () => {
    const p = applyExtraction(newProject(), ex);
    expect(p.name).toBe("テスト邸");
    expect(p.region).toBe(6);
    const kinds = p.surfaces.map((s) => s.kind).sort();
    expect(kinds).toEqual(["baseWall", "ceiling", "doma", "floor", "wall", "wall"]);
    expect(p.surfaces.every((s) => s.specId)).toBe(true);
    // 開口部は同じ方位の外壁に取り付く
    const south = p.surfaces.find((s) => s.kind === "wall" && s.orientation === "S")!;
    expect(p.openings.find((o) => o.kind === "window")!.surfaceId).toBe(south.id);
    // 床下側の外周は下面・床下として扱い、浴室用の ψ を使う
    const under = p.perimeters.find((x) => x.adjacency === "underfloor")!;
    expect(under.orientation).toBe("BOTTOM");
    expect(p.specs.find((s) => s.id === under.specId)!.name).toContain("浴室");
    // 外気側の外周には基礎壁（地上部分）が付く
    expect(p.surfaces.find((s) => s.kind === "baseWall")!.area).toBeCloseTo(1.82 * 0.4, 6);
    expect(p.notes.some((n) => n.includes("要確認"))).toBe(true);

    const r = calculate(p);
    expect(r.warnings).toEqual([]);
    expect(r.totalArea).toBeCloseTo(40 + 40 + 50 + 45 + 3.3 + 0.728, 6);
  });

  it("地域区分が判断できないときは元の値を残す", () => {
    const base = newProject();
    base.region = 5;
    const p = applyExtraction(base, { ...ex, project: { ...ex.project, region: 0 } });
    expect(p.region).toBe(5);
  });
});

describe("図面ページの種類推定", () => {
  it("図面名から判定する", () => {
    expect(classifyPage("1 階 平 面 図 S : 1 / 1 0 0")).toBe("plan");
    expect(classifyPage("東立面図 西立面図")).toBe("elevation");
    expect(classifyPage("矩計図")).toBe("section");
    expect(classifyPage("照明器具 1階")).toBe("other");
    expect(classifyPage("表紙 1階平面詳細図 立面図 配置図 建具仕様書 電気図面")).toBe("cover");
  });
});
