import { MATERIALS } from "./constants";
import { blankSpec, layer } from "./defaults";
import type { Layer, Spec, SpecKind } from "./types";

// 断熱材の名前から仕様（材料構成）を組み立てる。
// 仕様リストのテンプレートと、図面の仕様書きからの自動設定の両方で使う。

type Insulation = { key: string; material: string; label: string };

/** 図面の書き方（表記ゆれ）→ 材料表の名前。上から順に判定する */
const INSULATIONS: { pattern: RegExp; byKind: Partial<Record<SpecKind, string>>; fallback: string; label: string }[] = [
  {
    pattern: /セル[ロ][ーｰ][スズ]|セルロ/,
    byKind: { wall: "セルロースファイバー 55K（壁充填）", ceiling: "セルロースファイバー 25K（天井吹込み）" },
    fallback: "セルロースファイバー 45K（床・屋根充填）",
    label: "セルロースファイバー",
  },
  { pattern: /吹付.*ウレタン.*1H|ウレタン.*A種1H|A種1H/, byKind: {}, fallback: "吹付け硬質ウレタンフォーム A種1H", label: "吹付けウレタン A種1H" },
  { pattern: /吹付.*ウレタン|ウレタン.*吹付|現場発泡/, byKind: {}, fallback: "吹付け硬質ウレタンフォーム A種3", label: "吹付けウレタン A種3" },
  { pattern: /フェノール/, byKind: {}, fallback: "フェノールフォーム 保温板1種2号", label: "フェノールフォーム" },
  { pattern: /押出|XPS|スタイロ|ポリスチレン.*3種/, byKind: {}, fallback: "押出法ポリスチレンフォーム 3種b", label: "押出法ポリスチレンフォーム 3種b" },
  { pattern: /ビーズ|EPS/, byKind: {}, fallback: "ビーズ法ポリスチレンフォーム 特号", label: "ビーズ法ポリスチレンフォーム" },
  { pattern: /ウレタン/, byKind: {}, fallback: "硬質ウレタンフォーム 保温板2種", label: "硬質ウレタンフォーム" },
  { pattern: /吹込.*ロックウール/, byKind: {}, fallback: "吹込み用ロックウール", label: "吹込み用ロックウール" },
  { pattern: /ロックウール/, byKind: {}, fallback: "ロックウール", label: "ロックウール" },
  { pattern: /ウッドファイバー|木質繊維/, byKind: {}, fallback: "木質繊維断熱材（ウッドファイバー）", label: "ウッドファイバー" },
  { pattern: /羊毛|ウール断熱|サーモウール/, byKind: {}, fallback: "羊毛断熱材", label: "羊毛断熱材" },
  { pattern: /吹込.*(グラスウール|GW)/, byKind: {}, fallback: "吹込み用グラスウール 18K", label: "吹込み用グラスウール" },
  { pattern: /高性能.*(グラスウール|GW).*24K|(HG|高性能GW)24/, byKind: {}, fallback: "高性能グラスウール 24K", label: "高性能グラスウール 24K" },
  { pattern: /高性能.*(グラスウール|GW).*20K/, byKind: {}, fallback: "高性能グラスウール 20K", label: "高性能グラスウール 20K" },
  { pattern: /高性能.*(グラスウール|GW)|HGW/, byKind: {}, fallback: "高性能グラスウール 16K", label: "高性能グラスウール 16K" },
  { pattern: /グラスウール|GW/, byKind: {}, fallback: "グラスウール 16K相当", label: "グラスウール" },
];

function findInsulation(kind: SpecKind, text: string): Insulation | null {
  for (const ins of INSULATIONS) {
    if (ins.pattern.test(text)) {
      const material = ins.byKind[kind] ?? ins.fallback;
      return { key: material, material, label: ins.label };
    }
  }
  return null;
}

const DEFAULT_THICKNESS: Partial<Record<SpecKind, number>> = { wall: 105, ceiling: 200, roof: 155, floor: 65 };

/** 部位ごとの標準的な構成で、断熱材と厚さから仕様を作る */
export function buildSpec(kind: "wall" | "ceiling" | "roof" | "floor", material: string, thickness: number, name?: string): Spec {
  const m = MATERIALS.find((x) => x.name === material && (x.category === "fill" || x.category === "external"));
  const lambda = m?.lambda ?? 0.04;
  let layers: Layer[];
  let note: string;
  switch (kind) {
    case "wall":
      layers = [
        layer("board", "せっこうボード", 12.5, 0.221),
        layer("fill", material, thickness, lambda),
        layer("frame", "天然木材", thickness, 0.12),
        layer("board", "構造用合板", 9, 0.16),
      ];
      note = "柱・間柱間に充填断熱（熱橋部は木材 λ0.12）。外気側は通気層";
      break;
    case "roof":
      layers = [
        layer("board", "せっこうボード", 9.5, 0.221),
        layer("fill", material, thickness, lambda),
        layer("frame", "天然木材", thickness, 0.12),
        layer("board", "構造用合板", 12, 0.16),
      ];
      note = "垂木間に充填断熱";
      break;
    case "ceiling":
      layers = [layer("board", "せっこうボード", 9.5, 0.221), layer("fill", material, thickness, lambda)];
      note = "天井上に敷込み・吹込み（熱橋なし）";
      break;
    case "floor":
      layers = [
        layer("board", "構造用合板", 24, 0.16),
        layer("fill", material, thickness, lambda),
        layer("frame", "天然木材", 90, 0.12),
      ];
      note = "剛床・大引間に断熱";
      break;
  }
  const label = MATERIALS.find((x) => x.name === material)?.name ?? material;
  return {
    ...blankSpec(kind, name ?? `${kindName(kind)} ${label} ${thickness}mm`),
    method: "layers",
    layers,
    note,
  };
}

function kindName(kind: SpecKind) {
  return { wall: "外壁", ceiling: "天井", roof: "屋根", floor: "床" }[kind as "wall"] ?? kind;
}

/**
 * 図面の仕様書きから仕様を作る（例：「防火サイディング16mm＋セルローズファイバー＋PB12.5」→ セルロース 55K の外壁）。
 * 断熱材が読み取れなければ null。厚さが書かれていなければ標準の厚さにして assumedThickness を true にする。
 */
export function specFromText(
  kind: "wall" | "ceiling" | "roof" | "floor",
  text: string,
): { spec: Spec; assumedThickness: boolean; label: string } | null {
  if (!text) return null;
  const ins = findInsulation(kind, text);
  if (!ins) return null;
  // 「断熱材 105mm」「t=120」「120ミリ」などの厚さ。サイディング・ボード類の厚さは除く
  const cleaned = text.replace(/(サイディング|ボード|PB|合板|石膏|せっこう|ｻｲﾃﾞｨﾝｸﾞ)[^＋+、,]*/g, "");
  const m = cleaned.match(/(?:t\s*=?\s*)?(\d{2,3})\s*(?:mm|ｍｍ|ミリ)/i);
  const thickness = m ? Number(m[1]) : (DEFAULT_THICKNESS[kind] ?? 100);
  const spec = buildSpec(kind, ins.material, thickness, `${kindName(kind)}（図面）${ins.label} ${thickness}mm`);
  spec.note = `図面の仕様：${text}`;
  return { spec, assumedThickness: !m, label: ins.label };
}

/** 仕様リストに出すテンプレート */
export function specTemplates(): Spec[] {
  return [
    buildSpec("wall", "セルロースファイバー 55K（壁充填）", 105),
    buildSpec("wall", "セルロースファイバー 55K（壁充填）", 120),
    buildSpec("wall", "高性能グラスウール 16K", 105),
    buildSpec("wall", "高性能グラスウール 16K", 120),
    buildSpec("wall", "吹付け硬質ウレタンフォーム A種3", 105),
    buildSpec("wall", "ロックウール", 105),
    buildSpec("ceiling", "セルロースファイバー 25K（天井吹込み）", 200),
    buildSpec("ceiling", "吹込み用グラスウール 18K", 300),
    buildSpec("ceiling", "高性能グラスウール 16K", 210),
    buildSpec("roof", "セルロースファイバー 45K（床・屋根充填）", 155),
    buildSpec("roof", "高性能グラスウール 16K", 155),
    buildSpec("floor", "押出法ポリスチレンフォーム 3種b", 65),
    buildSpec("floor", "フェノールフォーム 保温板1種2号", 45),
    buildSpec("floor", "セルロースファイバー 45K（床・屋根充填）", 90),
  ];
}
