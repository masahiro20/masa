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

/**
 * 層のカテゴリ
 * - board: 面材（せっこうボード・合板など）。一般部・熱橋部の両方に入る
 * - fill: 充填断熱材。一般部だけに入る
 * - frame: 軸材（柱・間柱・垂木・大引など）。熱橋部で充填断熱材の代わりに入る
 * - external: 外張断熱材・付加断熱材。一般部・熱橋部の両方に入る
 * - air: 空気層など。一般部・熱橋部の両方に入る（熱抵抗を直接入れたいときは厚さ・λで調整）
 */
export type LayerCategory = "board" | "fill" | "frame" | "external" | "air";

export interface Layer {
  id: string;
  category: LayerCategory;
  name: string;
  /** 厚さ [mm] */
  thickness: number;
  /** 熱伝導率 λ [W/(m・K)] */
  lambda: number;
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

export interface Ventilation {
  /** 気積 [㎥]（0 なら延床面積 × 2.4m で概算） */
  volume: number;
  /** 機械換気回数 [回/h] */
  rate: number;
  /** 熱交換換気の温度交換効率 0〜1（熱交換なしは 0） */
  heatRecovery: number;
  /** 相当隙間面積 C値 [c㎡/㎡] */
  cValue: number;
}

export interface Project {
  id: string;
  name: string;
  address: string;
  /** 作成者（計算者） */
  author: string;
  /** 建築主 */
  client: string;
  /** 設計者（建築士事務所・建築士名など） */
  designer: string;
  /** 地上階数 */
  floors: number;
  /** 記入年月日 YYYY-MM-DD */
  date: string;
  region: Region;
  structure: string;
  /** 構法 */
  framing: "jikugumi" | "wakugumi";
  /** 建物の振り：0° は東西南北、45° は北東・南東・南西・北西に面する */
  rotation: 0 | 45;
  /** 屋根断熱か天井断熱か */
  topInsulation: "roof" | "ceiling" | "both";
  insulationType: "floor" | "foundation";
  /** オーバーハング床（外気に接する床）の有無 */
  overhang: boolean;
  ventilation: Ventilation;
  totalFloorArea: number;
  /** 主たる居室・その他の居室の床面積 [㎡]（一次エネルギー消費量の計算＝WEBプログラムに入れる値） */
  mainRoomArea: number;
  otherRoomArea: number;
  specs: Spec[];
  surfaces: Surface[];
  openings: Opening[];
  perimeters: Perimeter[];
  /** 図面読み取り時のメモ・要確認事項 */
  notes: string[];
  createdAt: string;
  updatedAt: string;
}
