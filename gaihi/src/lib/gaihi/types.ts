// 外皮計算のデータモデル。1物件 = 1 Project。

/** 8方位 + 上面（屋根・天井）+ 下面（床） */
export type Orientation = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "TOP" | "BOTTOM";

export type Region = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * 隣接空間の種類（温度差係数 H を決める）
 * - outside: 外気・外気に通じる空間（小屋裏・天井裏など）
 * - underfloor: 外気に通じる床裏（床下）
 * - unheated: 外気に通じていない空間（車庫・物置など）
 * - neighbor: 住戸及び住戸と同様の熱的環境の空間
 */
export type Adjacency = "outside" | "underfloor" | "unheated" | "neighbor";

export type SpecKind =
  | "roof" // 屋根（屋根断熱）
  | "ceiling" // 天井（天井断熱）
  | "wall" // 外壁
  | "floor" // 床（床断熱）
  | "baseWall" // 基礎壁（基礎断熱部分の立上り）
  | "doma" // 土間床（面積のみ外皮面積に算入、熱損失は外周部 ψ で計上）
  | "window" // 窓
  | "door" // ドア
  | "perimeter"; // 土間床等の外周部（線熱貫流率 ψ）

export interface Layer {
  id: string;
  name: string;
  /** 厚さ [mm] */
  thickness: number;
  /** 熱伝導率 λ [W/(m・K)] */
  lambda: number;
  /** 熱橋部（柱・間柱・大引など）でこの層が置き換わる材料の λ。null なら一般部と同じ */
  bridgeLambda: number | null;
}

export interface Spec {
  id: string;
  kind: SpecKind;
  name: string;
  /** direct: U(ψ) を直接入力 / layers: 材料構成から計算 */
  method: "direct" | "layers";
  /** 熱貫流率 U [W/(㎡・K)]（direct のとき使用） */
  u: number;
  /** 線熱貫流率 ψ [W/(m・K)]（perimeter のとき使用） */
  psi: number;
  /** 垂直面日射熱取得率 ηd（窓のとき使用） */
  etaD: number;
  /** 取得日射熱補正係数（冷房期 / 暖房期）。窓のとき使用 */
  fC: number;
  fH: number;
  layers: Layer[];
  /** 室内側 / 外気側 表面熱伝達抵抗 [㎡K/W] */
  ri: number;
  ro: number;
  /** 一般部（断熱部）の面積比率 0〜1。残りが熱橋部 */
  ratio: number;
  note: string;
}

export interface Surface {
  id: string;
  name: string;
  kind: Exclude<SpecKind, "window" | "door" | "perimeter">;
  specId: string;
  orientation: Orientation;
  /** 開口部を含むグロス面積 [㎡] */
  area: number;
  adjacency: Adjacency;
  /** 拾いの根拠（例: X0-X6 5,460mm × 5.60m） */
  basis: string;
}

export interface Opening {
  id: string;
  name: string;
  kind: "window" | "door";
  specId: string;
  orientation: Orientation;
  /** 幅・高さ [m] */
  width: number;
  height: number;
  count: number;
  /** 取り付く外壁（Surface.id）。開口部面積はこの外壁から差し引く */
  surfaceId: string | null;
  basis: string;
}

export interface Perimeter {
  id: string;
  name: string;
  specId: string;
  orientation: Orientation;
  /** 長さ [m] */
  length: number;
  adjacency: Adjacency;
  basis: string;
}

export interface Project {
  id: string;
  name: string;
  address: string;
  author: string;
  region: Region;
  structure: string;
  insulationType: "floor" | "foundation";
  totalFloorArea: number;
  specs: Spec[];
  surfaces: Surface[];
  openings: Opening[];
  perimeters: Perimeter[];
  /** 図面読み取り時のメモ・要確認事項 */
  notes: string[];
  createdAt: string;
  updatedAt: string;
}
