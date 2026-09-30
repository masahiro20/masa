import { describe, expect, it } from 'vitest';
import type { HazardLayerResult } from '../shared/types';
import { buildOpinions, classifyPixel, lngLatToGlobalPixel, summarize } from '../server/insight/hazard';

describe('classifyPixel', () => {
  const flood = { key: 'flood' as const, kind: 'depth' as const };
  it('浸水深の凡例色を判定する', () => {
    expect(classifyPixel(flood, [247, 245, 169, 255])?.label).toBe('0.5m未満');
    expect(classifyPixel(flood, [255, 216, 192, 255])?.label).toBe('0.5〜3m');
    expect(classifyPixel(flood, [255, 183, 183, 255])).toMatchObject({ label: '3〜5m', severity: 3 });
    expect(classifyPixel(flood, [0, 0, 0, 0])).toBeNull();
  });
  it('津波では同じ色を1〜3mと読む', () => {
    expect(classifyPixel({ key: 'tsunami', kind: 'depth' }, [255, 216, 192, 255])?.label).toBe('1〜3m');
  });
  it('土砂災害の黄色は警戒区域、赤は特別警戒区域', () => {
    const s = { key: 'steepSlope' as const, kind: 'sediment' as const };
    expect(classifyPixel(s, [250, 230, 0, 255])?.label).toBe('警戒区域');
    expect(classifyPixel(s, [250, 40, 0, 255])?.label).toBe('特別警戒区域');
    expect(classifyPixel({ key: 'debrisFlow', kind: 'sediment' }, [165, 0, 33, 255])?.label).toBe('特別警戒区域');
  });
  it('浸水継続時間の色', () => {
    expect(classifyPixel({ key: 'floodDuration', kind: 'duration' }, [180, 0, 104, 255])?.label).toBe('2週間〜4週間');
  });
});

describe('lngLatToGlobalPixel', () => {
  it('ズーム16のタイル座標を計算する', () => {
    const { x, y } = lngLatToGlobalPixel(35.69, 139.87, 16);
    expect(Math.floor(x / 256)).toBe(58230);
    expect(Math.floor(y / 256)).toBe(25804);
  });
});

const layer = (p: Partial<HazardLayerResult> & Pick<HazardLayerResult, 'key'>): HazardLayerResult => ({ label: p.key, status: 'none', severity: 0, ...p });

describe('summarize / buildOpinions', () => {
  it('最大の浸水深と土砂区域を集約する', () => {
    const layers = [
      layer({ key: 'flood', status: 'inside', level: '0.5〜3m', severity: 2 }),
      layer({ key: 'stormSurge', status: 'inside', level: '3〜5m', severity: 3 }),
      layer({ key: 'steepSlope', status: 'inside', level: '警戒区域', severity: 2 }),
    ];
    const s = summarize(layers);
    expect(s.overall).toBe('high');
    expect(s.maxInundation).toBe('3〜5m');
    expect(s.sediment).toBe('警戒区域');
    const ops = buildOpinions(layers, s, 1.2).map((o) => o.title);
    expect(ops.some((t) => t.includes('2階床上'))).toBe(true);
    expect(ops.some((t) => t.includes('イエローゾーン'))).toBe(true);
    expect(ops.some((t) => t.includes('低地'))).toBe(true);
  });
  it('すべて取得失敗なら unknown', () => {
    expect(summarize([layer({ key: 'flood', status: 'unknown' })]).overall).toBe('unknown');
  });
  it('区域外なら low で「主要なハザード区域の外」', () => {
    const layers = [layer({ key: 'flood' }), layer({ key: 'tsunami' })];
    const s = summarize(layers);
    expect(s.overall).toBe('low');
    expect(buildOpinions(layers, s, 40)[0].title).toBe('主要なハザード区域の外');
  });
});
