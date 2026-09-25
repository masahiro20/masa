import { describe, expect, it } from 'vitest';
import type { Listing } from '../shared/types';
import { buildRegulations, estimateVolume, setbackDepth } from '../server/insight/regulations';

const base: Listing = {
  id: 'r1',
  source: 'test',
  sourceLabel: 'テスト',
  title: 'テスト',
  prefecture: '東京都',
  city: '杉並区',
  address: '善福寺2丁目',
  price: 6000,
  landArea: 120,
  stations: [],
  zoning: '第一種中高層住居専用地域',
  coverageRatio: 60,
  floorAreaRatio: 200,
  roads: [{ direction: '北', width: 4, frontage: 10, kind: '公道' }],
};

describe('setbackDepth', () => {
  it('幅員4m未満は中心から2mまで後退', () => {
    expect(setbackDepth(3.6)).toBe(0.2);
    expect(setbackDepth(2.7, '42条2項')).toBe(0.65);
    expect(setbackDepth(4)).toBe(0);
  });
});

describe('estimateVolume', () => {
  it('前面道路4m・住居系は容積率160%に制限', () => {
    const v = estimateVolume(base);
    expect(v.roadLimitedFAR).toBe(160);
    expect(v.effectiveFAR).toBe(160);
    expect(v.maxBuildingArea).toBe(72);
    expect(v.maxFloorArea).toBe(192);
  });
  it('セットバック面積を有効敷地から控除する', () => {
    const v = estimateVolume({ ...base, roads: [{ direction: '北', width: 3, frontage: 10, article: '42条2項' }] });
    expect(v.setbackArea).toBe(5);
    expect(v.effectiveArea).toBe(115);
  });
  it('商業系は係数0.6', () => {
    const v = estimateVolume({ ...base, zoning: '近隣商業地域', floorAreaRatio: 300, roads: [{ width: 4 }] });
    expect(v.roadLimitedFAR).toBe(240);
  });
  it('角地は建ぺい率緩和の可能性を示す', () => {
    const v = estimateVolume({ ...base, roads: [{ direction: '東', width: 6 }, { direction: '南', width: 4 }] });
    expect(v.coverageBonus).toBe(10);
  });
});

describe('buildRegulations', () => {
  it('市街化調整区域・農地・2項道路を警告する', () => {
    const r = buildRegulations({
      ...base,
      cityPlanning: '市街化調整区域',
      landCategory: '畑',
      roads: [{ direction: '南', width: 3.5, frontage: 1.8, article: '42条2項' }],
    });
    const titles = r.items.map((i) => i.title);
    expect(titles).toContain('市街化調整区域');
    expect(titles.some((t) => t.includes('農地'))).toBe(true);
    expect(titles.some((t) => t.includes('セットバック'))).toBe(true);
    expect(titles.some((t) => t.includes('接道義務未達'))).toBe(true);
  });
  it('東京都の旗竿地・傾斜地では建築安全条例の論点を出す', () => {
    const r = buildRegulations({ ...base, shape: '旗竿地', terrain: '高低差あり' });
    const titles = r.items.map((i) => i.title).join('\n');
    expect(titles).toContain('路地状敷地の通路幅（東京都建築安全条例 第3条）');
    expect(titles).toContain('がけ条例（東京都建築安全条例 第6条）');
  });
  it('横浜市は市条例を優先する', () => {
    const r = buildRegulations({ ...base, prefecture: '神奈川県', city: '横浜市青葉区', terrain: '傾斜地' });
    expect(r.items.some((i) => i.basis === '横浜市建築基準条例')).toBe(true);
  });
  it('その他制限のキーワードから風致地区・埋蔵文化財を抽出する', () => {
    const r = buildRegulations({ ...base, otherRestrictions: ['風致地区', '周知の埋蔵文化財包蔵地'] });
    const titles = r.items.map((i) => i.title);
    expect(titles).toContain('風致地区');
    expect(titles).toContain('周知の埋蔵文化財包蔵地');
  });
  it('低層住居専用地域では絶対高さ制限を示す', () => {
    const r = buildRegulations({ ...base, zoning: '第一種低層住居専用地域' });
    expect(r.items.some((i) => i.title.startsWith('絶対高さ制限'))).toBe(true);
  });
});
