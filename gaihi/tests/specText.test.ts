import { describe, expect, it } from "vitest";
import { layersU } from "@/lib/gaihi/calc";
import { MATERIALS } from "@/lib/gaihi/constants";
import { newProject } from "@/lib/gaihi/defaults";
import { specFromText, specTemplates } from "@/lib/gaihi/specText";
import { applyExtraction } from "@/lib/extract/toProject";
import type { Extraction } from "@/lib/extract/schema";

describe("断熱材の選択肢", () => {
  it("セルロースファイバーを充填断熱材として選べる", () => {
    const names = MATERIALS.filter((m) => m.category === "fill").map((m) => m.name);
    expect(names.some((n) => n.includes("セルロースファイバー"))).toBe(true);
  });

  it("テンプレートにセルロースの外壁があり、U値が計算できる", () => {
    const t = specTemplates().find((s) => s.kind === "wall" && s.name.includes("セルロース") && s.name.includes("105"))!;
    expect(t).toBeDefined();
    const u = layersU(t).u;
    // 一般部 0.11+0.0125/0.221+0.105/0.040+0.009/0.16+0.11、熱橋部は木材 → 0.42 前後
    expect(u).toBeGreaterThan(0.4);
    expect(u).toBeLessThan(0.45);
  });
});

describe("図面の仕様書きから仕様を作る", () => {
  it("入山様邸の外壁（セルローズファイバー・厚さ記載なし）", () => {
    const r = specFromText("wall", "防火サイディング16mm＋セルローズファイバー（JIS A 9523）＋屋内側PB12.5")!;
    expect(r.label).toBe("セルロースファイバー");
    expect(r.assumedThickness).toBe(true);
    const fill = r.spec.layers.find((l) => l.category === "fill")!;
    expect(fill.name).toContain("セルロースファイバー 55K");
    expect(fill.thickness).toBe(105);
  });

  it("厚さが書いてあれば使う（サイディングやボードの厚さは拾わない）", () => {
    const r = specFromText("wall", "窯業系サイディング16mm＋高性能グラスウール16K 120mm＋PB12.5mm")!;
    expect(r.assumedThickness).toBe(false);
    expect(r.spec.layers.find((l) => l.category === "fill")!.thickness).toBe(120);
    expect(r.spec.layers.find((l) => l.category === "fill")!.name).toBe("高性能グラスウール 16K");
  });

  it("天井のセルロースは吹込み用、グラスウールの文字にウールの誤判定をしない", () => {
    expect(specFromText("ceiling", "セルロースファイバー 吹込み 200mm")!.spec.layers[1].name).toContain("25K");
    expect(specFromText("ceiling", "吹込み用グラスウール 300mm")!.spec.layers[1].name).toBe("吹込み用グラスウール 18K");
    expect(specFromText("floor", "")).toBeNull();
    expect(specFromText("floor", "記載なし")).toBeNull();
  });

  it("読み取り結果を取り込むと、外壁にセルロースの仕様が当たる", () => {
    const ex: Extraction = {
      project: { name: "t", address: "", region: 6, region_reason: "", total_floor_area_m2: 0, structure: "" },
      orientation_note: "",
      walls: [{ orientation: "S", label: "南", gross_area_m2: 30, adjacency: "outside", basis: "" }],
      openings: [],
      ceilings: [{ kind: "ceiling", label: "天井", area_m2: 50, basis: "" }],
      floors: [],
      domas: [],
      specs_found: { ceiling_or_roof: "", wall: "防火サイディング16mm＋セルローズファイバー＋PB12.5", floor: "", window: "", door: "", foundation: "" },
      warnings: [],
    };
    const p = applyExtraction(newProject(), ex);
    const wall = p.surfaces.find((s) => s.kind === "wall")!;
    expect(p.specs.find((s) => s.id === wall.specId)!.name).toContain("セルロースファイバー");
    expect(p.notes.some((n) => n.includes("標準の厚さを仮定"))).toBe(true);
    // 2回取り込んでも同じ仕様が増えない
    const again = applyExtraction(p, ex);
    expect(again.specs.filter((s) => s.name.includes("セルロースファイバー")).length).toBe(1);
  });
});
