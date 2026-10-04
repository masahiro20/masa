// 各取得元から物件を集約し、重複除去 → ハザード付与 → 条件評価 → ランク分けを行う。
import type { EvaluatedListing, HazardReport, Listing, Rank, SearchConditions, SearchResponse } from '../../shared/types';
import { mapLimit } from '../http';
import { geocode } from '../geocode';
import { getHazardReport } from '../insight/hazard';
import { importedSource } from '../sources/imported';
import { sampleSource } from '../sources/sample';
import type { SourceAdapter } from '../sources/types';
import { evaluateListing, sortEvaluated } from './scoring';

export const SOURCES: SourceAdapter[] = [importedSource, sampleSource];

/* ---------- ハザードの非同期取得（検索のたびに待たないようキャッシュ） ---------- */

const hazardJobs = new Map<string, Promise<HazardReport | undefined>>();

const hazardKey = (l: Listing) => `${l.lat?.toFixed(5)},${l.lng?.toFixed(5)}`;

export function ensureHazard(l: Listing): Promise<HazardReport | undefined> {
  if (l.lat == null || l.lng == null) return Promise.resolve(undefined);
  const key = hazardKey(l);
  let job = hazardJobs.get(key);
  if (!job) {
    job = getHazardReport(l.lat, l.lng).catch(() => undefined);
    hazardJobs.set(key, job);
    // 取得失敗（unknown を含む）結果は次回再取得できるよう登録を外す
    job.then((r) => {
      if (!r || r.layers.some((x) => x.status === 'unknown')) hazardJobs.delete(key);
    });
  }
  return job;
}

/** 起動時・取り込み時に全物件のハザードを先読みしておく */
export async function warmHazards(listings: Listing[]) {
  await mapLimit(listings, 3, (l) => ensureHazard(l));
}

async function hazardWithin(l: Listing, budgetMs: number) {
  const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), budgetMs));
  return Promise.race([ensureHazard(l), timeout]);
}

/* ---------- 集約 ---------- */

export async function collectListings(conditions?: SearchConditions) {
  const sources: SearchResponse['sources'] = [];
  const all: Listing[] = [];
  for (const s of SOURCES) {
    if (!s.enabled()) continue;
    try {
      const items = conditions ? await s.search(conditions) : await s.all();
      sources.push({ id: s.id, label: s.label, count: items.length });
      all.push(...items);
    } catch (e) {
      sources.push({ id: s.id, label: s.label, count: 0, error: (e as Error).message });
    }
  }
  return { listings: dedupe(all), sources };
}

/** 同一物件が複数の取得元に掲載されている場合は、先に登録された取得元（取り込み物件）を優先して1件にまとめる */
export function dedupe(list: Listing[]): Listing[] {
  const out: Listing[] = [];
  for (const l of list) {
    const dup = out.find(
      (o) =>
        (o.url && o.url === l.url) ||
        (o.prefecture === l.prefecture &&
          o.city === l.city &&
          o.address === l.address &&
          Math.abs(o.landArea - l.landArea) < 1 &&
          Math.abs(o.price - l.price) <= Math.max(10, o.price * 0.02)),
    );
    if (!dup) out.push(l);
  }
  return out;
}

export async function search(conditions: SearchConditions): Promise<SearchResponse & { hazardPending: boolean }> {
  const { listings, sources } = await collectListings(conditions);
  const prefs = new Set(conditions.areas.map((a) => a.prefecture));
  const candidates = prefs.size ? listings.filter((l) => prefs.has(l.prefecture)) : listings;

  let hazardPending = false;
  const evaluated: EvaluatedListing[] = await mapLimit(candidates, 8, async (l) => {
    const report = await hazardWithin(l, 6000);
    if (!report && l.lat != null) hazardPending = true;
    const summary = report && { overall: report.overall, maxInundation: report.maxInundation, sediment: report.sediment, badges: report.badges };
    return evaluateListing(l, conditions, summary);
  });

  const results = sortEvaluated(evaluated);
  const counts: Record<Rank, number> = { high: 0, medium: 0, low: 0, out: 0 };
  for (const r of results) counts[r.rank]++;

  return { conditions, results, counts, sources, generatedAt: new Date().toISOString(), hazardPending };
}

/** 緯度経度のない物件を住所から補完する */
export async function fillCoordinates(listings: Listing[]): Promise<Listing[]> {
  return mapLimit(listings, 3, async (l) => {
    if (l.lat != null && l.lng != null) return l;
    try {
      const g = await geocode(`${l.prefecture}${l.city}${l.address}`);
      return g ? { ...l, lat: g.lat, lng: g.lng } : l;
    } catch {
      return l;
    }
  });
}
