// 「項目名 → 値」の組（物件ページの表・CSVの列）から Listing を組み立てる。
// 項目名は土地バンク・SUUMO・HOME'S・不動産ジャパン等で使われる表記をまとめて受け付ける。
import { createHash } from 'node:crypto';
import type { Listing } from '../../shared/types';
import { normalizeZoning } from '../../shared/zoning';
import {
  parseArea,
  parseBuildingCondition,
  parseCityPlanning,
  parseFireZone,
  parsePercent,
  parsePrice,
  parseRatios,
  parseRoads,
  parseShape,
  parseStations,
  parseTerrain,
  splitAddress,
  splitList,
  toHalfWidth,
} from './parse';

export type FieldKey =
  | 'title' | 'price' | 'area' | 'address' | 'prefecture' | 'city' | 'stations' | 'ratios' | 'coverage' | 'far'
  | 'zoning' | 'roads' | 'landCategory' | 'status' | 'buildingCondition' | 'delivery' | 'rights' | 'restrictions'
  | 'cityPlanning' | 'fireZone' | 'terrain' | 'shape' | 'updatedAt' | 'lat' | 'lng' | 'url' | 'notes';

/** 表記ゆれを含む項目名の辞書（前方一致・部分一致で照合） */
export const FIELD_ALIASES: Record<FieldKey, string[]> = {
  title: ['物件名', '名称', 'タイトル', 'title', 'name'],
  price: ['価格', '販売価格', '土地価格', '売出価格', 'price'],
  area: ['土地面積', '敷地面積', '面積', '地積', 'area', 'land_area'],
  address: ['所在地', '住所', 'address'],
  prefecture: ['都道府県', 'prefecture'],
  city: ['市区町村', 'city'],
  stations: ['交通', '最寄駅', '最寄り駅', 'アクセス', '沿線・駅', 'station'],
  ratios: ['建ぺい率・容積率', '建ぺい率･容積率', '建蔽率・容積率', '建ぺい率/容積率'],
  coverage: ['建ぺい率', '建蔽率', 'coverage'],
  far: ['容積率', 'far'],
  zoning: ['用途地域', 'zoning'],
  roads: ['私道負担・道路', '接道状況', '接道', '前面道路', '道路', 'road'],
  landCategory: ['地目'],
  status: ['土地状況', '現況'],
  buildingCondition: ['建築条件', 'building_condition'],
  delivery: ['引き渡し時期', '引渡し時期', '引渡時期', '引渡し'],
  rights: ['土地の権利形態', '権利', '土地権利'],
  restrictions: ['その他制限事項', '法令上の制限', 'その他法令上の制限', 'その他制限', '法令制限', '制限事項'],
  cityPlanning: ['都市計画', '区域区分'],
  fireZone: ['防火地域', '防火指定'],
  terrain: ['地勢', '高低差'],
  shape: ['形状', '土地形状'],
  updatedAt: ['情報提供日', '情報公開日', '情報更新日', '更新日'],
  lat: ['緯度', 'lat', 'latitude'],
  lng: ['経度', 'lng', 'lon', 'longitude'],
  url: ['URL', 'url', '物件URL', 'リンク'],
  notes: ['備考', '特記事項', 'その他概要・特記事項', 'notes'],
};

const cleanLabel = (s: string) =>
  toHalfWidth(s)
    .replace(/ヒント|必須|任意|\s+/g, '')
    .replace(/[：:]$/, '')
    .toLowerCase();

/** 項目名から FieldKey を推定する（完全一致を優先し、次に前方一致） */
export function matchField(label: string): FieldKey | undefined {
  const l = cleanLabel(label);
  if (!l) return undefined;
  for (const [key, aliases] of Object.entries(FIELD_ALIASES) as [FieldKey, string[]][]) {
    if (aliases.some((a) => cleanLabel(a) === l)) return key;
  }
  for (const [key, aliases] of Object.entries(FIELD_ALIASES) as [FieldKey, string[]][]) {
    if (aliases.some((a) => a.length >= 2 && l.startsWith(cleanLabel(a)))) return key;
  }
  return undefined;
}

export type FieldMap = Partial<Record<FieldKey, string>>;

/** [項目名, 値] の組を FieldMap にまとめる。同じ項目は最初の出現を採用 */
export function toFieldMap(pairs: [string, string][]): FieldMap {
  const map: FieldMap = {};
  for (const [label, value] of pairs) {
    const key = matchField(label);
    const v = value?.toString().trim();
    if (key && v && v !== '-' && map[key] == null) map[key] = v;
  }
  return map;
}

export const stableId = (prefix: string, seed: string) =>
  `${prefix}-${createHash('sha1').update(seed).digest('hex').slice(0, 12)}`;

export interface BuildResult {
  listing?: Listing;
  missing: string[];
  warnings: string[];
}

export function buildListing(f: FieldMap, source: { id: string; label: string }, seed: string): BuildResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  // 「東京都練馬区石神井町4 [ ■周辺環境 ]」のようなリンク文言を除く
  if (f.address) f.address = f.address.replace(/[[［][^\]］]*[\]］]/g, '').trim();
  const addr = splitAddress(f.address);
  const prefecture = f.prefecture ?? addr.prefecture;
  const city = f.city ?? addr.city;
  const price = parsePrice(f.price);
  const landArea = parseArea(f.area);
  if (!prefecture || !city) missing.push('所在地');
  if (price == null) missing.push('価格');
  if (landArea == null) missing.push('土地面積');
  if (missing.length) return { missing, warnings };

  if (f.price && /[～~〜]/.test(f.price)) warnings.push(`価格が範囲表記のため下限（${price}万円）を採用しました`);
  if (f.area && /[～~〜]/.test(f.area)) warnings.push('面積が範囲表記のため下限を採用しました');

  const ratios = parseRatios(f.ratios);
  const restrictions = splitList(f.restrictions);
  const restrictionText = [f.restrictions, f.cityPlanning, f.fireZone].filter(Boolean).join(' ');
  const zoningRaw = f.zoning ?? restrictions.find((r) => normalizeZoning(r));
  const zoning = normalizeZoning(zoningRaw)?.name ?? zoningRaw;
  const heightDistrict = restrictions.find((r) => r.includes('高度地区'));

  const listing: Listing = {
    id: stableId(source.id, seed),
    source: source.id,
    sourceLabel: source.label,
    url: f.url,
    title: f.title ?? `${city}${addr.rest ?? ''} 売地`,
    prefecture: prefecture!,
    city: city!,
    address: (f.city || f.prefecture ? f.address : addr.rest) ?? '',
    lat: f.lat ? Number(f.lat) : undefined,
    lng: f.lng ? Number(f.lng) : undefined,
    price: price!,
    landArea: landArea!,
    landAreaNote: f.area && /実測|公簿/.test(f.area) ? (f.area.includes('実測') ? '実測' : '公簿') : undefined,
    stations: parseStations(f.stations),
    zoning,
    coverageRatio: ratios.coverageRatio ?? parsePercent(f.coverage),
    floorAreaRatio: ratios.floorAreaRatio ?? parsePercent(f.far),
    cityPlanning: parseCityPlanning(restrictionText) ?? (zoning ? '市街化区域' : undefined),
    fireZone: parseFireZone(restrictionText),
    heightDistrict,
    roads: parseRoads(f.roads),
    landCategory: f.landCategory,
    shape: parseShape([f.shape, f.notes].filter(Boolean).join(' ')),
    terrain: parseTerrain([f.terrain, f.notes].filter(Boolean).join(' ')),
    buildingCondition: parseBuildingCondition(f.buildingCondition),
    status: f.status,
    rights: f.rights,
    delivery: f.delivery,
    otherRestrictions: restrictions.length ? restrictions : undefined,
    notes: f.notes,
    updatedAt: f.updatedAt,
  };
  if (listing.stations.length === 0) warnings.push('交通情報を読み取れませんでした');
  if (listing.roads.length === 0) warnings.push('接道情報を読み取れませんでした');
  if (!listing.zoning) warnings.push('用途地域を読み取れませんでした');
  return { listing, missing, warnings };
}
