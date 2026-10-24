// 国土交通省「重ねるハザードマップ」のラスタタイル（国土地理院配信）を地点ごとに読み取り、
// 浸水深・土砂災害警戒区域などを判定する。APIキー不要。
// タイルの凡例色: https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/opendata.html
import { PNG } from 'pngjs';
import type {
  HazardLayerKey,
  HazardLayerResult,
  HazardReport,
  HazardSummary,
} from '../../shared/types';
import { fetchWithTimeout, USER_AGENT } from '../http';
import { JsonCache } from './cache';

type LayerKind = 'depth' | 'duration' | 'zone' | 'sediment';

export interface HazardLayerDef {
  key: HazardLayerKey;
  label: string;
  short: string;
  path: string;
  kind: LayerKind;
}

export const HAZARD_TILE_BASE = 'https://disaportaldata.gsi.go.jp/raster';

export const HAZARD_LAYERS: HazardLayerDef[] = [
  { key: 'flood', label: '洪水浸水想定区域（想定最大規模）', short: '洪水', path: '01_flood_l2_shinsuishin_data', kind: 'depth' },
  { key: 'floodDuration', label: '浸水継続時間（想定最大規模）', short: '浸水継続', path: '01_flood_l2_keizoku_data', kind: 'duration' },
  { key: 'houseCollapseFlow', label: '家屋倒壊等氾濫想定区域（氾濫流）', short: '家屋倒壊(氾濫流)', path: '01_flood_l2_kaokutoukai_hanran_data', kind: 'zone' },
  { key: 'houseCollapseErosion', label: '家屋倒壊等氾濫想定区域（河岸侵食）', short: '家屋倒壊(河岸侵食)', path: '01_flood_l2_kaokutoukai_kagan_data', kind: 'zone' },
  { key: 'stormSurge', label: '高潮浸水想定区域', short: '高潮', path: '03_hightide_l2_shinsuishin_data', kind: 'depth' },
  { key: 'tsunami', label: '津波浸水想定', short: '津波', path: '04_tsunami_newlegend_data', kind: 'depth' },
  { key: 'debrisFlow', label: '土砂災害警戒区域（土石流）', short: '土石流', path: '05_dosekiryukeikaikuiki', kind: 'sediment' },
  { key: 'steepSlope', label: '土砂災害警戒区域（急傾斜地の崩壊）', short: '急傾斜地', path: '05_kyukeishakeikaikuiki', kind: 'sediment' },
  { key: 'landslide', label: '土砂災害警戒区域（地すべり）', short: '地すべり', path: '05_jisuberikeikaikuiki', kind: 'sediment' },
];

const ZOOM = 16;
/** 「近接」とみなす半径（m） */
const NEARBY_METERS = 50;

type RGB = [number, number, number];
interface PaletteEntry { rgb: RGB; label: string; severity: 1 | 2 | 3; rank: number }

// 浸水深（洪水・高潮・津波 共通の新凡例）
const DEPTH_PALETTE: PaletteEntry[] = [
  { rgb: [255, 255, 179], label: '0.3m未満', severity: 1, rank: 1 },
  { rgb: [247, 245, 169], label: '0.5m未満', severity: 1, rank: 2 },
  { rgb: [248, 225, 166], label: '0.5〜1m', severity: 2, rank: 3 },
  { rgb: [255, 216, 192], label: '0.5〜3m', severity: 2, rank: 4 },
  { rgb: [255, 183, 183], label: '3〜5m', severity: 3, rank: 5 },
  { rgb: [255, 145, 145], label: '5〜10m', severity: 3, rank: 6 },
  { rgb: [242, 133, 201], label: '10〜20m', severity: 3, rank: 7 },
  { rgb: [220, 122, 220], label: '20m以上', severity: 3, rank: 8 },
];

const DURATION_PALETTE: PaletteEntry[] = [
  { rgb: [160, 210, 255], label: '12時間未満', severity: 1, rank: 1 },
  { rgb: [0, 65, 255], label: '12時間〜1日', severity: 1, rank: 2 },
  { rgb: [250, 245, 0], label: '1日〜3日', severity: 2, rank: 3 },
  { rgb: [255, 153, 0], label: '3日〜1週間', severity: 2, rank: 4 },
  { rgb: [255, 40, 0], label: '1週間〜2週間', severity: 3, rank: 5 },
  { rgb: [180, 0, 104], label: '2週間〜4週間', severity: 3, rank: 6 },
  { rgb: [96, 0, 96], label: '4週間以上', severity: 3, rank: 7 },
];

/** 津波・高潮では 0.5〜3m 色が「1〜3m」を表す */
const depthLabelFor = (key: HazardLayerKey, label: string) =>
  (key === 'tsunami' || key === 'stormSurge') && label === '0.5〜3m' ? '1〜3m' : label;

function nearest(palette: PaletteEntry[], rgb: RGB): PaletteEntry | undefined {
  let best: PaletteEntry | undefined;
  let bestD = Infinity;
  for (const p of palette) {
    const d = (p.rgb[0] - rgb[0]) ** 2 + (p.rgb[1] - rgb[1]) ** 2 + (p.rgb[2] - rgb[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return bestD <= 40 ** 2 ? best : undefined;
}

/** 1ピクセルの色を凡例に照らして分類する（テスト用に公開） */
export function classifyPixel(
  layer: Pick<HazardLayerDef, 'key' | 'kind'>,
  rgba: [number, number, number, number],
): { label: string; severity: 1 | 2 | 3; rank: number } | null {
  const [r, g, b, a] = rgba;
  if (a < 128) return null;
  switch (layer.kind) {
    case 'depth': {
      const p = nearest(DEPTH_PALETTE, [r, g, b]);
      return p ? { ...p, label: depthLabelFor(layer.key, p.label) } : { label: '区域内', severity: 2, rank: 0 };
    }
    case 'duration': {
      const p = nearest(DURATION_PALETTE, [r, g, b]);
      return p ?? { label: '区域内', severity: 2, rank: 0 };
    }
    case 'zone':
      return { label: '区域内', severity: 3, rank: 1 };
    case 'sediment':
      // 特別警戒区域（レッドゾーン）は赤系、警戒区域（イエローゾーン）は黄系
      return g < 120 ? { label: '特別警戒区域', severity: 3, rank: 2 } : { label: '警戒区域', severity: 2, rank: 1 };
  }
}

/* ---------------- タイル取得 ---------------- */

interface Tile { width: number; data: Buffer }
const tileCache = new Map<string, Promise<Tile | null>>();
const TILE_CACHE_MAX = 200;

async function loadTile(path: string, x: number, y: number): Promise<Tile | null> {
  const url = `${HAZARD_TILE_BASE}/${path}/${ZOOM}/${x}/${y}.png`;
  const cached = tileCache.get(url);
  if (cached) return cached;
  const p = (async () => {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } }, 10_000);
    // 404 = そのタイル範囲に区域データなし
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`tile ${res.status}`);
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    return { width: png.width, data: png.data };
  })();
  tileCache.set(url, p);
  p.catch(() => tileCache.delete(url));
  if (tileCache.size > TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value!);
  return p;
}

export function lngLatToGlobalPixel(lat: number, lng: number, z = ZOOM) {
  const n = 2 ** z * 256;
  const x = ((lng + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { x: Math.floor(x), y: Math.floor(y) };
}

function metersPerPixel(lat: number, z = ZOOM) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

async function pixelAt(path: string, gx: number, gy: number): Promise<[number, number, number, number] | null> {
  const tile = await loadTile(path, Math.floor(gx / 256), Math.floor(gy / 256));
  if (!tile) return null;
  const px = ((gy % 256) * tile.width + (gx % 256)) * 4;
  return [tile.data[px], tile.data[px + 1], tile.data[px + 2], tile.data[px + 3]];
}

async function inspectLayer(layer: HazardLayerDef, lat: number, lng: number): Promise<HazardLayerResult> {
  const base = { key: layer.key, label: layer.label };
  try {
    const { x, y } = lngLatToGlobalPixel(lat, lng);
    const center = await pixelAt(layer.path, x, y);
    const hit = center ? classifyPixel(layer, center) : null;
    if (hit) return { ...base, status: 'inside', level: hit.label, severity: hit.severity };

    // 半径約50m以内を間引きサンプリングして近接判定
    const radius = Math.round(NEARBY_METERS / metersPerPixel(lat));
    let nearby: ReturnType<typeof classifyPixel> = null;
    for (let dy = -radius; dy <= radius; dy += 3) {
      for (let dx = -radius; dx <= radius; dx += 3) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const px = await pixelAt(layer.path, x + dx, y + dy);
        const c = px ? classifyPixel(layer, px) : null;
        if (c && (!nearby || c.rank > nearby.rank)) nearby = c;
      }
    }
    if (nearby) return { ...base, status: 'nearby', level: nearby.label, severity: 1 };
    return { ...base, status: 'none', severity: 0 };
  } catch {
    return { ...base, status: 'unknown', severity: 0 };
  }
}

async function fetchElevation(lat: number, lng: number): Promise<number | undefined> {
  try {
    const url = `https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${lng}&lat=${lat}&outtype=JSON`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } }, 8_000);
    const json = (await res.json()) as { elevation: number | string };
    return typeof json.elevation === 'number' ? json.elevation : undefined;
  } catch {
    return undefined;
  }
}

/* ---------------- 集約と見解 ---------------- */

export function summarize(layers: HazardLayerResult[]): HazardSummary {
  if (layers.every((l) => l.status === 'unknown')) return { overall: 'unknown', badges: [] };
  const max = Math.max(0, ...layers.map((l) => l.severity));
  const inside = layers.filter((l) => l.status === 'inside');
  const byKey = (k: HazardLayerKey) => inside.find((l) => l.key === k);
  const depthOrder = DEPTH_PALETTE.map((p) => p.label);
  const inundations = (['flood', 'stormSurge', 'tsunami'] as const)
    .map((k) => byKey(k)?.level)
    .filter((l): l is string => !!l)
    .map((l) => (l === '1〜3m' ? '0.5〜3m' : l));
  const maxInundation = inundations.sort((a, b) => depthOrder.indexOf(b) - depthOrder.indexOf(a))[0];
  const sedimentLayers = inside.filter((l) => ['debrisFlow', 'steepSlope', 'landslide'].includes(l.key));
  const sediment = sedimentLayers.some((l) => l.level === '特別警戒区域')
    ? '特別警戒区域'
    : sedimentLayers.length
      ? '警戒区域'
      : undefined;

  const badges: HazardSummary['badges'] = [];
  const short = (k: HazardLayerKey) => HAZARD_LAYERS.find((d) => d.key === k)!.short;
  for (const l of inside) {
    if (l.severity === 0) continue;
    if (l.key === 'floodDuration' && l.severity < 2) continue;
    const label = l.level === '区域内' ? short(l.key) : `${short(l.key)} ${l.level}`;
    badges.push({ label, severity: l.severity as 1 | 2 | 3 });
  }
  const nearSediment = layers.filter(
    (l) => l.status === 'nearby' && ['debrisFlow', 'steepSlope', 'landslide'].includes(l.key),
  );
  if (!sediment && nearSediment.length) badges.push({ label: '土砂区域 近接', severity: 1 });
  badges.sort((a, b) => b.severity - a.severity);

  return {
    overall: max >= 3 ? 'high' : max === 2 ? 'moderate' : 'low',
    maxInundation,
    sediment,
    badges,
  };
}

export function buildOpinions(layers: HazardLayerResult[], summary: HazardSummary, elevation?: number): HazardReport['opinions'] {
  const ops: HazardReport['opinions'] = [];
  const get = (k: HazardLayerKey) => layers.find((l) => l.key === k);
  const depth = summary.maxInundation;

  if (depth) {
    if (['0.3m未満', '0.5m未満'].includes(depth)) {
      ops.push({
        severity: 1,
        title: `浸水想定 ${depth}（床下浸水程度）`,
        body: '基礎高さを標準より高め（GL+50〜60cm程度）に設定し、エアコン室外機・給湯器などの設備を架台で嵩上げすると被害を抑えやすい区域です。',
      });
    } else if (['0.5〜1m', '0.5〜3m'].includes(depth)) {
      ops.push({
        severity: 2,
        title: `浸水想定 ${depth}（1階床上浸水のおそれ）`,
        body: '高基礎・盛土・止水板の検討に加え、寝室や非常用品を2階に配置し、分電盤・給湯器・蓄電池等は高所設置を推奨。水災補償付き火災保険の加入を前提に資金計画を立ててください。',
      });
    } else {
      ops.push({
        severity: 3,
        title: `浸水想定 ${depth}（2階床上以上の浸水のおそれ）`,
        body: '木造2階建てでは垂直避難が困難になる水深です。3階建て・屋上避難スペース・RC造なども選択肢ですが、早期の立退き避難が前提となるため、立地そのものの再検討を推奨します。',
      });
    }
  }

  if (get('houseCollapseFlow')?.status === 'inside' || get('houseCollapseErosion')?.status === 'inside') {
    ops.push({
      severity: 3,
      title: '家屋倒壊等氾濫想定区域',
      body: '洪水時に氾濫流や河岸侵食で木造家屋が倒壊・流失するおそれがある区域です。屋内安全確保（垂直避難）が適さず、早期の立退き避難が必要。構造・基礎形式の検討が不可欠です。',
    });
  }

  const duration = get('floodDuration');
  if (duration?.status === 'inside' && duration.severity >= 2) {
    ops.push({
      severity: duration.severity as 2 | 3,
      title: `浸水継続時間 ${duration.level}`,
      body: '浸水が長期間続く想定です。在宅避難時の備蓄（飲料水・食料・簡易トイレ）や、太陽光＋蓄電池など停電対策の優先度が高くなります。',
    });
  }

  if (get('tsunami')?.status === 'inside') {
    ops.push({
      severity: get('tsunami')!.severity === 3 ? 3 : 2,
      title: `津波浸水想定 ${get('tsunami')!.level}`,
      body: '津波避難ビル・高台までの避難経路と所要時間を必ず確認してください。自治体によっては津波災害警戒区域として避難確保の規定があります。',
    });
  }

  if (summary.sediment === '特別警戒区域') {
    ops.push({
      severity: 3,
      title: '土砂災害特別警戒区域（レッドゾーン）',
      body: '居室を有する建築物は、土砂の衝撃に耐える構造（RC造の外壁・待受擁壁等）が建築確認で求められ、建築コストが大きく増加します。宅地分譲等の開発行為は許可制です。',
    });
  } else if (summary.sediment === '警戒区域') {
    ops.push({
      severity: 2,
      title: '土砂災害警戒区域（イエローゾーン）',
      body: '重要事項説明の対象です。建築制限は原則ありませんが、斜面側に寝室を配置しない、避難経路・避難場所を事前確認するなどの配慮を推奨します。',
    });
  } else if (layers.some((l) => l.status === 'nearby' && ['debrisFlow', 'steepSlope', 'landslide'].includes(l.key))) {
    ops.push({
      severity: 1,
      title: '土砂災害警戒区域が近接',
      body: '敷地の近く（約50m以内）に土砂災害警戒区域があります。区域の境界と敷地の位置関係を自治体の区域図で確認してください。',
    });
  }

  if (elevation != null && elevation < 5) {
    ops.push({
      severity: elevation <= 0 ? 3 : 2,
      title: `標高 ${elevation}m（低地）`,
      body: '周辺より低い土地は内水氾濫（下水道の排水能力超過）の影響も受けやすい傾向があります。自治体の内水ハザードマップも確認してください。',
    });
  }

  if (ops.length === 0) {
    ops.push({
      severity: 1,
      title: '主要なハザード区域の外',
      body: '洪水・高潮・津波・土砂災害の想定区域外です。ただし内水氾濫・液状化・地盤の強さはこの判定に含まれないため、地盤調査と自治体マップで補完してください。',
    });
  } else {
    ops.push({
      severity: 1,
      title: '補足',
      body: '内水氾濫・液状化・地盤の強さはこの判定に含まれません。契約前に自治体のハザードマップと地盤調査で補完してください。',
    });
  }
  return ops;
}

export const hazardPortalUrl = (lat: number, lng: number) =>
  `https://disaportal.gsi.go.jp/maps/?ll=${lat},${lng}&z=16&base=pale&vs=c1j0l0u0`;

const reportCache = new JsonCache<HazardReport>('hazard', 1000 * 60 * 60 * 24 * 30);

export async function getHazardReport(lat: number, lng: number): Promise<HazardReport> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const hit = reportCache.get(key);
  if (hit) return hit;

  const [layers, elevation] = await Promise.all([
    Promise.all(HAZARD_LAYERS.map((l) => inspectLayer(l, lat, lng))),
    fetchElevation(lat, lng),
  ]);
  const summary = summarize(layers);
  const report: HazardReport = {
    ...summary,
    lat,
    lng,
    layers,
    elevation,
    opinions: summary.overall === 'unknown' ? [] : buildOpinions(layers, summary, elevation),
    portalUrl: hazardPortalUrl(lat, lng),
    fetchedAt: new Date().toISOString(),
  };
  // 取得失敗を含む結果はキャッシュしない
  if (!layers.some((l) => l.status === 'unknown')) reportCache.set(key, report);
  return report;
}
