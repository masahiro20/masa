import { describe, expect, it } from "vitest";
import { calculate, layersU, roundDown, roundUp, specValue } from "@/lib/gaihi/calc";
import { nu, tempDiffFactor } from "@/lib/gaihi/constants";
import { blankSpec, defaultSpecs, layer, newProject, normalizeProject, pickSpec, sampleProject } from "@/lib/gaihi/defaults";
import type { Project } from "@/lib/gaihi/types";

describe("端数処理", () => {
  it("切り上げ・切り捨てが浮動小数誤差に引きずられない", () => {
    expect(roundUp(0.45, 2)).toBe(0.45);
    expect(roundUp(0.4501, 2)).toBe(0.46);
    expect(roundUp(0.1 + 0.2, 1)).toBe(0.3);
    expect(roundDown(1.99999, 1)).toBe(1.9);
    expect(roundDown(2.0, 1)).toBe(2.0);
  });
});

describe("材料構成からの U 値", () => {
  it("高性能GW16K 105mm の外壁は社内シートの U0.41 と一致する", () => {
    const wall = pickSpec(defaultSpecs(), "wall")!;
    const r = layersU(wall);
    // 一般部（軸材を除く）: 0.11 + 0.0125/0.221 + 0.105/0.038 + 0.009/0.16 + 0.11
    expect(r.rGeneral).toBeCloseTo(0.11 + 0.0125 / 0.221 + 0.105 / 0.038 + 0.009 / 0.16 + 0.11, 6);
    // 熱橋部は充填断熱材の代わりに軸材（天然木材 λ0.12）
    expect(r.rBridge).toBeCloseTo(0.11 + 0.0125 / 0.221 + 0.105 / 0.12 + 0.009 / 0.16 + 0.11, 6);
    expect(r.hasBridge).toBe(true);
    expect(r.u).toBeCloseTo(0.83 / r.rGeneral + 0.17 / r.rBridge, 9);
    expect(r.u).toBeGreaterThan(0.405);
    expect(r.u).toBeLessThan(0.415);
  });

  it("軸材がない構成は面積比率を使わず一般部だけで計算する", () => {
    const s = { ...blankSpec("ceiling", "天井"), method: "layers" as const, ratio: 0.5, ri: 0.09, ro: 0.09, layers: [layer("fill", "吹込みGW", 200, 0.052)] };
    expect(layersU(s).u).toBeCloseTo(1 / (0.09 + 0.2 / 0.052 + 0.09), 9);
  });

  it("direct 指定の仕様は入力した U をそのまま使う", () => {
    const s = { ...blankSpec("ceiling", "天井"), u: 0.23 };
    expect(specValue(s)).toBe(0.23);
  });
});

describe("係数表", () => {
  it("6地域の方位係数", () => {
    expect(nu("cooling", 6, "S")).toBe(0.434);
    expect(nu("heating", 6, "S")).toBe(0.936);
    expect(nu("cooling", 6, "TOP")).toBe(1);
    expect(nu("cooling", 6, "BOTTOM")).toBe(0);
    expect(nu("heating", 8, "S")).toBeNull();
  });

  it("温度差係数", () => {
    expect(tempDiffFactor("outside", 6)).toBe(1);
    expect(tempDiffFactor("underfloor", 6)).toBe(0.7);
    expect(tempDiffFactor("neighbor", 2)).toBe(0.05);
    expect(tempDiffFactor("neighbor", 6)).toBe(0.15);
  });
});

/** 手計算できる最小構成：南の外壁 10㎡（窓 2㎡）+ 天井 10㎡ + 床 10㎡ + 外周 2m */
function tinyProject(): Project {
  const p = newProject("テスト");
  p.region = 6;
  const wall = { ...blankSpec("wall", "壁"), u: 0.5 };
  const ceil = { ...blankSpec("ceiling", "天井"), u: 0.2 };
  const floor = { ...blankSpec("floor", "床"), u: 0.4 };
  const win = { ...blankSpec("window", "窓"), u: 2.0, etaD: 0.5 };
  const perim = { ...blankSpec("perimeter", "外周"), psi: 0.6 };
  p.specs = [wall, ceil, floor, win, perim];
  p.surfaces = [
    { id: "w", name: "南壁", kind: "wall", specId: wall.id, orientation: "S", area: 10, adjacency: "outside", basis: "" },
    { id: "c", name: "天井", kind: "ceiling", specId: ceil.id, orientation: "TOP", area: 10, adjacency: "outside", basis: "" },
    { id: "f", name: "床", kind: "floor", specId: floor.id, orientation: "BOTTOM", area: 10, adjacency: "underfloor", basis: "" },
  ];
  p.openings = [
    { id: "o", name: "窓", kind: "window", specId: win.id, orientation: "S", width: 1, height: 1, count: 2, surfaceId: null, basis: "" },
  ];
  p.perimeters = [{ id: "p", name: "外周", specId: perim.id, orientation: "S", length: 2, adjacency: "outside", basis: "" }];
  return p;
}

describe("UA・ηAC・ηAH", () => {
  it("手計算と一致する", () => {
    const r = calculate(tinyProject());
    // ΣA = 壁10（窓込み）+ 天井10 + 床10
    expect(r.totalArea).toBe(30);
    // q = 壁 8×0.5 + 窓 2×2.0 + 天井 10×0.2 + 床 10×0.4×0.7 + 外周 2×0.6
    const q = 8 * 0.5 + 2 * 2.0 + 10 * 0.2 + 10 * 0.4 * 0.7 + 2 * 0.6;
    expect(r.q).toBeCloseTo(q, 9);
    expect(r.uaRaw).toBeCloseTo(q / 30, 9);
    expect(r.ua).toBe(roundUp(q / 30, 2));

    // 冷房期: 壁 8×0.034×0.5×0.434 + 窓 2×0.5×0.93×0.434 + 天井 10×0.034×0.2×1 + 外周 2×0.034×0.6×0.434（床は下面で 0）
    const mC = 8 * 0.034 * 0.5 * 0.434 + 2 * 0.5 * 0.93 * 0.434 + 10 * 0.034 * 0.2 + 2 * 0.034 * 0.6 * 0.434;
    expect(r.mC).toBeCloseTo(mC, 9);
    expect(r.etaAC).toBe(roundUp((mC / 30) * 100, 1));

    const mH = 8 * 0.034 * 0.5 * 0.936 + 2 * 0.5 * 0.51 * 0.936 + 10 * 0.034 * 0.2 + 2 * 0.034 * 0.6 * 0.936;
    expect(r.mH).toBeCloseTo(mH, 9);
    expect(r.etaAH).toBe(roundDown((mH / 30) * 100, 1));
  });

  it("開口部は同じ方位の外壁から差し引かれる", () => {
    const r = calculate(tinyProject());
    expect(r.rows.find((x) => x.id === "w")!.amount).toBe(8);
  });

  it("8地域は暖房期を評価しない", () => {
    const p = tinyProject();
    p.region = 8;
    const r = calculate(p);
    expect(r.etaAH).toBeNull();
    expect(r.judgments.find((j) => j.grade === "kijun")!.uaStandard).toBeNull();
  });

  it("基準判定", () => {
    const r = calculate(tinyProject());
    const kijun = r.judgments.find((j) => j.grade === "kijun")!;
    expect(kijun.uaStandard).toBe(0.87);
    expect(kijun.etaACStandard).toBe(2.8);
    expect(kijun.uaOk).toBe(r.ua <= 0.87);
  });

  it("取り付く外壁がない開口部は警告し、面積は外皮に加算する", () => {
    const p = tinyProject();
    p.openings[0].orientation = "N";
    const r = calculate(p);
    expect(r.totalArea).toBe(32);
    expect(r.warnings.some((w) => w.includes("取り付く外壁"))).toBe(true);
  });

  it("Q値は換気・漏気の熱損失を足して延床面積で割る", () => {
    const p = tinyProject();
    p.totalFloorArea = 10;
    p.ventilation = { volume: 24, rate: 0.5, heatRecovery: 0, cValue: 1 };
    const r = calculate(p);
    const vent = 0.35 * (0.5 + 1 * 0.1) * 24;
    expect(r.ventLoss).toBeCloseTo(vent, 9);
    expect(r.qValue).toBe(roundUp((r.q + vent) / 10, 2));
    expect(r.mu).toBe(roundUp(r.mC / 10, 3));
    p.ventilation.heatRecovery = 0.8;
    expect(calculate(p).ventLoss).toBeCloseTo(0.35 * (0.5 * 0.2 + 0.1) * 24, 9);
    p.totalFloorArea = 0;
    expect(calculate(p).qValue).toBeNull();
  });

  it("古い形式のデータを読み込んでも項目が補われる", () => {
    const old = { ...tinyProject() } as Partial<ReturnType<typeof tinyProject>>;
    delete old.ventilation;
    delete old.rotation;
    const p = normalizeProject(old as ReturnType<typeof tinyProject>);
    expect(p.ventilation.rate).toBe(0.5);
    expect(p.rotation).toBe(0);
    expect(calculate(p).ua).toBe(calculate(tinyProject()).ua);
  });

  it("サンプル物件は Superior 仕様で省エネ基準に適合する", () => {
    const r = calculate(sampleProject());
    expect(r.warnings).toEqual([]);
    expect(r.ua).toBeGreaterThan(0.3);
    expect(r.ua).toBeLessThanOrEqual(0.87);
    expect(r.judgments.find((j) => j.grade === "kijun")!.ok).toBe(true);
  });
});
