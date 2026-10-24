import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Rank, SearchConditions } from '../shared/types';
import { api, type Meta, type SearchResult } from './api';
import { DetailDrawer } from './components/DetailDrawer';
import { ImportDialog } from './components/ImportDialog';
import { ListingCard } from './components/ListingCard';
import { MapView } from './components/MapView';
import { SearchPanel } from './components/SearchPanel';
import { Empty, Icon, RANK_DESC, RANK_LABEL, Segmented } from './ui';

const DEFAULT_CONDITIONS: SearchConditions = {
  customerName: '',
  areas: [],
  priceMax: 5000,
  areaMin: 100,
  walkMax: 15,
  zoningGroups: ['lowRise', 'midRise', 'residential'],
  noBuildingCondition: true,
  excludeUrbanControl: true,
  hazardTolerance: 'normal',
  importance: {},
};

const STORE_KEY = 'land-finder.conditions';
const PRESET_KEY = 'land-finder.presets';

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できない環境（プライベートブラウズ等）では無視
  }
}

type RankFilter = Rank | 'all';
type SortKey = 'score' | 'priceAsc' | 'tsuboAsc' | 'areaDesc' | 'walkAsc';
type View = 'split' | 'list' | 'map';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'score', label: 'おすすめ順（ランク・スコア）' },
  { value: 'priceAsc', label: '価格が安い順' },
  { value: 'tsuboAsc', label: '坪単価が安い順' },
  { value: 'areaDesc', label: '面積が広い順' },
  { value: 'walkAsc', label: '駅から近い順' },
];

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [conditions, setConditions] = useState<SearchConditions>(() => ({ ...DEFAULT_CONDITIONS, ...loadJson(STORE_KEY, {}) }));
  const [presets, setPresets] = useState<Record<string, SearchConditions>>(() => loadJson(PRESET_KEY, {}));
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searched, setSearched] = useState<SearchConditions>(conditions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rankFilter, setRankFilter] = useState<RankFilter>('all');
  const [showOut, setShowOut] = useState(false);
  const [sort, setSort] = useState<SortKey>('score');
  const [view, setView] = useState<View>('split');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const refreshTimer = useRef<number>(undefined);
  const refreshCount = useRef(0);

  useEffect(() => {
    api.meta().then(setMeta).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => saveJson(STORE_KEY, conditions), [conditions]);

  const runSearch = useCallback(
    async (c: SearchConditions = conditions, quiet = false) => {
      if (!quiet) {
        setLoading(true);
        refreshCount.current = 0;
      }
      setError(null);
      window.clearTimeout(refreshTimer.current);
      try {
        const r = await api.search(c);
        setResult(r);
        setSearched(c);
        setPanelOpen(false);
        // ハザード未取得の物件があれば数秒後に自動で再評価（最大6回）
        if (r.hazardPending && refreshCount.current++ < 6) refreshTimer.current = window.setTimeout(() => runSearch(c, true), 5000);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [conditions],
  );

  // 初回表示時に前回の条件で検索
  useEffect(() => {
    if (meta && !result) runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  const visible = useMemo(() => {
    if (!result) return [];
    let list = result.results.filter((r) => (rankFilter === 'all' ? showOut || r.rank !== 'out' : r.rank === rankFilter));
    const walk = (x: (typeof list)[number]) => Math.min(...x.listing.stations.map((s) => (s.walk ?? 99) + (s.bus ?? 0) * 2), 99);
    const sorters: Record<SortKey, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      score: () => 0,
      priceAsc: (a, b) => a.listing.price - b.listing.price,
      tsuboAsc: (a, b) => a.derived.pricePerTsubo - b.derived.pricePerTsubo,
      areaDesc: (a, b) => b.listing.landArea - a.listing.landArea,
      walkAsc: (a, b) => walk(a) - walk(b),
    };
    if (sort !== 'score') list = [...list].sort(sorters[sort]);
    return list;
  }, [result, rankFilter, showOut, sort]);

  const selected = result?.results.find((r) => r.listing.id === selectedId);

  const savePreset = () => {
    const name = conditions.customerName?.trim();
    if (!name) return;
    const next = { ...presets, [name]: conditions };
    setPresets(next);
    saveJson(PRESET_KEY, next);
  };
  const deletePreset = (name: string) => {
    const next = { ...presets };
    delete next[name];
    setPresets(next);
    saveJson(PRESET_KEY, next);
  };

  if (!meta) {
    return (
      <div className="boot">
        {error ? (
          <Empty icon="alert" title="サーバーに接続できません">
            {error}（npm run dev でAPIサーバーが起動しているか確認してください）
          </Empty>
        ) : (
          <div className="boot-spinner" aria-label="読み込み中" />
        )}
      </div>
    );
  }

  const counts = result?.counts ?? { high: 0, medium: 0, low: 0, out: 0 };
  const total = counts.high + counts.medium + counts.low;

  return (
    <div className="app-shell">
      <header className="app-bar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="30" height="30">
              <rect width="32" height="32" rx="8" fill="currentColor" />
              <path d="M6 22l7-9 5 6 3-4 5 7z" fill="#fff" />
            </svg>
          </span>
          <div>
            <strong>土地さがしナビ</strong>
            <span>条件に合う土地を集めて、ランク分け・提案まで</span>
          </div>
        </div>
        <div className="app-bar-actions">
          {searched.customerName && (
            <span className="customer-pill">
              <Icon name="home" size={14} />
              {searched.customerName}
            </span>
          )}
          <button type="button" className="btn btn-ghost mobile-only" onClick={() => setPanelOpen(true)}>
            <Icon name="filter" /> 条件
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setImportOpen(true)}>
            <Icon name="upload" /> <span className="hide-sm">物件を取り込む</span>
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className={`sidebar ${panelOpen ? 'open' : ''}`}>
          <div className="sidebar-head mobile-only">
            <strong>検索条件</strong>
            <button type="button" className="icon-btn" onClick={() => setPanelOpen(false)} aria-label="閉じる">
              <Icon name="close" />
            </button>
          </div>
          <SearchPanel
            meta={meta}
            value={conditions}
            onChange={setConditions}
            onSearch={() => runSearch()}
            loading={loading}
            presets={Object.keys(presets)}
            onSavePreset={savePreset}
            onLoadPreset={(n) => {
              const c = { ...DEFAULT_CONDITIONS, ...presets[n] };
              setConditions(c);
              runSearch(c);
            }}
            onDeletePreset={deletePreset}
          />
        </aside>

        <main className="main">
          <section className="rank-summary" aria-label="ランク別の件数">
            {(['high', 'medium', 'low'] as Rank[]).map((r) => (
              <button
                type="button"
                key={r}
                className={`rank-tile rank-${r} ${rankFilter === r ? 'active' : ''}`}
                onClick={() => setRankFilter(rankFilter === r ? 'all' : r)}
                aria-pressed={rankFilter === r}
              >
                <span className="rank-tile-label">{RANK_LABEL[r]}</span>
                <strong>{counts[r]}</strong>
                <span className="rank-tile-desc">{RANK_DESC[r]}</span>
              </button>
            ))}
            <div className="summary-side">
              <div className="summary-total">
                候補 <strong>{total}</strong> 件
                <span className="muted small">（対象外 {counts.out}件）</span>
              </div>
              {result && (
                <div className="source-list">
                  {result.sources.map((s) => (
                    <span key={s.id} className={`source-chip ${s.error ? 'err' : ''}`} title={s.error}>
                      {s.label} {s.count}
                    </span>
                  ))}
                  {result.hazardPending && (
                    <span className="source-chip pending">
                      <Icon name="refresh" size={12} className="spin" /> ハザード取得中
                    </span>
                  )}
                </div>
              )}
            </div>
          </section>

          <div className="toolbar">
            <Segmented<RankFilter>
              value={rankFilter}
              onChange={setRankFilter}
              ariaLabel="ランクで絞り込み"
              options={[
                { value: 'all', label: 'すべて' },
                { value: 'high', label: `高 ${counts.high}` },
                { value: 'medium', label: `中 ${counts.medium}` },
                { value: 'low', label: `低 ${counts.low}` },
                { value: 'out', label: `対象外 ${counts.out}` },
              ]}
            />
            {rankFilter === 'all' && (
              <label className="check small">
                <input type="checkbox" checked={showOut} onChange={(e) => setShowOut(e.target.checked)} />
                <span>対象外も表示</span>
              </label>
            )}
            <div className="toolbar-right">
              <select className="input input-sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="並び替え">
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <Segmented<View>
                value={view}
                onChange={setView}
                ariaLabel="表示切替"
                options={[
                  { value: 'split', label: <Icon name="split" size={16} />, title: 'リスト＋地図' },
                  { value: 'list', label: <Icon name="list" size={16} />, title: 'リスト' },
                  { value: 'map', label: <Icon name="map" size={16} />, title: '地図' },
                ]}
              />
            </div>
          </div>

          {error && <div className="alert-bar">{error}</div>}

          <div className={`results view-${view}`}>
            {view !== 'map' && (
              <div className="card-list">
                {loading && !result && Array.from({ length: 4 }, (_, i) => <div key={i} className="listing-card skeleton-card" />)}
                {result && visible.length === 0 && (
                  <Empty title="該当する土地がありません">
                    条件をゆるめるか、「対象外も表示」で惜しい物件を確認してください。ポータルサイトで直接探す場合は下のリンクから開けます。
                  </Empty>
                )}
                {visible.map((item) => (
                  <ListingCard
                    key={item.listing.id}
                    item={item}
                    selected={item.listing.id === selectedId}
                    hovered={item.listing.id === hoveredId}
                    onSelect={() => setSelectedId(item.listing.id)}
                    onHover={setHoveredId}
                  />
                ))}
                {result && result.portalLinks.length > 0 && (
                  <section className="portal-box">
                    <h3>
                      <Icon name="external" size={16} /> ポータルサイトでも探す
                    </h3>
                    <p className="muted small">気になる物件は詳細ページのURLを「物件を取り込む」に貼り付けると、同じ基準でランク分け・ハザード判定できます。</p>
                    <div className="portal-links">
                      {result.portalLinks.map((p) => (
                        <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="portal-link">
                          <b>{p.portal}</b>
                          <span>{p.label}</span>
                        </a>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
            {view !== 'list' && (
              <div className="map-pane">
                <MapView items={visible} meta={meta} selectedId={selectedId} hoveredId={hoveredId} onSelect={setSelectedId} />
              </div>
            )}
          </div>
        </main>
      </div>

      {selected && <DetailDrawer item={selected} conditions={searched} meta={meta} onClose={() => setSelectedId(null)} />}
      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onChanged={() => {
            api.meta().then(setMeta);
            runSearch(searched, true);
          }}
        />
      )}
      {panelOpen && <div className="scrim mobile-only" onClick={() => setPanelOpen(false)} />}
    </div>
  );
}
