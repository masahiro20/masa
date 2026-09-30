// 条件評価・ハザード・法令・地域特性を束ねて、お客様向けの提案サマリーを組み立てる（ルールベース）。
import type { AreaReport, EvaluatedListing, HazardReport, ListingInsight, RegulationReport } from '../../shared/types';
import { formatManYen, round } from '../../shared/units';

const RANK_TEXT = { high: '全条件を満たす最有力候補', medium: '必須条件を満たす有力候補', low: '条件の一部に妥協が必要な候補', out: '必須条件を満たさない参考物件' };

export function buildProposal(
  ev: EvaluatedListing,
  hazard: HazardReport | undefined,
  regs: RegulationReport,
  area: AreaReport,
): ListingInsight['proposal'] {
  const l = ev.listing;
  const strengths: string[] = [];
  const concerns: string[] = [];
  const nextSteps: string[] = [];

  const describe = (label: string, detail: string) => (detail.includes(label) ? detail : `${label}：${detail}`);
  for (const c of ev.criteria) {
    if (c.status === 'match') strengths.push(describe(c.label, c.detail));
    else if (c.status === 'near') concerns.push(`${c.label}（惜しい）：${c.detail}`);
    else if (c.status === 'miss') concerns.push(`${c.label}（未達）：${c.detail}`);
    else concerns.push(`${c.label}（情報不足）：${c.detail}`);
  }

  if (hazard) {
    const hazardCriterion = ev.criteria.some((c) => c.key === 'hazard' && c.status === 'match');
    if (hazard.overall === 'low' && !hazardCriterion) strengths.push('洪水・土砂・津波などの主要なハザード区域外');
    for (const o of hazard.opinions.filter((o) => o.severity >= 2)) concerns.push(`${o.title}`);
  }
  const warnings = regs.items.filter((i) => i.severity === 'warning');
  for (const w of warnings) concerns.push(w.title);

  const v = regs.volume;
  if (v.maxFloorArea != null) {
    strengths.push(`延床面積は最大 約${v.maxFloorArea}㎡（${round(v.maxFloorArea / 3.30579, 1)}坪）まで計画可能`);
  }

  nextSteps.push('法務局で登記簿謄本・公図・地積測量図を取得し、面積・境界・権利関係を確認');
  nextSteps.push('役所で用途地域・道路種別（指定道路図）・上下水道・ガスの引込状況を確認');
  if (regs.items.some((i) => i.needsCheck)) nextSteps.push('「要確認」の条例・地区計画を所管の特定行政庁で確認');
  if (hazard && hazard.overall !== 'low') nextSteps.push('自治体のハザードマップと過去の浸水・災害履歴を確認し、建物仕様（基礎高さ等）に反映');
  if (l.terrain && l.terrain !== '平坦') nextSteps.push('擁壁の検査済証・高低差を現地で確認し、造成・基礎費用を見積もり');
  nextSteps.push('地盤調査（スウェーデン式サウンディング等）の費用と改良費を資金計画に計上');

  const summary = `${l.prefecture}${l.city}${l.address}の${round(l.landArea, 1)}㎡（${ev.derived.tsubo}坪）、${formatManYen(l.price)}の土地。${RANK_TEXT[ev.rank]}（適合スコア${ev.score}点）です。${area.headline}。`;
  return { summary, strengths, concerns, nextSteps };
}
