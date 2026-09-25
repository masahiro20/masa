// 土地さがしナビで扱うデータ構造。
// 物件項目は「土地バンク」型の土地情報（所在地・価格・面積・法令制限・接道など）を基準に正規化している。

export type Direction = '北' | '北東' | '東' | '南東' | '南' | '南西' | '西' | '北西';

export interface RoadAccess {
  direction?: Direction;
  /** 道路幅員 (m) */
  width?: number;
  /** 間口・接道長さ (m) */
  frontage?: number;
  kind?: '公道' | '私道' | '不明';
  /** 建築基準法上の道路種別 例: "42条1項1号", "42条2項" */
  article?: string;
}

export interface StationAccess {
  line?: string;
  name: string;
  /** 駅（またはバス停）からの徒歩分数 */
  walk?: number;
  /** バス乗車分数（バス便の場合） */
  bus?: number;
}

export type CityPlanning = '市街化区域' | '市街化調整区域' | '非線引き区域' | '都市計画区域外';
export type FireZone = '防火地域' | '準防火地域' | '法22条区域' | '指定なし';

export interface Listing {
  id: string;
  /** 取得元アダプタID（sample / import / url など） */
  source: string;
  sourceLabel: string;
  url?: string;
  title: string;

  prefecture: string;
  city: string;
  /** 町名・丁目まで（番地は通常非公開） */
  address: string;
  lat?: number;
  lng?: number;

  /** 価格（万円） */
  price: number;
  /** 土地面積（㎡） */
  landArea: number;
  landAreaNote?: string;

  stations: StationAccess[];

  zoning?: string;
  /** 建ぺい率 (%) */
  coverageRatio?: number;
  /** 容積率 (%) */
  floorAreaRatio?: number;
  cityPlanning?: CityPlanning;
  fireZone?: FireZone;
  heightDistrict?: string;

  roads: RoadAccess[];
  /** 地目 */
  landCategory?: string;
  shape?: '整形地' | '不整形地' | '旗竿地';
  terrain?: '平坦' | '高低差あり' | '傾斜地' | 'ひな壇';
  /** 建築条件付きか */
  buildingCondition?: boolean;
  /** 現況 例: 更地 / 古家あり */
  status?: string;
  rights?: string;
  delivery?: string;
  otherRestrictions?: string[];
  notes?: string;
  updatedAt?: string;
}

/* ---------------- 検索条件 ---------------- */

export type Importance = 'must' | 'want' | 'nice';

export type CriterionKey =
  | 'location'
  | 'price'
  | 'landArea'
  | 'walk'
  | 'roadWidth'
  | 'zoning'
  | 'sunlight'
  | 'shape'
  | 'buildingCondition'
  | 'hazard';

export type HazardTolerance = 'strict' | 'normal' | 'any';

export interface AreaSelection {
  prefecture: string;
  /** 省略時は都道府県全域 */
  city?: string;
}

export interface SearchConditions {
  customerName?: string;
  areas: AreaSelection[];
  priceMin?: number;
  priceMax?: number;
  /** ㎡ */
  areaMin?: number;
  areaMax?: number;
  walkMax?: number;
  roadWidthMin?: number;
  /** 希望する用途地域グループ */
  zoningGroups?: ZoningGroup[];
  southFacing?: boolean;
  regularShape?: boolean;
  noBuildingCondition?: boolean;
  excludeUrbanControl?: boolean;
  hazardTolerance?: HazardTolerance;
  importance: Partial<Record<CriterionKey, Importance>>;
}

export type ZoningGroup = 'lowRise' | 'midRise' | 'residential' | 'commercial' | 'industrial';

/* ---------------- 評価結果 ---------------- */

export type CriterionStatus = 'match' | 'near' | 'miss' | 'unknown';

export interface CriterionResult {
  key: CriterionKey;
  label: string;
  importance: Importance;
  status: CriterionStatus;
  detail: string;
}

/** high=優先度：高（全条件一致）, medium=中, low=低, out=対象外 */
export type Rank = 'high' | 'medium' | 'low' | 'out';

export interface EvaluatedListing {
  listing: Listing;
  rank: Rank;
  score: number;
  criteria: CriterionResult[];
  hazard?: HazardSummary;
  derived: {
    tsubo: number;
    pricePerTsubo: number;
    pricePerSqm: number;
  };
}

export interface SearchResponse {
  conditions: SearchConditions;
  results: EvaluatedListing[];
  counts: Record<Rank, number>;
  sources: { id: string; label: string; count: number; error?: string }[];
  generatedAt: string;
}

/* ---------------- ハザード ---------------- */

export type HazardLayerKey =
  | 'flood'
  | 'floodDuration'
  | 'houseCollapseFlow'
  | 'houseCollapseErosion'
  | 'stormSurge'
  | 'tsunami'
  | 'debrisFlow'
  | 'steepSlope'
  | 'landslide';

export interface HazardLayerResult {
  key: HazardLayerKey;
  label: string;
  /** inside=地点が区域内, nearby=半径約50m以内に区域あり, none=該当なし, unknown=取得失敗 */
  status: 'inside' | 'nearby' | 'none' | 'unknown';
  /** 浸水深ランク・警戒区域種別など */
  level?: string;
  /** 0=なし 1=軽微 2=注意 3=重大 */
  severity: 0 | 1 | 2 | 3;
}

export type HazardOverall = 'low' | 'moderate' | 'high' | 'unknown';

export interface HazardSummary {
  overall: HazardOverall;
  /** 浸水想定の最大深さラベル（洪水・高潮・津波の最大） */
  maxInundation?: string;
  sediment?: '警戒区域' | '特別警戒区域';
  badges: { label: string; severity: 1 | 2 | 3 }[];
}

export interface HazardReport extends HazardSummary {
  lat: number;
  lng: number;
  layers: HazardLayerResult[];
  elevation?: number;
  /** 戸建て計画の観点からの見解 */
  opinions: { title: string; body: string; severity: 1 | 2 | 3 }[];
  portalUrl: string;
  fetchedAt: string;
}

/* ---------------- 法令・条例 ---------------- */

export type RegulationCategory = '用途地域' | '建ぺい率・容積率' | '高さ・斜線' | '防火' | '接道' | '条例' | '土地・造成' | 'その他';

export interface RegulationItem {
  category: RegulationCategory;
  title: string;
  detail: string;
  severity: 'info' | 'caution' | 'warning';
  basis?: string;
  /** 自治体により内容が異なるため個別確認が必要 */
  needsCheck?: boolean;
  link?: string;
}

export interface VolumeEstimate {
  siteArea: number;
  setbackArea: number;
  effectiveArea: number;
  coverageRatio?: number;
  coverageBonus: number;
  floorAreaRatio?: number;
  roadLimitedFAR?: number;
  effectiveFAR?: number;
  maxBuildingArea?: number;
  maxFloorArea?: number;
  notes: string[];
}

export interface RegulationReport {
  items: RegulationItem[];
  volume: VolumeEstimate;
}

/* ---------------- 地域特性 ---------------- */

export interface FacilityStat {
  key: string;
  label: string;
  count: number;
  nearestName?: string;
  nearestMeters?: number;
}

export interface AreaReport {
  headline: string;
  points: { title: string; body: string }[];
  facilities?: FacilityStat[];
  facilitiesError?: string;
  cityProfile?: string;
}

export interface ListingInsight {
  listing: Listing;
  hazard?: HazardReport;
  hazardError?: string;
  regulations: RegulationReport;
  area: AreaReport;
  proposal: { summary: string; strengths: string[]; concerns: string[]; nextSteps: string[] };
  aiAvailable: boolean;
}
