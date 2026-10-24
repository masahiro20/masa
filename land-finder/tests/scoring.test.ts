import { describe, expect, it } from 'vitest';
import type { HazardSummary, Listing, SearchConditions } from '../shared/types';
import { evaluateListing } from '../server/search/scoring';

const base: Listing = {
  id: 't1',
  source: 'test',
  sourceLabel: 'テスト',
  title: 'テスト物件',
  prefecture: '東京都',
  city: '練馬区',
  address: '石神井町4丁目',
  price: 4800,
  landArea: 120,
  stations: [{ name: '石神井公園', walk: 8 }],
  zoning: '第一種低層住居専用地域',
  coverageRatio: 50,
  floorAreaRatio: 100,
  roads: [{ direction: '南', width: 5, kind: '公道' }],
  shape: '整形地',
  buildingCondition: false,
};

const cond: SearchConditions = {
  areas: [{ prefecture: '東京都', city: '練馬区' }],
  priceMax: 5000,
  areaMin: 100,
  walkMax: 10,
  zoningGroups: ['lowRise'],
  southFacing: true,
  noBuildingCondition: true,
  hazardTolerance: 'normal',
  importance: {},
};

const safe: HazardSummary = { overall: 'low', badges: [] };
const flood5m: HazardSummary = { overall: 'high', maxInundation: '3〜5m', badges: [{ label: '洪水 3〜5m', severity: 3 }] };

describe('evaluateListing', () => {
  it('全条件一致なら優先度：高・100点', () => {
    const r = evaluateListing(base, cond, safe);
    expect(r.rank).toBe('high');
    expect(r.score).toBe(100);
    expect(r.criteria.every((c) => c.status === 'match')).toBe(true);
  });

  it('予算10%以内の超過は「惜しい」→ 必須条件が惜しいので低', () => {
    const r = evaluateListing({ ...base, price: 5300 }, cond, safe);
    expect(r.criteria.find((c) => c.key === 'price')?.status).toBe('near');
    expect(r.rank).toBe('low');
  });

  it('予算を大きく超える物件は対象外', () => {
    expect(evaluateListing({ ...base, price: 6500 }, cond, safe).rank).toBe('out');
  });

  it('希望エリア外は対象外', () => {
    expect(evaluateListing({ ...base, city: '杉並区' }, cond, safe).rank).toBe('out');
  });

  it('重視条件が「惜しい」だけなら中', () => {
    const r = evaluateListing({ ...base, stations: [{ name: '石神井公園', walk: 13 }] }, cond, safe);
    expect(r.criteria.find((c) => c.key === 'walk')?.status).toBe('near');
    expect(r.rank).toBe('medium');
  });

  it('重視条件（ハザード）が未達なら低', () => {
    const r = evaluateListing(base, cond, flood5m);
    expect(r.criteria.find((c) => c.key === 'hazard')?.status).toBe('miss');
    expect(r.rank).toBe('low');
  });

  it('ハザードを必須にすると浸水3m以上は対象外', () => {
    const r = evaluateListing(base, { ...cond, importance: { hazard: 'must' } }, flood5m);
    expect(r.rank).toBe('out');
  });

  it('市街化調整区域は除外設定で対象外', () => {
    const r = evaluateListing({ ...base, cityPlanning: '市街化調整区域' }, cond, safe);
    expect(r.rank).toBe('out');
    expect(evaluateListing({ ...base, cityPlanning: '市街化調整区域' }, { ...cond, excludeUrbanControl: false }, safe).rank).toBe('high');
  });

  it('北側接道は南向き希望で未達、東西は惜しい', () => {
    expect(evaluateListing({ ...base, roads: [{ direction: '北', width: 5 }] }, cond, safe).criteria.find((c) => c.key === 'sunlight')?.status).toBe('miss');
    expect(evaluateListing({ ...base, roads: [{ direction: '東', width: 5 }] }, cond, safe).criteria.find((c) => c.key === 'sunlight')?.status).toBe('near');
  });

  it('坪単価などの派生値を計算する', () => {
    const r = evaluateListing(base, cond, safe);
    expect(r.derived.tsubo).toBeCloseTo(36.3, 1);
    expect(r.derived.pricePerTsubo).toBeCloseTo(132.2, 1);
  });
});
