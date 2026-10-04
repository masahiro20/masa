/** 1坪 = 400/121 ㎡ ≒ 3.30579㎡ */
export const SQM_PER_TSUBO = 400 / 121;

export const sqmToTsubo = (sqm: number) => sqm / SQM_PER_TSUBO;
export const tsuboToSqm = (tsubo: number) => tsubo * SQM_PER_TSUBO;

export const round = (n: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** 万円 → "1億2,300万円" 形式 */
export function formatManYen(man: number): string {
  if (!Number.isFinite(man)) return '-';
  const v = Math.round(man);
  const oku = Math.floor(v / 10000);
  const rest = v % 10000;
  if (oku > 0) return rest > 0 ? `${oku}億${rest.toLocaleString('ja-JP')}万円` : `${oku}億円`;
  return `${rest.toLocaleString('ja-JP')}万円`;
}

export const formatSqm = (sqm: number) => `${round(sqm, 2).toLocaleString('ja-JP')}㎡`;
export const formatTsubo = (sqm: number) => `${round(sqmToTsubo(sqm), 2).toLocaleString('ja-JP')}坪`;

export function derive(price: number, landArea: number) {
  const tsubo = sqmToTsubo(landArea);
  return {
    tsubo: round(tsubo, 2),
    pricePerTsubo: tsubo > 0 ? round(price / tsubo, 1) : 0,
    pricePerSqm: landArea > 0 ? round(price / landArea, 2) : 0,
  };
}
