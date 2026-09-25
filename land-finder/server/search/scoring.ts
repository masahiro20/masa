// 希望条件と物件を突き合わせ、条件ごとの達成度・スコア・優先度ランクを算出する。
import type {
  CriterionKey,
  CriterionResult,
  CriterionStatus,
  EvaluatedListing,
  HazardSummary,
  Importance,
  Listing,
  Rank,
  SearchConditions,
} from '../../shared/types';
import { derive, formatManYen, round, sqmToTsubo } from '../../shared/units';
import { normalizeZoning, ZONING_GROUP_LABELS } from '../../shared/zoning';

export const CRITERION_LABELS: Record<CriterionKey, string> = {
  location: 'エリア',
  price: '価格',
  landArea: '土地面積',
  walk: '駅徒歩',
  roadWidth: '前面道路',
  zoning: '用途地域',
  sunlight: '南側接道',
  shape: '整形地',
  buildingCondition: '建築条件なし',
  hazard: 'ハザード',
};

export const DEFAULT_IMPORTANCE: Record<CriterionKey, Importance> = {
  location: 'must',
  price: 'must',
  landArea: 'want',
  walk: 'want',
  roadWidth: 'nice',
  zoning: 'want',
  sunlight: 'nice',
  shape: 'nice',
  buildingCondition: 'want',
  hazard: 'want',
};

const WEIGHT: Record<Importance, number> = { must: 3, want: 2, nice: 1 };
const STATUS_POINT: Record<CriterionStatus, number> = { match: 1, near: 0.55, unknown: 0.5, miss: 0 };

/** 「惜しい」と判定する許容幅 */
export const TOLERANCE = {
  priceOverRatio: 0.1,
  areaUnderRatio: 0.1,
  walkOverMinutes: 5,
  roadWidthUnder: 0.5,
};

type Evaluator = (l: Listing, c: SearchConditions, hazard?: HazardSummary) => { status: CriterionStatus; detail: string } | null;

const EVALUATORS: Record<CriterionKey, Evaluator> = {
  location(l, c) {
    if (!c.areas?.length) return null;
    const hit = c.areas.some((a) => a.prefecture === l.prefecture && (!a.city || l.city.startsWith(a.city)));
    if (hit) return { status: 'match', detail: `${l.prefecture}${l.city}` };
    return { status: 'miss', detail: `${l.prefecture}${l.city}（希望エリア外）` };
  },

  price(l, c) {
    if (c.priceMax == null && c.priceMin == null) return null;
    if (c.priceMax != null && l.price > c.priceMax) {
      const over = l.price - c.priceMax;
      const ratio = over / c.priceMax;
      return {
        status: ratio <= TOLERANCE.priceOverRatio ? 'near' : 'miss',
        detail: `予算超過 +${formatManYen(over)}（+${round(ratio * 100, 1)}%）`,
      };
    }
    if (c.priceMin != null && l.price < c.priceMin) {
      return { status: 'near', detail: `${formatManYen(l.price)}（下限を下回る）` };
    }
    return { status: 'match', detail: formatManYen(l.price) };
  },

  landArea(l, c) {
    if (c.areaMin == null && c.areaMax == null) return null;
    const label = `${round(l.landArea, 2)}㎡（${round(sqmToTsubo(l.landArea), 1)}坪）`;
    if (c.areaMin != null && l.landArea < c.areaMin) {
      const ratio = (c.areaMin - l.landArea) / c.areaMin;
      return {
        status: ratio <= TOLERANCE.areaUnderRatio ? 'near' : 'miss',
        detail: `${label}：希望より ${round(c.areaMin - l.landArea, 1)}㎡ 狭い`,
      };
    }
    if (c.areaMax != null && l.landArea > c.areaMax) {
      const ratio = (l.landArea - c.areaMax) / c.areaMax;
      return { status: ratio <= 0.2 ? 'near' : 'miss', detail: `${label}：希望上限より広い` };
    }
    return { status: 'match', detail: label };
  },

  walk(l, c) {
    if (c.walkMax == null) return null;
    const best = bestStation(l);
    if (!best) return { status: 'unknown', detail: '交通情報なし' };
    const label = `${best.name}${best.bus ? ` バス${best.bus}分+` : ' '}徒歩${best.walk}分`;
    if (best.bus) return { status: best.bus + (best.walk ?? 0) <= c.walkMax ? 'near' : 'miss', detail: `${label}（バス便）` };
    if (best.walk == null) return { status: 'unknown', detail: best.name };
    if (best.walk <= c.walkMax) return { status: 'match', detail: label };
    return {
      status: best.walk <= c.walkMax + TOLERANCE.walkOverMinutes ? 'near' : 'miss',
      detail: `${label}（希望+${best.walk - c.walkMax}分）`,
    };
  },

  roadWidth(l, c) {
    if (c.roadWidthMin == null) return null;
    const widths = l.roads.map((r) => r.width).filter((w): w is number => w != null);
    if (widths.length === 0) return { status: 'unknown', detail: '道路幅員の記載なし' };
    const w = Math.max(...widths);
    if (w >= c.roadWidthMin) return { status: 'match', detail: `幅員${w}m` };
    return {
      status: w >= c.roadWidthMin - TOLERANCE.roadWidthUnder ? 'near' : 'miss',
      detail: `幅員${w}m（希望${c.roadWidthMin}m以上）`,
    };
  },

  zoning(l, c) {
    if (!c.zoningGroups?.length) return null;
    const z = normalizeZoning(l.zoning);
    if (!z) return { status: 'unknown', detail: l.zoning || '用途地域の記載なし' };
    if (c.zoningGroups.includes(z.group)) return { status: 'match', detail: z.name };
    // 住居系を希望していて隣接する住居系グループなら「惜しい」
    const residentialGroups = ['lowRise', 'midRise', 'residential'];
    const near = residentialGroups.includes(z.group) && c.zoningGroups.some((g) => residentialGroups.includes(g));
    return {
      status: near ? 'near' : 'miss',
      detail: `${z.name}（希望: ${c.zoningGroups.map((g) => ZONING_GROUP_LABELS[g].split('（')[0]).join('・')}）`,
    };
  },

  sunlight(l, c) {
    if (!c.southFacing) return null;
    const dirs = l.roads.map((r) => r.direction).filter(Boolean) as string[];
    if (dirs.length === 0) return { status: 'unknown', detail: '接道方位の記載なし' };
    const label = dirs.map((d) => `${d}側`).join('・');
    if (dirs.some((d) => d.includes('南'))) return { status: 'match', detail: `${label}接道` };
    if (dirs.some((d) => d === '東' || d === '西')) return { status: 'near', detail: `${label}接道（東西は午前/午後の日照）` };
    return { status: 'miss', detail: `${label}接道` };
  },

  shape(l, c) {
    if (!c.regularShape) return null;
    if (!l.shape) return { status: 'unknown', detail: '形状の記載なし' };
    if (l.shape === '整形地') return { status: 'match', detail: '整形地' };
    return { status: l.shape === '不整形地' ? 'near' : 'miss', detail: l.shape };
  },

  buildingCondition(l, c) {
    if (!c.noBuildingCondition) return null;
    if (l.buildingCondition == null) return { status: 'unknown', detail: '建築条件の記載なし' };
    return l.buildingCondition
      ? { status: 'miss', detail: '建築条件付き（施工会社の指定あり）' }
      : { status: 'match', detail: '建築条件なし' };
  },

  hazard(_l, c, hazard) {
    const tol = c.hazardTolerance ?? 'normal';
    if (tol === 'any') return null;
    if (!hazard || hazard.overall === 'unknown') return { status: 'unknown', detail: 'ハザード情報未取得' };
    const summary = hazard.badges.map((b) => b.label).join('・') || '主要ハザード該当なし';
    if (hazard.overall === 'low') return { status: 'match', detail: summary };
    if (tol === 'strict') return { status: 'miss', detail: summary };
    return { status: hazard.overall === 'high' ? 'miss' : 'near', detail: summary };
  },
};

function bestStation(l: Listing) {
  const cost = (s: { walk?: number; bus?: number }) => (s.walk ?? 99) + (s.bus ? s.bus * 1.5 + 5 : 0);
  return [...l.stations].sort((a, b) => cost(a) - cost(b))[0];
}

export function evaluateListing(listing: Listing, conditions: SearchConditions, hazard?: HazardSummary): EvaluatedListing {
  const importance = { ...DEFAULT_IMPORTANCE, ...conditions.importance };
  const criteria: CriterionResult[] = [];

  for (const key of Object.keys(EVALUATORS) as CriterionKey[]) {
    const r = EVALUATORS[key](listing, conditions, hazard);
    if (r) criteria.push({ key, label: CRITERION_LABELS[key], importance: importance[key], ...r });
  }

  // 市街化調整区域の除外は「必須」の特別条件として扱う
  if (conditions.excludeUrbanControl !== false && listing.cityPlanning === '市街化調整区域') {
    criteria.push({
      key: 'location',
      label: '都市計画',
      importance: 'must',
      status: 'miss',
      detail: '市街化調整区域（原則として住宅の新築不可）',
    });
  }

  const totalWeight = criteria.reduce((s, c) => s + WEIGHT[c.importance], 0);
  const earned = criteria.reduce((s, c) => s + WEIGHT[c.importance] * STATUS_POINT[c.status], 0);
  const score = totalWeight === 0 ? 100 : Math.round((earned / totalWeight) * 100);

  return {
    listing,
    rank: decideRank(criteria, score),
    score,
    criteria,
    hazard,
    derived: derive(listing.price, listing.landArea),
  };
}

/**
 * ランク判定
 *  - 高: すべての条件を満たす（「希望」条件の情報不足のみ許容）
 *  - 中: 必須条件をすべて満たし、重視条件の未達がない（「惜しい」は可）。スコア70以上
 *  - 低: 必須条件の未達が「惜しい」範囲にとどまる、または重視条件に未達がある
 *  - 対象外: 必須条件のいずれかが未達
 */
export function decideRank(criteria: CriterionResult[], score: number): Rank {
  const must = criteria.filter((c) => c.importance === 'must');
  if (must.some((c) => c.status === 'miss')) return 'out';
  const allMatch = criteria.every(
    (c) => c.status === 'match' || (c.status === 'unknown' && c.importance === 'nice'),
  );
  if (allMatch) return 'high';
  const mustOk = must.every((c) => c.status === 'match' || c.status === 'unknown');
  const wantMiss = criteria.some((c) => c.importance === 'want' && c.status === 'miss');
  if (mustOk && !wantMiss && score >= 70) return 'medium';
  return 'low';
}

const RANK_ORDER: Record<Rank, number> = { high: 0, medium: 1, low: 2, out: 3 };

export function sortEvaluated(list: EvaluatedListing[]): EvaluatedListing[] {
  return [...list].sort(
    (a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank] || b.score - a.score || a.derived.pricePerTsubo - b.derived.pricePerTsubo,
  );
}
