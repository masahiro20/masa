import { describe, expect, it } from 'vitest';
import { parseArea, parsePrice, parseRatios, parseRoads, parseStations, splitAddress } from '../server/import/parse';
import { normalizeZoning } from '../shared/zoning';

describe('parsePrice', () => {
  it('万円・億円・範囲・円表記を万円に揃える', () => {
    expect(parsePrice('3,280万円')).toBe(3280);
    expect(parsePrice('1億2000万円')).toBe(12000);
    expect(parsePrice('1億円')).toBe(10000);
    expect(parsePrice('8489万円～1億247万円 (土地のみの価格です)')).toBe(8489);
    expect(parsePrice('32,800,000円')).toBe(3280);
    expect(parsePrice('４５００')).toBe(4500);
    expect(parsePrice('価格未定')).toBeUndefined();
  });
});

describe('parseArea', () => {
  it('㎡・m2・坪を㎡に揃える', () => {
    expect(parseArea('106.84m2（32.31坪）（実測）')).toBe(106.84);
    expect(parseArea('120.5㎡')).toBe(120.5);
    expect(parseArea('30坪')).toBeCloseTo(99.17, 1);
    expect(parseArea('1,020.5㎡')).toBe(1020.5);
  });
});

describe('parseRatios', () => {
  it('建ぺい率・容積率の表記ゆれ', () => {
    expect(parseRatios('建ペい率：40％、容積率：80％')).toEqual({ coverageRatio: 40, floorAreaRatio: 80 });
    expect(parseRatios('60%/200%')).toEqual({ coverageRatio: 60, floorAreaRatio: 200 });
  });
});

describe('parseRoads', () => {
  it('方位・幅員・公私道を分解する', () => {
    expect(parseRoads('道路幅：5.8ｍ、アスファルト舗装、北西側5.8m 公道')).toEqual([
      { direction: '北西', width: 5.8, frontage: undefined, kind: '公道', article: undefined },
    ]);
  });
  it('角地（2方向）と42条2項を読み取る', () => {
    const roads = parseRoads('東側 公道 幅員4.0m 間口10.2m、南側 私道 幅員3.6m 42条2項');
    expect(roads).toHaveLength(2);
    expect(roads[0]).toMatchObject({ direction: '東', width: 4, frontage: 10.2, kind: '公道' });
    expect(roads[1]).toMatchObject({ direction: '南', width: 3.6, kind: '私道', article: '42条2項' });
  });
});

describe('parseStations', () => {
  it('SUUMO形式の交通表記（バス便含む）', () => {
    const st = parseStations('東急田園都市線「二子玉川」バス11分岡本三丁目歩3分 [ 乗り換え案内 ] 東急田園都市線「用賀」歩24分');
    expect(st).toEqual([
      { line: '東急田園都市線', name: '二子玉川', bus: 11, walk: 3 },
      { line: '東急田園都市線', name: '用賀', bus: undefined, walk: 24 },
    ]);
  });
  it('「○○駅 徒歩8分」形式', () => {
    expect(parseStations('成城学園前駅 徒歩8分')).toEqual([{ name: '成城学園前', walk: 8 }]);
  });
});

describe('splitAddress', () => {
  it('都道府県・市区町村を分ける（政令市は区まで）', () => {
    expect(splitAddress('東京都世田谷区岡本３')).toEqual({ prefecture: '東京都', city: '世田谷区', rest: '岡本3' });
    expect(splitAddress('神奈川県横浜市青葉区美しが丘2丁目')).toEqual({ prefecture: '神奈川県', city: '横浜市青葉区', rest: '美しが丘2丁目' });
    expect(splitAddress('千葉県市川市真間1丁目').city).toBe('市川市');
    expect(splitAddress('神奈川県三浦郡葉山町一色').city).toBe('三浦郡葉山町');
  });
});

describe('normalizeZoning', () => {
  it('略称を正式名称に正規化する', () => {
    expect(normalizeZoning('１種低層')?.name).toBe('第一種低層住居専用地域');
    expect(normalizeZoning('2種中高層')?.name).toBe('第二種中高層住居専用地域');
    expect(normalizeZoning('第1種住居地域')?.name).toBe('第一種住居地域');
    expect(normalizeZoning('近隣商業地域')?.name).toBe('近隣商業地域');
    expect(normalizeZoning('準工業')?.name).toBe('準工業地域');
    expect(normalizeZoning('無指定')).toBeUndefined();
  });
});
