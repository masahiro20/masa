import type { EvaluatedListing } from '../../shared/types';
import { formatManYen, round } from '../../shared/units';
import { normalizeZoning } from '../../shared/zoning';
import { HazardBadges, Icon, IMPORTANCE_LABEL, RankBadge, ScoreRing, StatusIcon, STATUS_LABEL } from '../ui';

interface Props {
  item: EvaluatedListing;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onHover: (id: string | null) => void;
}

export function ListingCard({ item, selected, hovered, onSelect, onHover }: Props) {
  const l = item.listing;
  const st = [...l.stations].sort((a, b) => (a.walk ?? 99) - (b.walk ?? 99))[0];
  const zoning = normalizeZoning(l.zoning);
  const road = l.roads.map((r) => `${r.direction ?? ''}${r.width ? ` ${r.width}m` : ''}`).join('・');

  return (
    <article
      className={`listing-card rank-${item.rank} ${selected ? 'is-selected' : ''} ${hovered ? 'is-hovered' : ''}`}
      onMouseEnter={() => onHover(l.id)}
      onMouseLeave={() => onHover(null)}
    >
      <button type="button" className="card-hit" onClick={onSelect} aria-label={`${l.title}の詳細を開く`} />
      <header className="card-head">
        <div className="card-head-main">
          <RankBadge rank={item.rank} />
          <h3 className="card-title">{l.title}</h3>
          <p className="card-address">
            <Icon name="pin" size={13} />
            {l.prefecture}
            {l.city}
            {l.address}
          </p>
        </div>
        <ScoreRing score={item.score} rank={item.rank} />
      </header>

      <div className="card-figures">
        <div className="figure figure-price">
          <span className="figure-label">価格</span>
          <strong>{formatManYen(l.price)}</strong>
        </div>
        <div className="figure">
          <span className="figure-label">土地面積</span>
          <strong>
            {round(l.landArea, 1)}
            <small>㎡</small>
          </strong>
          <span className="figure-sub">{item.derived.tsubo}坪</span>
        </div>
        <div className="figure">
          <span className="figure-label">坪単価</span>
          <strong>
            {round(item.derived.pricePerTsubo, 1)}
            <small>万円</small>
          </strong>
        </div>
      </div>

      <ul className="card-facts">
        {st && (
          <li>
            <Icon name="train" size={14} />
            {st.name}
            {st.bus ? ` バス${st.bus}分・` : ' '}徒歩{st.walk ?? '?'}分
          </li>
        )}
        {zoning && (
          <li>
            <Icon name="building" size={14} />
            {zoning.short} {l.coverageRatio ?? '-'}/{l.floorAreaRatio ?? '-'}
          </li>
        )}
        {road && (
          <li>
            <Icon name="map" size={14} />
            {road}
          </li>
        )}
      </ul>

      <div className="card-hazard">
        <HazardBadges hazard={item.hazard} />
      </div>

      <ul className="criteria-chips" aria-label="条件の達成状況">
        {item.criteria.map((c, i) => (
          <li key={`${c.key}-${i}`} className={`crit crit-${c.status}`} title={`${c.label}（${IMPORTANCE_LABEL[c.importance]}）：${STATUS_LABEL[c.status]} — ${c.detail}`}>
            <StatusIcon status={c.status} size={12} />
            {c.label}
          </li>
        ))}
      </ul>

      <footer className="card-foot">
        <span className="source">{l.sourceLabel}</span>
        <span className="open-hint">
          詳細・提案を見る <Icon name="chevron" size={14} />
        </span>
      </footer>
    </article>
  );
}
