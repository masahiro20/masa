// オリジナルのマスコット「しろくま」。暖かさ（断熱）を連想させるマフラー姿のシロクマ。
// mood：ok＝適合（片手を上げて笑顔）、ng＝不適合（困り顔）、idle＝未入力・通常

type Mood = "ok" | "ng" | "idle";

const INK = "#4a3b2a";
const FUR = "#fffdf8";
const SHADE = "#efe7da";
const SCARF = "#e27a01";
const SCARF_DARK = "#b85f00";
const CHEEK = "#f7b7a3";

function Face({ mood }: { mood: Mood }) {
  return (
    <g>
      {/* 耳 */}
      <circle cx="62" cy="40" r="17" fill={FUR} stroke={INK} strokeWidth="4" />
      <circle cx="138" cy="40" r="17" fill={FUR} stroke={INK} strokeWidth="4" />
      <circle cx="62" cy="41" r="8" fill={CHEEK} />
      <circle cx="138" cy="41" r="8" fill={CHEEK} />
      {/* 頭 */}
      <ellipse cx="100" cy="80" rx="54" ry="50" fill={FUR} stroke={INK} strokeWidth="4" />
      {/* ほっぺ */}
      <ellipse cx="68" cy="98" rx="9" ry="6" fill={CHEEK} opacity="0.8" />
      <ellipse cx="132" cy="98" rx="9" ry="6" fill={CHEEK} opacity="0.8" />
      {/* 目 */}
      {mood === "ok" ? (
        <>
          <path d="M74 80 q8 -9 16 0" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
          <path d="M110 80 q8 -9 16 0" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse cx="82" cy="78" rx="5.5" ry="7" fill={INK} />
          <ellipse cx="118" cy="78" rx="5.5" ry="7" fill={INK} />
          <circle cx="84" cy="75" r="2" fill="#fff" />
          <circle cx="120" cy="75" r="2" fill="#fff" />
        </>
      )}
      {mood === "ng" && (
        <>
          <path d="M72 64 l16 5" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
          <path d="M128 64 l-16 5" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
          <path d="M150 58 q6 10 0 14 q-6 -4 0 -14z" fill="#8ec5ff" stroke="#4a8fd6" strokeWidth="1.5" />
        </>
      )}
      {/* 鼻口まわり */}
      <ellipse cx="100" cy="100" rx="22" ry="16" fill={SHADE} />
      <ellipse cx="100" cy="93" rx="8" ry="6" fill={INK} />
      {mood === "ng" ? (
        <path d="M90 112 q10 -7 20 0" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
      ) : (
        <path d="M100 99 v5 M90 106 q10 9 20 0" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </g>
  );
}

/** 全身（結果の吹き出しの下・一覧画面など） */
export function Mascot({ mood = "idle", size = 150, title = "しろくま" }: { mood?: Mood; size?: number; title?: string }) {
  return (
    <svg viewBox="0 0 200 270" width={size} height={(size * 270) / 200} role="img" aria-label={title}>
      {/* 足 */}
      <ellipse cx="76" cy="250" rx="22" ry="14" fill={FUR} stroke={INK} strokeWidth="4" />
      <ellipse cx="124" cy="250" rx="22" ry="14" fill={FUR} stroke={INK} strokeWidth="4" />
      {/* 体 */}
      <ellipse cx="100" cy="190" rx="58" ry="60" fill={FUR} stroke={INK} strokeWidth="4" />
      <ellipse cx="100" cy="200" rx="36" ry="38" fill={SHADE} />
      {/* 腕 */}
      {mood === "ok" ? (
        <>
          <path d="M150 160 q30 -30 26 -62" fill="none" stroke={INK} strokeWidth="26" strokeLinecap="round" />
          <path d="M150 160 q30 -30 26 -62" fill="none" stroke={FUR} strokeWidth="18" strokeLinecap="round" />
          <path d="M50 170 q-18 22 -8 44" fill="none" stroke={INK} strokeWidth="26" strokeLinecap="round" />
          <path d="M50 170 q-18 22 -8 44" fill="none" stroke={FUR} strokeWidth="18" strokeLinecap="round" />
        </>
      ) : mood === "ng" ? (
        <>
          <path d="M52 168 q-8 18 14 30" fill="none" stroke={INK} strokeWidth="26" strokeLinecap="round" />
          <path d="M52 168 q-8 18 14 30" fill="none" stroke={FUR} strokeWidth="18" strokeLinecap="round" />
          <path d="M148 168 q8 18 -14 30" fill="none" stroke={INK} strokeWidth="26" strokeLinecap="round" />
          <path d="M148 168 q8 18 -14 30" fill="none" stroke={FUR} strokeWidth="18" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M50 170 q-16 22 -8 46" fill="none" stroke={INK} strokeWidth="26" strokeLinecap="round" />
          <path d="M50 170 q-16 22 -8 46" fill="none" stroke={FUR} strokeWidth="18" strokeLinecap="round" />
          <path d="M150 170 q16 22 8 46" fill="none" stroke={INK} strokeWidth="26" strokeLinecap="round" />
          <path d="M150 170 q16 22 8 46" fill="none" stroke={FUR} strokeWidth="18" strokeLinecap="round" />
        </>
      )}
      {/* マフラー */}
      <path d="M52 128 q48 22 96 0 l2 16 q-50 24 -100 0z" fill={SCARF} stroke={SCARF_DARK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M122 140 l10 44 l-18 2 l-4 -42z" fill={SCARF} stroke={SCARF_DARK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M116 184 l2 8 M122 183 l2 8 M128 182 l2 8" stroke={SCARF_DARK} strokeWidth="2.5" strokeLinecap="round" />
      <g transform="translate(0 2)">
        <Face mood={mood} />
      </g>
    </svg>
  );
}

/** 顔だけ（プログラム帯のアイコン・計算書のマーク） */
export function MascotFace({ size = 40, mood = "idle" }: { size?: number; mood?: Mood }) {
  return (
    <svg viewBox="40 18 120 120" width={size} height={size} aria-hidden="true">
      <Face mood={mood} />
      <path d="M58 124 q42 18 84 0" fill="none" stroke={SCARF} strokeWidth="10" strokeLinecap="round" />
    </svg>
  );
}
