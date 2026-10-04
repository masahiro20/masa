// 地域特性：交通・街並み（用途地域）・地形・周辺施設（OpenStreetMap）・市区町村の概要をまとめる。
import type { AreaReport, FacilityStat, HazardReport, Listing } from '../../shared/types';
import { round } from '../../shared/units';
import { normalizeZoning } from '../../shared/zoning';
import { fetchWithTimeout, USER_AGENT } from '../http';
import { JsonCache } from './cache';

/** 参考情報としての市区町村の概要（一般に知られた特徴のみを記載） */
export const CITY_PROFILES: Record<string, string> = {
  '東京都世田谷区': '23区で最も人口が多い住宅都市。低層住居専用地域が広く、閑静な住宅街と緑が多い一方、地価水準は高め。',
  '東京都杉並区': '中央線・京王井の頭線・丸ノ内線沿線の住宅地。低層住宅地が多く落ち着いた環境。善福寺川・神田川沿いは浸水想定を確認。',
  '東京都練馬区': '23区の中でも緑や農地が多く残る住宅地。23区内では比較的土地価格が抑えめで、子育て世帯の流入が多い。',
  '東京都町田市': '多摩丘陵に広がる住宅都市。小田急線とJR横浜線の結節点に商業が集積。丘陵部は高低差のある土地も多い。',
  '東京都八王子市': '多摩地域最大の人口を持つ都市で大学が多い。丘陵地の造成住宅地が広がり、斜面地には土砂災害警戒区域もある。',
  '東京都江戸川区': '荒川・江戸川・東京湾に囲まれ、海抜ゼロメートル地帯が広がる。子育て支援に積極的な一方、大規模水害時の広域避難を前提とした検討が必要。',
  '東京都府中市': '多摩川沿いの住宅都市。大規模な公園やスポーツ施設が充実。多摩川沿いは洪水浸水想定区域に注意。',
  '神奈川県横浜市青葉区': '東急田園都市線沿線の計画的な住宅地（多摩田園都市）。丘陵地で坂が多く、ひな壇造成地が多い。',
  '神奈川県横浜市港北区': '新横浜・日吉など交通の要所を抱え人口が多い区。鶴見川流域の低地は浸水想定を確認。',
  '神奈川県川崎市宮前区': '丘陵地の住宅地で坂が多い。東急田園都市線沿線で都心へのアクセスが良好。',
  '神奈川県藤沢市': '湘南エリアの中核都市。海沿いは津波浸水想定区域、北部は住宅地と田園が広がる。',
  '神奈川県鎌倉市': '古都保存法の歴史的風土保存区域や風致地区などの景観規制が厳しく、建築計画に制約が多い。谷戸地形で土砂災害警戒区域が多く、沿岸部は津波想定区域。',
  '埼玉県さいたま市浦和区': '文教地区として知られ、教育環境を重視する子育て世帯に人気。JR各線で都心へのアクセスが良好。',
  '埼玉県川口市': '荒川を挟んで東京都に隣接し、都心への近さの割に価格が抑えめ。荒川沿いの低地は浸水想定に注意。',
  '埼玉県越谷市': '中川・元荒川など多くの河川が流れる低地の都市。大型商業施設が多く利便性は高いが、浸水深・浸水継続時間の確認が重要。',
  '埼玉県所沢市': '西武線の拠点都市。台地上の住宅地が多く、河川沿いを除けば水害リスクが比較的低い地域が多い。',
  '千葉県船橋市': 'JR総武線・京葉線・東武野田線など多路線が通る中核都市。北部は台地、南部の湾岸埋立地は液状化・高潮に注意。',
  '千葉県柏市': 'JR常磐線とつくばエクスプレスの沿線。柏の葉周辺は計画的な街並み。利根川・手賀沼周辺の低地は浸水想定を確認。',
  '千葉県浦安市': '市域の大部分が埋立地で、東日本大震災で広範囲に液状化被害があった。都心アクセスは良好。',
};

interface FacilityDef { key: string; label: string; match: (tags: Record<string, string>) => boolean }

const FACILITIES: FacilityDef[] = [
  { key: 'elementary', label: '小学校', match: (t) => t.amenity === 'school' && /小学校|学園|義務教育/.test(t.name ?? '') },
  { key: 'juniorHigh', label: '中学校', match: (t) => t.amenity === 'school' && /中学校|義務教育/.test(t.name ?? '') },
  { key: 'childcare', label: '保育園・幼稚園', match: (t) => t.amenity === 'kindergarten' || t.amenity === 'childcare' },
  { key: 'supermarket', label: 'スーパー', match: (t) => t.shop === 'supermarket' },
  { key: 'convenience', label: 'コンビニ', match: (t) => t.shop === 'convenience' },
  { key: 'medical', label: '病院・診療所', match: (t) => ['hospital', 'clinic', 'doctors'].includes(t.amenity) },
  { key: 'park', label: '公園', match: (t) => t.leisure === 'park' },
];

export const FACILITY_RADIUS_M = 800;

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface OsmElement { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

export function aggregateFacilities(elements: OsmElement[], lat: number, lng: number): FacilityStat[] {
  return FACILITIES.map((def) => {
    let count = 0;
    let nearest: { name?: string; d: number } | undefined;
    for (const el of elements) {
      const tags = el.tags ?? {};
      if (!def.match(tags)) continue;
      const p = el.center ?? (el.lat != null && el.lon != null ? { lat: el.lat, lon: el.lon } : undefined);
      if (!p) continue;
      const d = distanceMeters(lat, lng, p.lat, p.lon);
      if (d > FACILITY_RADIUS_M) continue;
      count++;
      if (!nearest || d < nearest.d) nearest = { name: tags.name, d };
    }
    return {
      key: def.key,
      label: def.label,
      count,
      nearestName: nearest?.name,
      nearestMeters: nearest ? Math.round(nearest.d) : undefined,
    };
  });
}

const facilityCache = new JsonCache<FacilityStat[]>('facilities', 1000 * 60 * 60 * 24 * 14);

async function fetchFacilities(lat: number, lng: number): Promise<FacilityStat[]> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = facilityCache.get(key);
  if (hit) return hit;
  const r = FACILITY_RADIUS_M;
  const query = `[out:json][timeout:25];(
nwr(around:${r},${lat},${lng})[amenity~"^(school|kindergarten|childcare|hospital|clinic|doctors)$"];
nwr(around:${r},${lat},${lng})[shop~"^(supermarket|convenience)$"];
nwr(around:${r},${lat},${lng})[leisure=park];
);out center tags;`;
  const res = await fetchWithTimeout(
    'https://overpass-api.de/api/interpreter',
    {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }),
    },
    30_000,
  );
  if (!res.ok) throw new Error(`Overpass API ${res.status}`);
  const json = (await res.json()) as { elements: OsmElement[] };
  const stats = aggregateFacilities(json.elements, lat, lng);
  facilityCache.set(key, stats);
  return stats;
}

export interface AreaContext {
  /** 同一市区町村の候補の平均坪単価（万円） */
  cityAvgPricePerTsubo?: number;
  cityListingCount?: number;
}

export async function buildAreaReport(
  l: Listing,
  hazard: HazardReport | undefined,
  pricePerTsubo: number,
  ctx: AreaContext,
): Promise<AreaReport> {
  const points: AreaReport['points'] = [];
  const zoning = normalizeZoning(l.zoning);

  const best = [...l.stations].sort((a, b) => (a.walk ?? 99) + (a.bus ?? 0) * 2 - ((b.walk ?? 99) + (b.bus ?? 0) * 2))[0];
  if (best) {
    const access = best.bus ? `バス${best.bus}分＋徒歩${best.walk ?? '?'}分` : `徒歩${best.walk ?? '?'}分`;
    const comment = best.bus
      ? 'バス便のため、通勤時間帯の本数と所要時間の確認を推奨。車の保有を前提とした計画が現実的です。'
      : (best.walk ?? 99) <= 10
        ? '駅徒歩10分以内で、通勤・通学の利便性が高く資産性も維持しやすい立地です。'
        : (best.walk ?? 99) <= 20
          ? '駅まで自転車利用も視野に入る距離。駐輪場・坂道の有無を現地で確認してください。'
          : '駅から距離があるため、車・バス利用が中心の生活になります。';
    points.push({ title: `交通：${best.line ? `${best.line} ` : ''}「${best.name}」${access}`, body: comment });
  }

  if (zoning) points.push({ title: `街並み：${zoning.name}`, body: zoning.character });

  if (hazard?.elevation != null) {
    const e = hazard.elevation;
    points.push({
      title: `地形：標高 約${round(e, 1)}m`,
      body:
        e < 5
          ? '低地に位置します。周辺の河川や内水氾濫の履歴を確認してください。'
          : e < 20
            ? '比較的低い平地です。浸水想定と合わせて周辺との高低差を現地で確認してください。'
            : '台地・丘陵地上の立地です。水害リスクは相対的に低い一方、坂道や擁壁の有無を確認してください。',
    });
  }

  if (ctx.cityAvgPricePerTsubo && ctx.cityListingCount && ctx.cityListingCount >= 2) {
    const diff = ((pricePerTsubo - ctx.cityAvgPricePerTsubo) / ctx.cityAvgPricePerTsubo) * 100;
    points.push({
      title: `価格水準：坪単価 ${round(pricePerTsubo, 1)}万円`,
      body: `収集した${l.city}の候補${ctx.cityListingCount}件の平均（${round(ctx.cityAvgPricePerTsubo, 1)}万円/坪）と比べて${diff >= 0 ? '+' : ''}${round(diff, 1)}%。${
        diff <= -10 ? '割安感がありますが、価格が低い理由（形状・接道・ハザード等）を確認してください。' : diff >= 10 ? '割高な水準です。立地・形状などの付加価値と見合うか検討してください。' : '周辺相場並みの水準です。'
      }`,
    });
  }

  let facilities: FacilityStat[] | undefined;
  let facilitiesError: string | undefined;
  if (l.lat != null && l.lng != null) {
    try {
      facilities = await fetchFacilities(l.lat, l.lng);
      const f = Object.fromEntries(facilities.map((s) => [s.key, s]));
      const daily = (f.supermarket?.count ?? 0) + (f.convenience?.count ?? 0);
      const kids = (f.elementary?.count ?? 0) + (f.childcare?.count ?? 0);
      points.push({
        title: '生活利便性（半径800m・徒歩約10分圏）',
        body: [
          daily >= 4 ? '日常の買い物施設が充実しています。' : daily >= 1 ? '日常の買い物施設は徒歩圏に最低限あります。' : '徒歩圏にスーパー・コンビニが見当たりません。車での買い物が前提です。',
          kids >= 2 ? '小学校・保育施設が近く、子育て世帯に向いた環境です。' : '通学区域の小学校までの距離・通学路を確認してください。',
        ].join(''),
      });
    } catch (e) {
      facilitiesError = `周辺施設の取得に失敗しました（${(e as Error).message}）`;
    }
  }

  const cityProfile = CITY_PROFILES[`${l.prefecture}${l.city}`];
  const headline = [
    zoning?.group === 'lowRise' ? '閑静な低層住宅地' : zoning?.group === 'commercial' ? '利便性重視の商業系エリア' : zoning ? '住宅地' : 'エリア',
    best && !best.bus && (best.walk ?? 99) <= 10 ? '・駅近' : '',
    hazard?.overall === 'high' ? '（災害リスク要検討）' : hazard?.overall === 'low' ? '（主要ハザード区域外）' : '',
  ].join('');

  return { headline, points, facilities, facilitiesError, cityProfile };
}
