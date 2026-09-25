import './env';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type { Listing, SearchConditions } from '../shared/types';
import { ZONING_GROUP_LABELS } from '../shared/zoning';
import { geocode } from './geocode';
import { decodeCsv, parseCsv } from './import/csv';
import { importFromUrl } from './import/url';
import { aiAvailable, AI_MODEL, generateAiProposal } from './insight/ai';
import { HAZARD_LAYERS, HAZARD_TILE_BASE } from './insight/hazard';
import { buildInsight } from './insight/index';
import { DIST_DIR } from './paths';
import { CRITERION_LABELS, DEFAULT_IMPORTANCE } from './search/scoring';
import { collectListings, fillCoordinates, search, SOURCES, warmHazards } from './search/service';
import { PREFECTURES } from './import/parse';
import { importedStore } from './sources/imported';
import { portalLinks } from './sources/portals';

const app = express();
app.use(express.json({ limit: '2mb' }));
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

function readConditions(body: unknown): SearchConditions {
  const c = (body ?? {}) as Partial<SearchConditions>;
  return { ...c, areas: Array.isArray(c.areas) ? c.areas : [], importance: c.importance ?? {} };
}

app.get(
  '/api/meta',
  wrap(async (_req, res) => {
    const { listings } = await collectListings();
    const cities: Record<string, string[]> = {};
    for (const l of listings) (cities[l.prefecture] ??= []).includes(l.city) || cities[l.prefecture].push(l.city);
    for (const list of Object.values(cities)) list.sort((a, b) => a.localeCompare(b, 'ja'));
    res.json({
      prefectures: PREFECTURES,
      cities,
      sources: SOURCES.map((s) => ({ id: s.id, label: s.label, description: s.description, enabled: s.enabled() })),
      criteria: CRITERION_LABELS,
      defaultImportance: DEFAULT_IMPORTANCE,
      zoningGroups: ZONING_GROUP_LABELS,
      hazardLayers: HAZARD_LAYERS.map((l) => ({ key: l.key, label: l.label, url: `${HAZARD_TILE_BASE}/${l.path}/{z}/{x}/{y}.png` })),
      aiAvailable: aiAvailable(),
      aiModel: aiAvailable() ? AI_MODEL : undefined,
    });
  }),
);

app.post(
  '/api/search',
  wrap(async (req, res) => {
    const conditions = readConditions(req.body);
    const result = await search(conditions);
    res.json({ ...result, portalLinks: portalLinks(conditions.areas) });
  }),
);

app.post(
  '/api/insight',
  wrap(async (req, res) => {
    const { id, conditions } = req.body as { id: string; conditions: SearchConditions };
    const r = await buildInsight(id, readConditions(conditions));
    if (!r) return res.status(404).json({ error: '物件が見つかりません' });
    res.json({ ...r.insight, evaluated: r.evaluated });
  }),
);

app.post(
  '/api/ai-proposal',
  wrap(async (req, res) => {
    if (!aiAvailable()) return res.status(400).json({ error: 'ANTHROPIC_API_KEY が設定されていないため、AI提案は利用できません。' });
    const { id, conditions } = req.body as { id: string; conditions: SearchConditions };
    const r = await buildInsight(id, readConditions(conditions));
    if (!r) return res.status(404).json({ error: '物件が見つかりません' });
    const criteriaText = r.evaluated.criteria.map((c) => `- ${c.label}（${c.importance}）: ${c.status} ${c.detail}`).join('\n');
    res.json(await generateAiProposal(r.insight, criteriaText));
  }),
);

/* ---------------- 取り込み ---------------- */

app.post(
  '/api/import/csv',
  upload.single('file'),
  wrap(async (req, res) => {
    const text = req.file ? decodeCsv(req.file.buffer) : String((req.body as { text?: string }).text ?? '');
    if (!text.trim()) return res.status(400).json({ error: 'CSVが空です' });
    const result = parseCsv(text, req.file?.originalname ? `CSV: ${req.file.originalname}` : 'CSV取り込み');
    const listings = await fillCoordinates(result.listings);
    importedStore.upsert(listings);
    void warmHazards(listings);
    res.json({ ...result, listings, imported: listings.length, geocoded: listings.filter((l) => l.lat != null).length });
  }),
);

app.post(
  '/api/import/url',
  wrap(async (req, res) => {
    const { url } = req.body as { url?: string };
    if (!url) return res.status(400).json({ error: 'URLを入力してください' });
    const r = await importFromUrl(url);
    if (r.listing) [r.listing] = await fillCoordinates([r.listing]);
    res.json(r);
  }),
);

app.post(
  '/api/imported',
  wrap(async (req, res) => {
    const { listing } = req.body as { listing: Listing };
    if (!listing?.id || !listing.prefecture || !listing.city || !(listing.price > 0) || !(listing.landArea > 0)) {
      return res.status(400).json({ error: '所在地・価格・面積は必須です' });
    }
    const [filled] = await fillCoordinates([{ ...listing, source: listing.source || 'import' }]);
    importedStore.upsert([filled]);
    void warmHazards([filled]);
    res.json({ listing: filled });
  }),
);

app.get('/api/imported', (_req, res) => {
  res.json({ listings: importedStore.list() });
});

app.delete('/api/imported/:id', (req, res) => {
  res.json({ removed: importedStore.remove(req.params.id) });
});

app.delete('/api/imported', (_req, res) => {
  importedStore.clear();
  res.json({ ok: true });
});

app.get(
  '/api/geocode',
  wrap(async (req, res) => {
    res.json({ result: await geocode(String(req.query.q ?? '')) });
  }),
);

/* ---------------- 本番: ビルド済みフロントエンド ---------------- */

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'サーバーエラーが発生しました' });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`土地さがしナビ API: http://localhost:${port}`);
  collectListings()
    .then(({ listings }) => warmHazards(listings))
    .then(() => console.log('ハザード情報の先読みが完了しました'))
    .catch((e) => console.warn('ハザード先読みに失敗:', e));
});
