// 画面全体で使う小さなUI部品（アイコン・ランクバッジ・スコアリング・セグメント切替など）
import type { ReactNode } from 'react';
import type { CriterionStatus, HazardSummary, Importance, Rank } from '../shared/types';

const PATHS: Record<string, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.35-4.35',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  split: 'M3 4h18v16H3zM12 4v16',
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  print: 'M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12l5 5L20 7',
  near: 'M5 12h14',
  miss: 'M6 6l12 12M18 6 6 18',
  question: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 4h.01',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 16v-4m0-4h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  scale: 'M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0L5 7zm14 0-3 7a4 4 0 0 0 6 0l-3-7zM8 21h8',
  home: 'M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  train: 'M8 3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm-3 8h14M8 21l2-4m6 4-2-4M9 14h.01M15 14h.01',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  external: 'M14 4h6v6m0-6L10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  pin: 'M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  save: 'M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2 0v5h8V3M7 21v-7h10v7',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  layers: 'M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5',
  building: 'M4 21V5l8-3 8 3v16M9 21v-4h6v4M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01',
  tree: 'M12 22v-6m0 0-4-4h2L6 8h2L12 2l4 6h2l-4 4h2z',
  chevron: 'M9 6l6 6-6 6',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
};

export function Icon({ name, size = 18, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}

export const RANK_LABEL: Record<Rank, string> = { high: '優先度：高', medium: '優先度：中', low: '優先度：低', out: '対象外' };
export const RANK_SHORT: Record<Rank, string> = { high: '高', medium: '中', low: '低', out: '外' };
export const RANK_DESC: Record<Rank, string> = {
  high: 'すべての条件を満たす',
  medium: '必須・重視条件を満たし一部妥協',
  low: '重視条件の未達・必須が惜しい',
  out: '必須条件が未達',
};

export function RankBadge({ rank, compact }: { rank: Rank; compact?: boolean }) {
  return <span className={`rank-badge rank-${rank}`}>{compact ? RANK_SHORT[rank] : RANK_LABEL[rank]}</span>;
}

export function ScoreRing({ score, rank, size = 52 }: { score: number; rank: Rank; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={`score-ring rank-${rank}`} style={{ width: size, height: size }} title={`適合スコア ${score}点`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} className="track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="value"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span>{score}</span>
    </div>
  );
}

const STATUS_ICON: Record<CriterionStatus, string> = { match: 'check', near: 'near', miss: 'miss', unknown: 'question' };
export const STATUS_LABEL: Record<CriterionStatus, string> = { match: '満たす', near: '惜しい', miss: '満たさない', unknown: '情報不足' };

export function StatusIcon({ status, size = 14 }: { status: CriterionStatus; size?: number }) {
  return (
    <span className={`status-icon st-${status}`} title={STATUS_LABEL[status]}>
      <Icon name={STATUS_ICON[status]} size={size} />
    </span>
  );
}

export const IMPORTANCE_LABEL: Record<Importance, string> = { must: '必須', want: '重視', nice: '希望' };

export function HazardBadges({ hazard, max = 3 }: { hazard?: HazardSummary; max?: number }) {
  if (!hazard) return <span className="hz-badge hz-pending">ハザード取得中…</span>;
  if (hazard.overall === 'unknown') return <span className="hz-badge hz-pending">ハザード未取得</span>;
  if (hazard.badges.length === 0) return <span className="hz-badge hz-0"><Icon name="shield" size={13} />主要ハザード区域外</span>;
  const shown = hazard.badges.slice(0, max);
  return (
    <>
      {shown.map((b) => (
        <span key={b.label} className={`hz-badge hz-${b.severity}`}>
          {b.label}
        </span>
      ))}
      {hazard.badges.length > max && <span className="hz-badge hz-more">+{hazard.badges.length - max}</span>}
    </>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  return (
    <div className={`segmented seg-${size}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      <span className="toggle-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function Empty({ icon = 'search', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

/** 最小限のMarkdown表示（見出し・箇条書き・太字・リンク）。HTMLはエスケープする */
export function Markdown({ text }: { text: string }) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[(.+?)\]\((https?:\/\/[^\s)"]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  const html: string[] = [];
  let inList = false;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*[-*・]\s+(.*)/);
    if (li) {
      if (!inList) html.push('<ul>');
      inList = true;
      html.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) html.push(`<h${Math.min(h[1].length + 2, 5)}>${inline(h[2])}</h${Math.min(h[1].length + 2, 5)}>`);
    else if (line.trim()) html.push(`<p>${inline(line)}</p>`);
  }
  if (inList) html.push('</ul>');
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html.join('') }} />;
}
