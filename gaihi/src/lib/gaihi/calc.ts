import {
  ETA_AC_STANDARD,
  GRADES,
  OPAQUE_ETA_FACTOR,
  UA_STANDARD,
  nu,
  tempDiffFactor,
  type Grade,
} from "./constants";
import type { Opening, Orientation, Project, Spec, SpecKind, Surface } from "./types";

/** 浮動小数の誤差で 0.4500000001 が 0.46 に切り上がらないよう、わずかに丸めてから切り上げ／切り捨てする */
export function roundUp(x: number, digits: number): number {
  const p = 10 ** digits;
  return Math.ceil(Number((x * p).toFixed(6))) / p;
}

export function roundDown(x: number, digits: number): number {
  const p = 10 ** digits;
  return Math.floor(Number((x * p).toFixed(6))) / p;
}

export interface LayerPathResult {
  /** 一般部・熱橋部の熱抵抗の合計 [㎡K/W] */
  rGeneral: number;
  rBridge: number;
  u: number;
}

/** 材料構成から熱貫流率を求める（面積比率法：一般部と熱橋部を並列に扱う） */
export function layersU(spec: Pick<Spec, "layers" | "ri" | "ro" | "ratio">): LayerPathResult {
  let rGeneral = spec.ri + spec.ro;
  let rBridge = spec.ri + spec.ro;
  for (const l of spec.layers) {
    if (!(l.lambda > 0) || !(l.thickness > 0)) continue;
    const d = l.thickness / 1000;
    rGeneral += d / l.lambda;
    const lb = l.bridgeLambda && l.bridgeLambda > 0 ? l.bridgeLambda : l.lambda;
    rBridge += d / lb;
  }
  const ratio = Math.min(1, Math.max(0, spec.ratio));
  const u = rGeneral > 0 ? ratio / rGeneral + (rBridge > 0 ? (1 - ratio) / rBridge : 0) : 0;
  return { rGeneral, rBridge, u };
}

/** 仕様の熱貫流率 U（外周部は ψ） */
export function specValue(spec: Spec): number {
  if (spec.kind === "perimeter") return spec.psi;
  if (spec.kind === "doma") return 0;
  if (spec.method === "layers" && spec.layers.length > 0) return layersU(spec).u;
  return spec.u;
}

export function openingArea(o: Pick<Opening, "width" | "height" | "count">): number {
  return o.width * o.height * Math.max(1, o.count);
}

/** 開口部が差し引かれる外壁。未指定なら同じ方位の最初の外壁 */
export function hostSurface(project: Project, o: Opening): Surface | undefined {
  if (o.surfaceId) {
    const s = project.surfaces.find((x) => x.id === o.surfaceId);
    if (s) return s;
  }
  return project.surfaces.find((s) => s.kind === "wall" && s.orientation === o.orientation);
}

export interface ResultRow {
  group: "surface" | "opening" | "perimeter";
  id: string;
  name: string;
  kind: SpecKind;
  specName: string;
  orientation: Orientation;
  /** 面積 [㎡]（外周部は長さ [m]） */
  amount: number;
  /** U [W/㎡K]（外周部は ψ [W/mK]） */
  value: number;
  h: number;
  /** 熱損失 A×U×H [W/K] */
  q: number;
  /** 日射熱取得率 η（窓は ηd×f、その他は 0.034×U） */
  etaC: number;
  etaH: number;
  nuC: number;
  nuH: number | null;
  mC: number;
  mH: number | null;
}

export interface Judgment {
  grade: Grade;
  label: string;
  uaStandard: number | null;
  etaACStandard: number | null;
  uaOk: boolean | null;
  etaACOk: boolean | null;
  ok: boolean | null;
}

export interface CalcResult {
  rows: ResultRow[];
  /** 外皮の総面積 ΣA [㎡] */
  totalArea: number;
  /** 総熱損失量 q [W/K] */
  q: number;
  mC: number;
  mH: number | null;
  ua: number;
  etaAC: number;
  etaAH: number | null;
  uaRaw: number;
  etaACRaw: number;
  etaAHRaw: number | null;
  judgments: Judgment[];
  warnings: string[];
}

export function calculate(project: Project): CalcResult {
  const region = project.region;
  const specById = new Map(project.specs.map((s) => [s.id, s]));
  const rows: ResultRow[] = [];
  const warnings: string[] = [];

  // 外壁ごとの開口部面積
  const openingByHost = new Map<string, number>();
  let orphanOpeningArea = 0;
  for (const o of project.openings) {
    const host = hostSurface(project, o);
    const a = openingArea(o);
    if (host) {
      openingByHost.set(host.id, (openingByHost.get(host.id) ?? 0) + a);
    } else {
      orphanOpeningArea += a;
      warnings.push(`開口部「${o.name}」が取り付く外壁がありません（面積は外皮面積に加算しています）`);
    }
  }

  let totalArea = orphanOpeningArea;
  const push = (
    group: ResultRow["group"],
    id: string,
    name: string,
    spec: Spec | undefined,
    orientation: Orientation,
    amount: number,
    adjacency: Parameters<typeof tempDiffFactor>[0],
  ) => {
    if (!spec) {
      warnings.push(`「${name}」の仕様が選択されていません`);
      return;
    }
    const value = specValue(spec);
    const h = tempDiffFactor(adjacency, region);
    // 外気に接しない部位は日射を受けないので方位係数 0
    const exposed = adjacency === "outside";
    const nuC = exposed ? (nu("cooling", region, orientation) ?? 0) : 0;
    const nuHRaw = nu("heating", region, orientation);
    const nuH = nuHRaw === null ? null : exposed ? nuHRaw : 0;
    const isWindow = spec.kind === "window";
    const etaC = isWindow ? spec.etaD * spec.fC : OPAQUE_ETA_FACTOR * value;
    const etaH = isWindow ? spec.etaD * spec.fH : OPAQUE_ETA_FACTOR * value;
    rows.push({
      group,
      id,
      name,
      kind: spec.kind,
      specName: spec.name,
      orientation,
      amount,
      value,
      h,
      q: amount * value * h,
      etaC,
      etaH,
      nuC,
      nuH,
      mC: amount * etaC * nuC,
      mH: nuH === null ? null : amount * etaH * nuH,
    });
  };

  for (const s of project.surfaces) {
    totalArea += s.area;
    const net = s.area - (openingByHost.get(s.id) ?? 0);
    if (net < -1e-9) warnings.push(`「${s.name}」は開口部面積が外壁面積を超えています`);
    push("surface", s.id, s.name, specById.get(s.specId), s.orientation, Math.max(0, net), s.adjacency);
  }
  for (const o of project.openings) {
    const spec = specById.get(o.specId);
    const host = hostSurface(project, o);
    push("opening", o.id, o.name, spec, o.orientation, openingArea(o), host?.adjacency ?? "outside");
  }
  for (const p of project.perimeters) {
    push("perimeter", p.id, p.name, specById.get(p.specId), p.orientation, p.length, p.adjacency);
  }

  const q = rows.reduce((a, r) => a + r.q, 0);
  const mC = rows.reduce((a, r) => a + r.mC, 0);
  const heatingAvailable = region !== 8;
  const mH = heatingAvailable ? rows.reduce((a, r) => a + (r.mH ?? 0), 0) : null;

  const uaRaw = totalArea > 0 ? q / totalArea : 0;
  const etaACRaw = totalArea > 0 ? (mC / totalArea) * 100 : 0;
  const etaAHRaw = mH === null ? null : totalArea > 0 ? (mH / totalArea) * 100 : 0;
  // 端数処理：UA は小数第3位以下切り上げ、ηAC は小数第2位以下切り上げ、ηAH は小数第2位以下切り捨て
  const ua = roundUp(uaRaw, 2);
  const etaAC = roundUp(etaACRaw, 1);
  const etaAH = etaAHRaw === null ? null : roundDown(etaAHRaw, 1);

  if (totalArea === 0) warnings.push("外皮面積が入力されていません");

  const judgments: Judgment[] = GRADES.map(({ key, label }) => {
    const uaStandard = UA_STANDARD[key][region - 1];
    const etaACStandard = ETA_AC_STANDARD[key][region - 1];
    const uaOk = uaStandard === null ? null : ua <= uaStandard;
    const etaACOk = etaACStandard === null ? null : etaAC <= etaACStandard;
    const checks = [uaOk, etaACOk].filter((x): x is boolean => x !== null);
    return {
      grade: key,
      label,
      uaStandard,
      etaACStandard,
      uaOk,
      etaACOk,
      ok: checks.length === 0 ? null : checks.every(Boolean),
    };
  });

  return { rows, totalArea, q, mC, mH, ua, etaAC, etaAH, uaRaw, etaACRaw, etaAHRaw, judgments, warnings };
}

/** 方位別の面積集計（計算書の「方位別外皮面積表」用） */
export function areaByOrientation(project: Project) {
  const result = new Map<Orientation, { wallGross: number; opening: number; wallNet: number }>();
  const get = (o: Orientation) => {
    let v = result.get(o);
    if (!v) {
      v = { wallGross: 0, opening: 0, wallNet: 0 };
      result.set(o, v);
    }
    return v;
  };
  for (const s of project.surfaces) if (s.kind === "wall") get(s.orientation).wallGross += s.area;
  for (const o of project.openings) {
    const host = hostSurface(project, o);
    get(host?.orientation ?? o.orientation).opening += openingArea(o);
  }
  for (const v of result.values()) v.wallNet = v.wallGross - v.opening;
  return result;
}
