// 国土地理院 住所検索API（APIキー不要）で住所を緯度経度に変換する
import { fetchWithTimeout, USER_AGENT } from './http';
import { JsonCache } from './insight/cache';

export interface GeocodeResult { lat: number; lng: number; title: string }

const cache = new JsonCache<GeocodeResult | null>('geocode', 1000 * 60 * 60 * 24 * 180);

export async function geocode(address: string): Promise<GeocodeResult | null> {
  const q = address.replace(/\s+/g, '');
  const hit = cache.get(q);
  if (hit !== undefined) return hit;
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`;
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } }, 10_000);
  if (!res.ok) throw new Error(`geocode ${res.status}`);
  const list = (await res.json()) as { geometry: { coordinates: [number, number] }; properties: { title: string } }[];
  const first = list[0];
  const result = first
    ? { lng: first.geometry.coordinates[0], lat: first.geometry.coordinates[1], title: first.properties.title }
    : null;
  cache.set(q, result);
  return result;
}
