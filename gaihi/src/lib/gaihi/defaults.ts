import { DEFAULT_FC, DEFAULT_FH, DEFAULT_RATIO, SURFACE_RESISTANCE } from "./constants";
import type { Layer, Project, Spec, SpecKind } from "./types";

export function newId(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function blankSpec(kind: SpecKind, name: string): Spec {
  const sr = SURFACE_RESISTANCE[kind];
  return {
    id: newId("spec"),
    kind,
    name,
    method: "direct",
    u: 0,
    psi: 0,
    etaD: 0,
    fC: DEFAULT_FC,
    fH: DEFAULT_FH,
    layers: [],
    ri: sr.ri,
    ro: sr.ro,
    ratio: DEFAULT_RATIO[kind] ?? 1,
    note: "",
  };
}

export function layer(category: Layer["category"], name: string, thickness: number, lambda: number): Layer {
  return { id: newId("ly"), category, name, thickness, lambda };
}

/**
 * 既定の仕様セット。値は社内の「重説+省エネ+簡易計算シート_6地域_Superior」の仕様
 * （天井 U0.23 / 外壁 U0.41 / 床 U0.35 / 基礎壁 U0.50 / 窓 U1.47・ηd0.32 / ドア U1.79 / 土間外周 ψ0.65）に合わせている。
 */
export function defaultSpecs(): Spec[] {
  const ceiling = { ...blankSpec("ceiling", "天井（Superior）"), u: 0.23, note: "天井断熱" };
  const wall: Spec = {
    ...blankSpec("wall", "外壁（Superior）高性能GW16K 105mm"),
    method: "layers",
    u: 0.41,
    layers: [
      layer("board", "せっこうボード", 12.5, 0.221),
      layer("fill", "高性能グラスウール 16K", 105, 0.038),
      layer("frame", "天然木材", 105, 0.12),
      layer("board", "構造用合板", 9, 0.16),
    ],
    note: "柱・間柱間に充填断熱（熱橋部は木材 λ0.12）。外気側は通気層",
  };
  const roof: Spec = {
    ...blankSpec("roof", "屋根（垂木間 高性能GW16K 155mm）"),
    method: "layers",
    layers: [
      layer("board", "せっこうボード", 9.5, 0.221),
      layer("fill", "高性能グラスウール 16K", 155, 0.038),
      layer("frame", "天然木材", 155, 0.12),
      layer("board", "構造用合板", 12, 0.16),
    ],
    note: "屋根断熱にするときの例。仕様に合わせて直してください",
  };
  const floor = { ...blankSpec("floor", "床（Superior）"), u: 0.35, note: "床断熱（大引間）" };
  const baseWall = { ...blankSpec("baseWall", "基礎壁（玄関・浴室）"), u: 0.5 };
  const doma = { ...blankSpec("doma", "土間床（玄関・浴室）"), note: "熱損失は外周部 ψ で計上" };
  const window = {
    ...blankSpec("window", "窓（Superior）Low-E複層"),
    u: 1.47,
    etaD: 0.32,
    note: "日射遮蔽型 Low-E。ηd はメーカー値に置き換えてください",
  };
  const door = { ...blankSpec("door", "玄関ドア（Superior）"), u: 1.79 };
  const perimEntrance = { ...blankSpec("perimeter", "土間外周（玄関）"), psi: 0.65 };
  const perimBath = { ...blankSpec("perimeter", "土間外周（浴室）"), psi: 0.65 };
  return [ceiling, roof, wall, floor, baseWall, doma, window, door, perimEntrance, perimBath];
}

export function newProject(name = "新規物件"): Project {
  const now = new Date().toISOString();
  return {
    id: newId("prj"),
    name,
    address: "",
    author: "",
    date: now.slice(0, 10),
    region: 6,
    structure: "木造",
    framing: "jikugumi",
    rotation: 0,
    topInsulation: "ceiling",
    insulationType: "floor",
    overhang: false,
    ventilation: { volume: 0, rate: 0.5, heatRecovery: 0, cValue: 1.0 },
    totalFloorArea: 0,
    specs: defaultSpecs(),
    surfaces: [],
    openings: [],
    perimeters: [],
    notes: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 仕様セットから種類で最初の仕様を引く（名前に keyword を含むものを優先） */
export function pickSpec(specs: Spec[], kind: SpecKind, keyword?: string): Spec | undefined {
  const same = specs.filter((s) => s.kind === kind);
  if (keyword) {
    const hit = same.find((s) => s.name.includes(keyword));
    if (hit) return hit;
  }
  return same[0];
}

/** 動作確認用のサンプル物件（総2階 9.10m × 7.28m の架空の住宅） */
export function sampleProject(): Project {
  const p = newProject("サンプル邸（架空）");
  p.address = "愛知県小牧市（サンプル）";
  p.totalFloorArea = 132.48;
  const sp = (kind: SpecKind, kw?: string) => pickSpec(p.specs, kind, kw)!.id;
  const wallH = 5.8; // 基礎天端〜軒桁
  const mk = (
    kind: Project["surfaces"][number]["kind"],
    name: string,
    orientation: Project["surfaces"][number]["orientation"],
    area: number,
    basis: string,
    adjacency: Project["surfaces"][number]["adjacency"] = "outside",
  ) => ({ id: newId("sf"), name, kind, specId: sp(kind), orientation, area: Math.round(area * 1000) / 1000, adjacency, basis });
  p.surfaces = [
    mk("wall", "外壁 南", "S", 9.1 * wallH, "X0-X10 9,100mm × 5.80m"),
    mk("wall", "外壁 北", "N", 9.1 * wallH, "X0-X10 9,100mm × 5.80m"),
    mk("wall", "外壁 東", "E", 7.28 * wallH + 7.28 * 1.82 / 2, "Y0-Y8 7,280mm × 5.80m + 妻壁(高さ1.82m)"),
    mk("wall", "外壁 西", "W", 7.28 * wallH + 7.28 * 1.82 / 2, "Y0-Y8 7,280mm × 5.80m + 妻壁(高さ1.82m)"),
    mk("ceiling", "2階天井", "TOP", 66.24, "9.10m × 7.28m"),
    mk("floor", "1階床（床組部分）", "BOTTOM", 66.24 - 4.97, "1階床 66.24㎡ − 土間 4.97㎡", "underfloor"),
    mk("doma", "玄関土間", "BOTTOM", 2.48, "1.82m × 1.365m", "underfloor"),
    mk("doma", "浴室土間", "BOTTOM", 2.48, "1.82m × 1.365m", "underfloor"),
    mk("baseWall", "基礎壁 玄関 南", "S", 1.82 * 0.4, "1.82m × 立上り0.40m"),
    mk("baseWall", "基礎壁 浴室 北", "N", 1.82 * 0.4, "1.82m × 立上り0.40m"),
  ];
  const wallId = (o: string) => p.surfaces.find((s) => s.kind === "wall" && s.orientation === o)!.id;
  const win = (name: string, o: "N" | "E" | "S" | "W", w: number, h: number, count = 1) => ({
    id: newId("op"),
    name,
    kind: "window" as const,
    specId: sp("window"),
    orientation: o,
    width: w,
    height: h,
    count,
    surfaceId: wallId(o),
    basis: `W${Math.round(w * 1000)} × H${Math.round(h * 1000)}`,
  });
  p.openings = [
    win("LD 掃出し窓", "S", 2.56, 2.03, 2),
    win("洋室 腰窓", "S", 1.69, 1.17, 2),
    win("北 小窓", "N", 0.74, 0.57, 4),
    win("東 腰窓", "E", 1.69, 1.17, 2),
    win("西 縦すべり", "W", 0.405, 1.17, 2),
    {
      id: newId("op"),
      name: "玄関ドア",
      kind: "door",
      specId: sp("door"),
      orientation: "S",
      width: 0.922,
      height: 2.33,
      count: 1,
      surfaceId: wallId("S"),
      basis: "W922 × H2330",
    },
  ];
  p.perimeters = [
    { id: newId("pm"), name: "玄関 外周 南", specId: sp("perimeter", "玄関"), orientation: "S", length: 1.82, adjacency: "outside", basis: "玄関 外気に接する辺" },
    { id: newId("pm"), name: "玄関 外周 東", specId: sp("perimeter", "玄関"), orientation: "E", length: 1.365, adjacency: "outside", basis: "玄関 外気に接する辺" },
    { id: newId("pm"), name: "浴室 外周 北", specId: sp("perimeter", "浴室"), orientation: "N", length: 1.82, adjacency: "outside", basis: "浴室 外気に接する辺" },
    { id: newId("pm"), name: "浴室 外周 床下側", specId: sp("perimeter", "浴室"), orientation: "BOTTOM", length: 3.185, adjacency: "underfloor", basis: "浴室 床下に接する辺" },
  ];
  return p;
}

/** 古い形式・項目が欠けたデータを現在の形にそろえる（JSON 読み込みや保存データの互換用） */
export function normalizeProject(raw: Project): Project {
  const base = newProject(raw.name);
  const p: Project = { ...base, ...raw, ventilation: { ...base.ventilation, ...(raw.ventilation ?? {}) } };
  p.specs = (raw.specs ?? []).map((s) => ({
    ...blankSpec(s.kind, s.name),
    ...s,
    layers: (s.layers ?? []).map((l) => ({ ...l, category: l.category ?? "board" })),
  }));
  p.notes = raw.notes ?? [];
  return p;
}
