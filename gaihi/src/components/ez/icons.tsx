// ボタン用の小さな白抜きアイコン（茶色の丸の中に置く）
const P = { fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const icons = {
  save: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3.2" {...P} />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" {...P} />
    </svg>
  ),
  print: (
    <svg viewBox="0 0 24 24">
      <path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z" {...P} />
    </svg>
  ),
  export: (
    <svg viewBox="0 0 24 24">
      <path d="M14 3h7v7M21 3l-9 9M19 14v6H4V5h6" {...P} />
    </svg>
  ),
  refresh: (
    <svg viewBox="0 0 24 24">
      <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" {...P} />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 24 24">
      <path d="M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3" {...P} />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24">
      <path d="M5 12.5l4.5 4.5L19 7" {...P} strokeWidth={3} />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24">
      <path d="M12 5v14M5 12h14" {...P} strokeWidth={3} />
    </svg>
  ),
  minus: (
    <svg viewBox="0 0 24 24">
      <path d="M5 12h14" {...P} strokeWidth={3.4} />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24">
      <path d="M6 6l12 12M18 6L6 18" {...P} strokeWidth={3.2} />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24">
      <path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" {...P} />
    </svg>
  ),
  upload: (
    <svg viewBox="0 0 24 24">
      <path d="M12 16V4M7 9l5-5 5 5M4 20h16" {...P} />
    </svg>
  ),
  doc: (
    <svg viewBox="0 0 24 24">
      <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" {...P} />
    </svg>
  ),
  grid: (
    <svg viewBox="0 0 24 24">
      <path d="M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16" {...P} strokeWidth={1.8} />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24">
      <path d="M8 8h12v12H8zM4 16V4h12" {...P} />
    </svg>
  ),
  ai: (
    <svg viewBox="0 0 24 24">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z" {...P} strokeWidth={1.8} />
    </svg>
  ),
  house: (
    <svg viewBox="0 0 48 48" width="30" height="30">
      <path d="M8 22L24 9l16 13M12 19v19h24V19" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M20 38V28h8v10" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinejoin="round" />
      <path d="M31 13v-3h4v6.5" fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  ),
  list: (
    <svg viewBox="0 0 48 48" width="30" height="30">
      <path d="M12 12h26M12 24h26M12 36h26" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="7" cy="12" r="2" fill="#fff" />
      <circle cx="7" cy="24" r="2" fill="#fff" />
      <circle cx="7" cy="36" r="2" fill="#fff" />
    </svg>
  ),
};

export type IconName = keyof typeof icons;
