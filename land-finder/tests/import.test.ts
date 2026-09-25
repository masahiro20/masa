import { describe, expect, it } from 'vitest';
import { decodeCsv, parseCsv } from '../server/import/csv';
import { buildListing, matchField, toFieldMap } from '../server/import/fields';
import { extractPairs, extractTitle, isAllowedByRobots } from '../server/import/url';


// 物件詳細ページを模した最小限のHTML（実サイトのHTMLは同梱しない）
const HTML = `<!doctype html><html><head><title>練馬区の土地｜テスト不動産</title>
<meta property="og:title" content="石神井町4丁目 売地"></head><body>
<table>
<tr><th>価格<span>ヒント</span></th><td>5,380万円 [ □支払シミュレーション ]</td></tr>
<tr><th>土地面積</th><td>115.70m<sup>2</sup>（35.00坪）（公簿）</td></tr>
<tr><th>所在地</th><td>東京都練馬区石神井町４ [ ■周辺環境 ]</td></tr>
<tr><th>交通</th><td>西武池袋線「石神井公園」歩10分</td></tr>
<tr><th>建ぺい率･容積率</th><td>建ペい率：50％、容積率：100％</td></tr>
<tr><th>用途地域</th><td>１種低層</td></tr>
<tr><th>私道負担・道路</th><td>無、南側4m 公道</td></tr>
<tr><th>建築条件</th><td>無</td></tr>
<tr><th>その他制限事項</th><td>第一種高度地区、準防火地域</td></tr>
</table>
<dl><dt>地目</dt><dd>宅地</dd></dl>
<script>var x = '<th>価格</th><td>1円</td>';</script>
</body></html>`;

describe('URL取り込み（汎用抽出）', () => {
  it('th/td・dt/dd から項目を抽出し、scriptは無視する', () => {
    const pairs = extractPairs(HTML);
    expect(pairs.find(([k]) => k.startsWith('価格'))?.[1]).toContain('5,380万円');
    expect(pairs.some(([, v]) => v === '1円')).toBe(false);
    expect(pairs).toContainEqual(['地目', '宅地']);
    expect(extractTitle(HTML)).toBe('石神井町4丁目 売地');
  });

  it('抽出結果から Listing を組み立てる', () => {
    const f = toFieldMap(extractPairs(HTML));
    f.title = extractTitle(HTML);
    const { listing, missing } = buildListing(f, { id: 'url', label: 'example.com' }, 'https://example.com/1');
    expect(missing).toEqual([]);
    expect(listing).toMatchObject({
      prefecture: '東京都',
      city: '練馬区',
      address: '石神井町4',
      price: 5380,
      landArea: 115.7,
      zoning: '第一種低層住居専用地域',
      coverageRatio: 50,
      floorAreaRatio: 100,
      buildingCondition: false,
      fireZone: '準防火地域',
      heightDistrict: '第一種高度地区',
      landCategory: '宅地',
    });
    expect(listing?.roads[0]).toMatchObject({ direction: '南', width: 4, kind: '公道' });
    expect(listing?.stations[0]).toMatchObject({ name: '石神井公園', walk: 10 });
  });

  it('robots.txt の Disallow を尊重する', () => {
    const robots = 'User-agent: *\nDisallow: /private/\nAllow: /private/ok\n\nUser-agent: other\nDisallow: /';
    expect(isAllowedByRobots(robots, '/tochi/tokyo/nc_1/')).toBe(true);
    expect(isAllowedByRobots(robots, '/private/x')).toBe(false);
    expect(isAllowedByRobots(robots, '/private/ok')).toBe(true);
  });
});

describe('項目名の表記ゆれ', () => {
  it.each([
    ['敷地面積', 'area'],
    ['販売価格', 'price'],
    ['住所', 'address'],
    ['最寄駅', 'stations'],
    ['接道状況', 'roads'],
    ['建蔽率', 'coverage'],
    ['法令上の制限', 'restrictions'],
  ])('%s → %s', (label, key) => {
    expect(matchField(label)).toBe(key);
  });
});

describe('CSV取り込み', () => {
  const csv = [
    '物件名,所在地,価格,土地面積,交通,用途地域,建ぺい率,容積率,接道状況,建築条件',
    'A,神奈川県横浜市青葉区美しが丘2丁目,5480万円,165㎡,東急田園都市線「たまプラーザ」徒歩10分,一種低層,40%,80%,南側 公道 幅員6m,なし',
    'B,東京都町田市鶴間6丁目,,120㎡,,,,,,',
  ].join('\n');

  it('行ごとに取り込み、必須項目の欠落はエラーとして返す', () => {
    const r = parseCsv(csv);
    expect(r.listings).toHaveLength(1);
    expect(r.listings[0]).toMatchObject({ city: '横浜市青葉区', price: 5480, landArea: 165, coverageRatio: 40, floorAreaRatio: 80, buildingCondition: false });
    expect(r.errors).toEqual([{ row: 3, message: '必須項目がありません: 価格' }]);
  });

  it('同じ内容なら同じIDになる（再取り込みで重複しない）', () => {
    expect(parseCsv(csv).listings[0].id).toBe(parseCsv(csv).listings[0].id);
  });

  it('Shift_JIS のCSVも読める', () => {
    // 「所在地」を Shift_JIS でエンコードしたバイト列
    const sjis = Buffer.from([0x8f, 0x8a, 0x8d, 0xdd, 0x92, 0x6e]);
    expect(decodeCsv(sjis)).toBe('所在地');
    expect(decodeCsv(Buffer.from('﻿所在地', 'utf8'))).toBe('所在地');
  });
});
