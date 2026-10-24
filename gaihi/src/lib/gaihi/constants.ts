import type { Adjacency, Orientation, Region, SpecKind } from "./types";

// 数値の出典：建築物省エネ法 住宅部分の外皮性能の評価方法（平成28年基準・解説書）。
// 申請に使う前に、最新の告示・解説書の表と突き合わせて確認すること。

export const REGIONS: Region[] = [1, 2, 3, 4, 5, 6, 7, 8];

export const ORIENTATIONS: { key: Orientation; label: string }[] = [
  { key: "N", label: "北" },
  { key: "NE", label: "北東" },
  { key: "E", label: "東" },
  { key: "SE", label: "南東" },
  { key: "S", label: "南" },
  { key: "SW", label: "南西" },
  { key: "W", label: "西" },
  { key: "NW", label: "北西" },
  { key: "TOP", label: "上面" },
  { key: "BOTTOM", label: "下面" },
];

export const ORIENTATION_LABEL: Record<Orientation, string> = Object.fromEntries(
  ORIENTATIONS.map((o) => [o.key, o.label]),
) as Record<Orientation, string>;

export const WALL_ORIENTATIONS: Orientation[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

type EightDir = Exclude<Orientation, "TOP" | "BOTTOM">;

/** 冷房期の方位係数 νc（地域 1〜8） */
const NU_COOLING: Record<EightDir, number[]> = {
  N: [0.329, 0.341, 0.335, 0.322, 0.373, 0.341, 0.307, 0.325],
  NE: [0.43, 0.412, 0.39, 0.426, 0.437, 0.431, 0.415, 0.414],
  E: [0.545, 0.503, 0.468, 0.518, 0.5, 0.512, 0.509, 0.515],
  SE: [0.56, 0.527, 0.487, 0.508, 0.5, 0.498, 0.49, 0.528],
  S: [0.502, 0.507, 0.476, 0.437, 0.472, 0.434, 0.412, 0.48],
  SW: [0.526, 0.548, 0.55, 0.481, 0.52, 0.491, 0.479, 0.517],
  W: [0.508, 0.529, 0.553, 0.481, 0.518, 0.504, 0.495, 0.505],
  NW: [0.411, 0.428, 0.447, 0.401, 0.442, 0.427, 0.406, 0.411],
};

/** 暖房期の方位係数 νH（地域 1〜7。8地域は暖房期の評価なし） */
const NU_HEATING: Record<EightDir, (number | null)[]> = {
  N: [0.26, 0.263, 0.284, 0.256, 0.238, 0.261, 0.227, null],
  NE: [0.333, 0.341, 0.348, 0.33, 0.31, 0.325, 0.281, null],
  E: [0.564, 0.554, 0.54, 0.531, 0.568, 0.579, 0.543, null],
  SE: [0.823, 0.766, 0.751, 0.724, 0.846, 0.833, 0.843, null],
  S: [0.935, 0.856, 0.851, 0.815, 0.983, 0.936, 1.023, null],
  SW: [0.79, 0.753, 0.75, 0.723, 0.815, 0.763, 0.848, null],
  W: [0.535, 0.544, 0.542, 0.527, 0.538, 0.523, 0.548, null],
  NW: [0.325, 0.341, 0.351, 0.326, 0.297, 0.317, 0.284, null],
};

/** 方位係数。上面は 1.0、下面は 0。8地域の暖房期は null。 */
export function nu(season: "cooling" | "heating", region: Region, o: Orientation): number | null {
  if (season === "heating" && region === 8) return null;
  if (o === "TOP") return 1.0;
  if (o === "BOTTOM") return 0;
  const table = season === "cooling" ? NU_COOLING : NU_HEATING;
  return table[o][region - 1];
}

/** 温度差係数 H */
export function tempDiffFactor(adj: Adjacency, region: Region): number {
  switch (adj) {
    case "outside":
      return 1.0;
    case "underfloor":
    case "unheated":
      return 0.7;
    case "neighbor":
      return region <= 3 ? 0.05 : 0.15;
  }
}

export const ADJACENCY_LABEL: Record<Adjacency, string> = {
  outside: "外気",
  underfloor: "床下（外気に通じる床裏）",
  unheated: "外気に通じていない空間",
  neighbor: "住戸と同様の熱的環境",
};

export type Grade = "kijun" | "g5" | "g6" | "g7";

export const GRADES: { key: Grade; label: string }[] = [
  { key: "kijun", label: "省エネ基準（断熱等級4）" },
  { key: "g5", label: "断熱等級5（ZEH水準）" },
  { key: "g6", label: "断熱等級6" },
  { key: "g7", label: "断熱等級7" },
];

/** UA の基準値（地域 1〜8、8地域は基準なし） */
export const UA_STANDARD: Record<Grade, (number | null)[]> = {
  kijun: [0.46, 0.46, 0.56, 0.75, 0.87, 0.87, 0.87, null],
  g5: [0.4, 0.4, 0.5, 0.6, 0.6, 0.6, 0.6, null],
  g6: [0.28, 0.28, 0.28, 0.34, 0.46, 0.46, 0.46, null],
  g7: [0.2, 0.2, 0.2, 0.23, 0.26, 0.26, 0.26, null],
};

/** ηAC の基準値（地域 1〜4 は基準なし） */
export const ETA_AC_STANDARD: Record<Grade, (number | null)[]> = {
  kijun: [null, null, null, null, 3.0, 2.8, 2.7, 6.7],
  g5: [null, null, null, null, 3.0, 2.8, 2.7, 6.7],
  g6: [null, null, null, null, 3.0, 2.8, 2.7, 5.1],
  g7: [null, null, null, null, 3.0, 2.8, 2.7, 5.1],
};

export const SPEC_KIND_LABEL: Record<SpecKind, string> = {
  roof: "屋根",
  ceiling: "天井",
  wall: "外壁",
  floor: "床",
  baseWall: "基礎壁",
  doma: "土間床",
  window: "窓",
  door: "ドア",
  perimeter: "土間床等の外周部",
};

/** 部位ごとの表面熱伝達抵抗の標準値 [㎡K/W]（Ri, Ro） */
export const SURFACE_RESISTANCE: Record<SpecKind, { ri: number; ro: number }> = {
  roof: { ri: 0.09, ro: 0.04 },
  ceiling: { ri: 0.09, ro: 0.09 },
  wall: { ri: 0.11, ro: 0.11 },
  floor: { ri: 0.15, ro: 0.15 },
  baseWall: { ri: 0.11, ro: 0.04 },
  doma: { ri: 0, ro: 0 },
  window: { ri: 0, ro: 0 },
  door: { ri: 0, ro: 0 },
  perimeter: { ri: 0, ro: 0 },
};

/** 木造軸組の一般部の面積比率（断熱部の割合）の標準値 */
export const DEFAULT_RATIO: Partial<Record<SpecKind, number>> = {
  roof: 0.86,
  ceiling: 1.0,
  wall: 0.83,
  floor: 0.85,
  baseWall: 1.0,
};

/** 取得日射熱補正係数の既定値（庇等を計算しない場合） */
export const DEFAULT_FC = 0.93;
export const DEFAULT_FH = 0.51;

/** 不透明部位の日射熱取得率 η = 0.034 × U */
export const OPAQUE_ETA_FACTOR = 0.034;

/** よく使う材料の熱伝導率 λ [W/(m・K)] */
export const MATERIALS: { name: string; lambda: number }[] = [
  { name: "高性能グラスウール 16K", lambda: 0.038 },
  { name: "高性能グラスウール 24K", lambda: 0.036 },
  { name: "グラスウール 10K", lambda: 0.05 },
  { name: "吹込み用グラスウール 18K", lambda: 0.052 },
  { name: "吹込み用セルローズファイバー 25K", lambda: 0.04 },
  { name: "ロックウール", lambda: 0.038 },
  { name: "押出法ポリスチレンフォーム 3種b", lambda: 0.028 },
  { name: "押出法ポリスチレンフォーム 1種", lambda: 0.04 },
  { name: "ビーズ法ポリスチレンフォーム 特号", lambda: 0.034 },
  { name: "硬質ウレタンフォーム 保温板2種", lambda: 0.024 },
  { name: "吹付け硬質ウレタンフォーム A種3", lambda: 0.04 },
  { name: "吹付け硬質ウレタンフォーム A種1H", lambda: 0.026 },
  { name: "フェノールフォーム 保温板1種2号", lambda: 0.02 },
  { name: "せっこうボード", lambda: 0.221 },
  { name: "構造用合板", lambda: 0.16 },
  { name: "OSB", lambda: 0.13 },
  { name: "木材（天然木材）", lambda: 0.12 },
  { name: "インシュレーションファイバー板", lambda: 0.052 },
  { name: "コンクリート", lambda: 1.6 },
  { name: "モルタル", lambda: 1.5 },
  { name: "窯業系サイディング", lambda: 0.24 },
];
