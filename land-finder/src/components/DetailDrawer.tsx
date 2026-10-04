import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EvaluatedListing, RegulationCategory, SearchConditions } from '../../shared/types';
import { formatManYen, round, sqmToTsubo } from '../../shared/units';
import { api, type AiProposal, type InsightResult, type Meta } from '../api';
import { Empty, HazardBadges, Icon, IMPORTANCE_LABEL, Markdown, RankBadge, RANK_DESC, ScoreRing, StatusIcon, STATUS_LABEL } from '../ui';
import { MapView } from './MapView';

type Tab = 'overview' | 'hazard' | 'law' | 'area' | 'proposal';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'overview', label: '概要・条件', icon: 'home' },
  { key: 'hazard', label: 'ハザード', icon: 'shield' },
  { key: 'law', label: '法令・条例', icon: 'scale' },
  { key: 'area', label: '地域特性', icon: 'tree' },
  { key: 'proposal', label: '提案書', icon: 'print' },
];

interface Props {
  item: EvaluatedListing;
  conditions: SearchConditions;
  meta: Meta;
  onClose: () => void;
}

export function DetailDrawer({ item, conditions, meta, onClose }: Props) {
  const id = item.listing.id;
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<InsightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<{ loading: boolean; result?: AiProposal; error?: string }>({ loading: false });

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    setAi({ loading: false });
    api
      .insight(id, conditions)
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const runAi = () => {
    setAi({ loading: true });
    api
      .aiProposal(id, conditions)
      .then((result) => setAi({ loading: false, result }))
      .catch((e: Error) => setAi({ loading: false, error: e.message }));
  };

  const ev = data?.evaluated ?? item;
  const l = ev.listing;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${l.title}の詳細`} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div className="drawer-head-main">
            <div className="drawer-kicker">
              <RankBadge rank={ev.rank} />
              <span className="muted small">{RANK_DESC[ev.rank]}</span>
            </div>
            <h2>{l.title}</h2>
            <p className="drawer-address">
              <Icon name="pin" size={14} />
              {l.prefecture}
              {l.city}
              {l.address}
              <span className="source-pill">{l.sourceLabel}</span>
              {l.url && (
                <a href={l.url} target="_blank" rel="noreferrer" className="link-inline">
                  掲載ページ <Icon name="external" size={12} />
                </a>
              )}
            </p>
          </div>
          <div className="drawer-head-figures">
            <div>
              <span className="figure-label">価格</span>
              <strong className="big-price">{formatManYen(l.price)}</strong>
            </div>
            <div>
              <span className="figure-label">面積</span>
              <strong>{round(l.landArea, 1)}㎡</strong>
              <span className="figure-sub">{ev.derived.tsubo}坪・坪{round(ev.derived.pricePerTsubo, 1)}万円</span>
            </div>
            <ScoreRing score={ev.score} rank={ev.rank} size={60} />
          </div>
          <button type="button" className="icon-btn drawer-close" onClick={onClose} aria-label="閉じる">
            <Icon name="close" />
          </button>
        </header>

        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
              <Icon name={t.icon} size={16} />
              {t.label}
              {t.key === 'hazard' && data?.hazard && data.hazard.overall !== 'low' && <i className={`tab-dot hz-dot-${data.hazard.overall}`} />}
              {t.key === 'law' && data && data.regulations.items.some((i) => i.severity === 'warning') && <i className="tab-dot hz-dot-moderate" />}
            </button>
          ))}
        </nav>

        <div className="drawer-body">
          {error && <Empty icon="alert" title="情報を取得できませんでした">{error}</Empty>}
          {!error && !data && <LoadingBlock />}
          {data && tab === 'overview' && <OverviewTab data={data} meta={meta} />}
          {data && tab === 'hazard' && <HazardTab data={data} meta={meta} />}
          {data && tab === 'law' && <LawTab data={data} />}
          {data && tab === 'area' && <AreaTab data={data} />}
          {data && tab === 'proposal' && <ProposalTab data={data} conditions={conditions} ai={ai} onRunAi={runAi} aiModel={meta.aiModel} />}
        </div>
      </aside>
      {data && createPortal(<ProposalSheet data={data} conditions={conditions} ai={ai.result} />, document.body)}
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="loading-block">
      <div className="skeleton" style={{ width: '60%' }} />
      <div className="skeleton" style={{ width: '90%' }} />
      <div className="skeleton" style={{ width: '75%' }} />
      <p className="muted small">ハザードマップ・周辺施設の情報を取得しています…</p>
    </div>
  );
}

/* ---------------- 概要 ---------------- */

function OverviewTab({ data, meta }: { data: InsightResult; meta: Meta }) {
  const ev = data.evaluated;
  const l = data.listing;
  const rows: [string, string | undefined][] = [
    ['所在地', `${l.prefecture}${l.city}${l.address}`],
    ['価格', `${formatManYen(l.price)}（坪単価 ${round(ev.derived.pricePerTsubo, 1)}万円）`],
    ['土地面積', `${round(l.landArea, 2)}㎡（${ev.derived.tsubo}坪）${l.landAreaNote ? `・${l.landAreaNote}` : ''}`],
    ['交通', l.stations.map((s) => `${s.line ?? ''}「${s.name}」${s.bus ? `バス${s.bus}分 ` : ''}徒歩${s.walk ?? '?'}分`).join(' / ') || undefined],
    ['用途地域', l.zoning],
    ['建ぺい率 / 容積率', l.coverageRatio != null ? `${l.coverageRatio}% / ${l.floorAreaRatio ?? '-'}%` : undefined],
    ['都市計画', l.cityPlanning],
    ['防火指定', l.fireZone],
    ['高度地区', l.heightDistrict],
    ['接道', l.roads.map((r) => `${r.direction ?? ''}側 ${r.kind ?? ''} 幅員${r.width ?? '?'}m${r.frontage ? ` 間口${r.frontage}m` : ''}${r.article ? `（${r.article}）` : ''}`).join(' / ') || undefined],
    ['地目 / 形状 / 地勢', [l.landCategory, l.shape, l.terrain].filter(Boolean).join(' / ') || undefined],
    ['建築条件', l.buildingCondition == null ? undefined : l.buildingCondition ? 'あり' : 'なし'],
    ['現況 / 引渡し', [l.status, l.delivery].filter(Boolean).join(' / ') || undefined],
    ['その他制限', l.otherRestrictions?.join('、')],
    ['情報更新日', l.updatedAt],
  ];
  return (
    <div className="tab-grid">
      <section className="card-section">
        <h3 className="section-title">希望条件との適合</h3>
        <table className="criteria-table">
          <thead>
            <tr>
              <th>条件</th>
              <th>重要度</th>
              <th>判定</th>
              <th>内容</th>
            </tr>
          </thead>
          <tbody>
            {ev.criteria.map((c, i) => (
              <tr key={`${c.key}-${i}`} className={`row-${c.status}`}>
                <td>{c.label}</td>
                <td>
                  <span className={`imp imp-${c.importance}`}>{IMPORTANCE_LABEL[c.importance]}</span>
                </td>
                <td>
                  <span className={`st-label st-${c.status}`}>
                    <StatusIcon status={c.status} size={12} />
                    {STATUS_LABEL[c.status]}
                  </span>
                </td>
                <td>{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ev.criteria.length === 0 && <p className="muted">条件が指定されていません。</p>}
      </section>

      <section className="card-section">
        <h3 className="section-title">提案のポイント</h3>
        <p className="lead">{data.proposal.summary}</p>
        <div className="pros-cons">
          <div>
            <h4 className="pros-title">おすすめポイント</h4>
            <ul className="bullets pros">{data.proposal.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
          <div>
            <h4 className="cons-title">確認・検討が必要な点</h4>
            <ul className="bullets cons">{data.proposal.concerns.length ? data.proposal.concerns.map((s) => <li key={s}>{s}</li>) : <li>特になし</li>}</ul>
          </div>
        </div>
      </section>

      <section className="card-section span-2">
        <h3 className="section-title">物件概要</h3>
        <dl className="spec-list">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
      </section>

      <section className="card-section span-2 no-pad">
        <MapView items={[ev]} meta={meta} single className="map-detail" />
      </section>
    </div>
  );
}

/* ---------------- ハザード ---------------- */

const OVERALL_TEXT = {
  low: { title: '主要なハザード区域外、または軽微', cls: 'ok' },
  moderate: { title: '注意が必要なハザードがあります', cls: 'warn' },
  high: { title: '重大なハザードがあります（計画・立地の再検討を推奨）', cls: 'danger' },
  unknown: { title: 'ハザード情報を取得できませんでした', cls: 'unknown' },
} as const;

function HazardTab({ data, meta }: { data: InsightResult; meta: Meta }) {
  const h = data.hazard;
  const initial = useMemo(() => {
    if (!h) return undefined;
    const keys = h.layers.filter((l) => l.status !== 'none' && l.status !== 'unknown').map((l) => l.key);
    const candidates = ['flood', 'stormSurge', 'tsunami', 'steepSlope', 'debrisFlow', 'landslide'] as const;
    const pick = candidates.filter((k) => keys.includes(k));
    return pick.length ? pick.slice(0, 2) : (['flood'] as const).slice();
  }, [h]);
  if (!h) return <Empty icon="shield" title="ハザード情報なし">{data.hazardError}</Empty>;
  const o = OVERALL_TEXT[h.overall];

  return (
    <div className="tab-grid">
      <section className={`hazard-banner hb-${o.cls} span-2`}>
        <Icon name={h.overall === 'low' ? 'shield' : 'alert'} size={26} />
        <div>
          <strong>{o.title}</strong>
          <div className="hazard-banner-badges">
            <HazardBadges hazard={h} max={8} />
          </div>
        </div>
        {h.elevation != null && (
          <div className="elev">
            <span className="figure-label">標高</span>
            <strong>{round(h.elevation, 1)}m</strong>
          </div>
        )}
      </section>

      <section className="card-section">
        <h3 className="section-title">戸建て計画の観点からの見解</h3>
        <div className="opinions">
          {h.opinions.map((op) => (
            <div key={op.title} className={`opinion sev-${op.severity}`}>
              <strong>{op.title}</strong>
              <p>{op.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card-section">
        <h3 className="section-title">レイヤー別の判定</h3>
        <table className="layer-table">
          <tbody>
            {h.layers.map((layer) => (
              <tr key={layer.key}>
                <td>{layer.label}</td>
                <td>
                  <span className={`layer-status ls-${layer.status} sev-${layer.severity}`}>
                    {layer.status === 'inside' ? layer.level : layer.status === 'nearby' ? `近接（${layer.level}）` : layer.status === 'none' ? '該当なし' : '取得失敗'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          出典：国土交通省「重ねるハザードマップ」オープンデータ（想定最大規模）。地点は町丁目の代表点のため、実際の敷地位置で必ず再確認してください。
        </p>
        <a className="btn btn-ghost btn-sm" href={h.portalUrl} target="_blank" rel="noreferrer">
          重ねるハザードマップで開く <Icon name="external" size={14} />
        </a>
      </section>

      <section className="card-section span-2 no-pad">
        <MapView items={[data.evaluated]} meta={meta} single initialOverlays={initial} className="map-detail" />
      </section>
    </div>
  );
}

/* ---------------- 法令・条例 ---------------- */

const CATEGORY_ORDER: RegulationCategory[] = ['用途地域', '建ぺい率・容積率', '高さ・斜線', '防火', '接道', '土地・造成', '条例', 'その他'];

function LawTab({ data }: { data: InsightResult }) {
  const { items, volume: v } = data.regulations;
  const groups = CATEGORY_ORDER.map((cat) => ({ cat, items: items.filter((i) => i.category === cat) })).filter((g) => g.items.length);
  const maxBar = Math.max(v.siteArea, v.maxFloorArea ?? 0);
  const bars: { label: string; value?: number; cls: string }[] = [
    { label: '敷地面積', value: v.siteArea, cls: 'bar-site' },
    ...(v.setbackArea > 0 ? [{ label: 'セットバック後', value: v.effectiveArea, cls: 'bar-eff' }] : []),
    { label: `建築面積（建ぺい率${v.coverageRatio ?? '-'}%）`, value: v.maxBuildingArea, cls: 'bar-build' },
    { label: `延床面積（容積率${v.effectiveFAR ?? '-'}%）`, value: v.maxFloorArea, cls: 'bar-floor' },
  ];
  const warnings = items.filter((i) => i.severity === 'warning').length;
  const checks = items.filter((i) => i.needsCheck).length;

  return (
    <div className="tab-grid">
      <section className="card-section">
        <h3 className="section-title">建てられるボリュームの目安</h3>
        <div className="volume-bars">
          {bars.map((b) => (
            <div key={b.label} className="vbar">
              <span className="vbar-label">{b.label}</span>
              <div className="vbar-track">
                <div className={`vbar-fill ${b.cls}`} style={{ width: `${b.value ? (b.value / maxBar) * 100 : 0}%` }} />
              </div>
              <span className="vbar-value">
                {b.value != null ? `${round(b.value, 1)}㎡` : '-'}
                {b.value != null && <small>{round(sqmToTsubo(b.value), 1)}坪</small>}
              </span>
            </div>
          ))}
        </div>
        {v.notes.length > 0 && <ul className="bullets small">{v.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        <p className="hint">斜線制限・日影規制・条例による実際の建築可能範囲は、建築士によるボリュームチェックで確認してください。</p>
      </section>

      <section className="card-section">
        <h3 className="section-title">チェック結果</h3>
        <div className="law-stats">
          <div className={warnings ? 'stat stat-warn' : 'stat'}>
            <strong>{warnings}</strong>
            <span>重要な注意点</span>
          </div>
          <div className="stat">
            <strong>{items.length - warnings}</strong>
            <span>確認事項</span>
          </div>
          <div className="stat">
            <strong>{checks}</strong>
            <span>要・役所確認</span>
          </div>
        </div>
        <p className="hint">法令・条例は改正されることがあります。「要確認」の項目は所管の特定行政庁で最新の内容を確認してください。</p>
      </section>

      <section className="card-section span-2">
        {groups.map((g) => (
          <div key={g.cat} className="law-group">
            <h4 className="law-cat">{g.cat}</h4>
            {g.items.map((i) => (
              <div key={i.title} className={`law-item sev-${i.severity}`}>
                <div className="law-item-head">
                  <Icon name={i.severity === 'warning' ? 'alert' : i.severity === 'caution' ? 'info' : 'check'} size={16} />
                  <strong>{i.title}</strong>
                  {i.needsCheck && <span className="need-check">要確認</span>}
                </div>
                <p>{i.detail}</p>
                {(i.basis || i.link) && (
                  <p className="law-basis">
                    {i.basis && <>根拠：{i.basis}</>}
                    {i.link && (
                      <a href={i.link} target="_blank" rel="noreferrer">
                        条文を検索 <Icon name="external" size={12} />
                      </a>
                    )}
                  </p>
                )}
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}

/* ---------------- 地域特性 ---------------- */

const FACILITY_ICON: Record<string, string> = {
  elementary: 'home',
  juniorHigh: 'building',
  childcare: 'sparkle',
  supermarket: 'save',
  convenience: 'pin',
  medical: 'shield',
  park: 'tree',
};

function AreaTab({ data }: { data: InsightResult }) {
  const a = data.area;
  return (
    <div className="tab-grid">
      <section className="card-section span-2 area-hero">
        <span className="figure-label">エリアの印象</span>
        <strong className="area-headline">{a.headline}</strong>
        {a.cityProfile && (
          <p className="city-profile">
            <b>{data.listing.city}</b>　{a.cityProfile}
          </p>
        )}
      </section>

      <section className="card-section">
        <h3 className="section-title">地域の特性</h3>
        <div className="points">
          {a.points.map((p) => (
            <div key={p.title} className="point">
              <strong>{p.title}</strong>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card-section">
        <h3 className="section-title">徒歩圏の施設（半径800m）</h3>
        {a.facilities ? (
          <div className="facility-grid">
            {a.facilities.map((f) => (
              <div key={f.key} className={`facility ${f.count === 0 ? 'none' : ''}`}>
                <Icon name={FACILITY_ICON[f.key] ?? 'pin'} size={18} />
                <span className="facility-label">{f.label}</span>
                <strong>{f.count}</strong>
                <small>{f.nearestMeters != null ? `最寄り 約${f.nearestMeters}m${f.nearestName ? `・${f.nearestName}` : ''}` : 'なし'}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">{a.facilitiesError ?? '位置情報がないため取得できません'}</p>
        )}
        <p className="hint">出典：© OpenStreetMap contributors（ODbL）。登録状況により実際と異なる場合があります。</p>
      </section>
    </div>
  );
}

/* ---------------- 提案書 ---------------- */

function ProposalTab({
  data,
  conditions,
  ai,
  onRunAi,
  aiModel,
}: {
  data: InsightResult;
  conditions: SearchConditions;
  ai: { loading: boolean; result?: AiProposal; error?: string };
  onRunAi: () => void;
  aiModel?: string;
}) {
  return (
    <div className="proposal-tab">
      <div className="proposal-actions">
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          <Icon name="print" />
          提案書を印刷・PDF保存
        </button>
        {data.aiAvailable ? (
          <button type="button" className="btn btn-ai" onClick={onRunAi} disabled={ai.loading}>
            <Icon name={ai.loading ? 'refresh' : 'sparkle'} className={ai.loading ? 'spin' : ''} />
            {ai.loading ? 'AIが地域を調査中…（1〜2分）' : ai.result ? 'AIコメントを再生成' : 'AIで地域調査・提案コメントを作成'}
          </button>
        ) : (
          <span className="muted small">ANTHROPIC_API_KEY を設定すると、AIによる地域調査・提案コメントを追加できます。</span>
        )}
      </div>
      {ai.error && <p className="error-text">{ai.error}</p>}
      <div className="proposal-preview">
        <ProposalBody data={data} conditions={conditions} ai={ai.result} />
      </div>
      {aiModel && ai.result && <p className="hint">AIコメント：{ai.result.model}（Web検索あり）。内容は参考情報です。</p>}
    </div>
  );
}

function ProposalSheet({ data, conditions, ai }: { data: InsightResult; conditions: SearchConditions; ai?: AiProposal }) {
  return (
    <div className="print-only">
      <ProposalBody data={data} conditions={conditions} ai={ai} />
    </div>
  );
}

function ProposalBody({ data, conditions, ai }: { data: InsightResult; conditions: SearchConditions; ai?: AiProposal }) {
  const ev = data.evaluated;
  const l = data.listing;
  const h = data.hazard;
  const v = data.regulations.volume;
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  return (
    <article className="proposal">
      <header className="proposal-head">
        <div>
          <p className="proposal-kicker">土地のご提案</p>
          <h1>{l.title}</h1>
          <p>
            {l.prefecture}
            {l.city}
            {l.address}
          </p>
        </div>
        <div className="proposal-meta">
          {conditions.customerName && <p className="proposal-customer">{conditions.customerName}</p>}
          <p>{today}</p>
          <RankBadge rank={ev.rank} />
          <p className="small">適合スコア {ev.score}点</p>
        </div>
      </header>

      <section className="proposal-figures">
        <div>
          <span>価格</span>
          <strong>{formatManYen(l.price)}</strong>
        </div>
        <div>
          <span>土地面積</span>
          <strong>
            {round(l.landArea, 1)}㎡（{ev.derived.tsubo}坪）
          </strong>
        </div>
        <div>
          <span>坪単価</span>
          <strong>{round(ev.derived.pricePerTsubo, 1)}万円</strong>
        </div>
        <div>
          <span>建ぺい率/容積率</span>
          <strong>
            {l.coverageRatio ?? '-'}% / {l.floorAreaRatio ?? '-'}%
          </strong>
        </div>
        <div>
          <span>延床の上限（目安）</span>
          <strong>{v.maxFloorArea != null ? `${v.maxFloorArea}㎡` : '-'}</strong>
        </div>
      </section>

      <section>
        <h2>総評</h2>
        <p>{data.proposal.summary}</p>
      </section>

      <div className="proposal-cols">
        <section>
          <h2>おすすめポイント</h2>
          <ul>{data.proposal.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
        <section>
          <h2>確認・検討が必要な点</h2>
          <ul>{data.proposal.concerns.length ? data.proposal.concerns.map((s) => <li key={s}>{s}</li>) : <li>特になし</li>}</ul>
        </section>
      </div>

      <section>
        <h2>ハザードに対する見解</h2>
        {h ? (
          <ul>
            {h.opinions.map((o) => (
              <li key={o.title}>
                <b>{o.title}</b>：{o.body}
              </li>
            ))}
          </ul>
        ) : (
          <p>{data.hazardError}</p>
        )}
      </section>

      <section>
        <h2>設計上の法令・条例の注意点</h2>
        <ul>
          {data.regulations.items
            .filter((i) => i.severity !== 'info' || i.category === '用途地域' || i.category === '防火')
            .map((i) => (
              <li key={i.title}>
                <b>{i.title}</b>
                {i.needsCheck ? '（要確認）' : ''}：{i.detail}
              </li>
            ))}
        </ul>
      </section>

      <section>
        <h2>地域の特性</h2>
        {data.area.cityProfile && <p>{data.area.cityProfile}</p>}
        <ul>
          {data.area.points.map((p) => (
            <li key={p.title}>
              <b>{p.title}</b>：{p.body}
            </li>
          ))}
        </ul>
      </section>

      {ai && (
        <section className="proposal-ai">
          <h2>アドバイザーコメント</h2>
          <Markdown text={ai.markdown} />
          {ai.sources.length > 0 && (
            <p className="sources">
              参考：
              {ai.sources.slice(0, 6).map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
              ))}
            </p>
          )}
        </section>
      )}

      <section>
        <h2>次のステップ</h2>
        <ol>{data.proposal.nextSteps.map((s) => <li key={s}>{s}</li>)}</ol>
      </section>

      <footer className="proposal-foot">
        本資料は公開情報・掲載情報をもとに自動作成した参考資料です。ハザード判定は町丁目の代表点による概略判定であり、法令・条例の適用は敷地条件により異なります。契約・設計にあたっては重要事項説明書、役所調査、地盤調査等で必ずご確認ください。
      </footer>
    </article>
  );
}
