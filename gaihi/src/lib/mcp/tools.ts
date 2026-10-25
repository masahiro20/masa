import { z } from "zod";
import { calculate, specValue, usedSpecs, type CalcResult } from "../gaihi/calc";
import { ETA_AC_STANDARD, GRADES, MATERIALS, ORIENTATION_LABEL, REGIONS, SPEC_KIND_LABEL, UA_STANDARD, nu } from "../gaihi/constants";
import { blankSpec, newProject, normalizeProject } from "../gaihi/defaults";
import type { Project, Region, SpecKind } from "../gaihi/types";
import { EXTRACTION_SYSTEM, extractionInstruction } from "../extract/prompt";
import { ExtractionSchema, extractionJsonSchema } from "../extract/schema";
import { applyExtraction } from "../extract/toProject";
import { importUrl } from "./link";

// MCP（Claude などの AI から使う窓口）で公開するツール。どれも計算だけで、物件データはサーバーに保存しない。

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  run: (args: unknown, ctx: { origin: string }) => ToolResult;
}

const OverridesSchema = z
  .object({
    region: z.number().int().min(1).max(8).optional(),
    wall_u: z.number().positive().optional(),
    ceiling_u: z.number().positive().optional(),
    roof_u: z.number().positive().optional(),
    floor_u: z.number().positive().optional(),
    base_wall_u: z.number().positive().optional(),
    window_u: z.number().positive().optional(),
    window_eta_d: z.number().positive().optional(),
    door_u: z.number().positive().optional(),
    perimeter_psi: z.number().positive().optional(),
    total_floor_area_m2: z.number().positive().optional(),
  })
  .strict();

const OVERRIDES_JSON_SCHEMA = {
  type: "object",
  description:
    "U値などを直接指定するときに使う（省略時は社内の Superior 仕様：天井0.23・外壁0.41・床0.35・基礎壁0.50・窓1.47/ηd0.32・ドア1.79・ψ0.65。図面の仕様書きに断熱材があればその材料で計算）",
  properties: {
    region: { type: "integer", minimum: 1, maximum: 8, description: "地域区分" },
    wall_u: { type: "number", description: "外壁の熱貫流率 U [W/(㎡・K)]" },
    ceiling_u: { type: "number", description: "天井の U" },
    roof_u: { type: "number", description: "屋根の U" },
    floor_u: { type: "number", description: "床の U" },
    base_wall_u: { type: "number", description: "基礎壁の U" },
    window_u: { type: "number", description: "窓の U" },
    window_eta_d: { type: "number", description: "窓の垂直面日射熱取得率 ηd" },
    door_u: { type: "number", description: "ドアの U" },
    perimeter_psi: { type: "number", description: "土間床等の外周部の線熱貫流率 ψ [W/(m・K)]" },
    total_floor_area_m2: { type: "number", description: "延床面積（Q値・μ値用）" },
  },
  additionalProperties: false,
};

/** 指定された U 値を、その部位の全部位に当てはめる（指定値の仕様を作って差し替える） */
function applyOverrides(p: Project, o: z.infer<typeof OverridesSchema>) {
  if (o.region) p.region = o.region as Region;
  if (o.total_floor_area_m2) p.totalFloorArea = o.total_floor_area_m2;
  const set = (kind: SpecKind, patch: { u?: number; etaD?: number; psi?: number }) => {
    if (patch.u === undefined && patch.etaD === undefined && patch.psi === undefined) return;
    const base = p.specs.find((s) => s.kind === kind) ?? blankSpec(kind, SPEC_KIND_LABEL[kind]);
    const spec = { ...structuredClone(base), ...blankSpec(kind, `${SPEC_KIND_LABEL[kind]}（指定値）`), u: base.u, etaD: base.etaD, psi: base.psi, fC: base.fC, fH: base.fH };
    spec.method = "direct";
    if (patch.u !== undefined) spec.u = patch.u;
    if (patch.etaD !== undefined) spec.etaD = patch.etaD;
    if (patch.psi !== undefined) spec.psi = patch.psi;
    if (base.method === "layers" && patch.u === undefined && kind !== "window") spec.u = specValue(base);
    p.specs.unshift(spec);
    for (const s of p.surfaces) if (s.kind === kind) s.specId = spec.id;
    for (const x of p.openings) if (x.kind === kind) x.specId = spec.id;
    if (kind === "perimeter") for (const x of p.perimeters) x.specId = spec.id;
  };
  set("wall", { u: o.wall_u });
  set("ceiling", { u: o.ceiling_u });
  set("roof", { u: o.roof_u });
  set("floor", { u: o.floor_u });
  set("baseWall", { u: o.base_wall_u });
  set("window", { u: o.window_u, etaD: o.window_eta_d });
  set("door", { u: o.door_u });
  set("perimeter", { psi: o.perimeter_psi });
}

const f = (x: number | null, d = 2) => (x === null ? "―" : x.toFixed(d));

function summarize(project: Project, r: CalcResult, origin: string) {
  const link = importUrl(origin, project);
  const kijun = r.judgments.find((j) => j.grade === "kijun")!;
  const lines = [
    `【${project.name}】${project.region}地域`,
    `UA = ${f(r.ua)} W/(㎡・K)　ηAC = ${f(r.etaAC, 1)}　ηAH = ${f(r.etaAH, 1)}　（外皮面積 ΣA = ${f(r.totalArea)}㎡、q = ${f(r.q, 3)} W/K）`,
    r.qValue !== null ? `Q値（参考）= ${f(r.qValue)}　μ値（参考）= ${f(r.mu, 3)}` : "Q値・μ値：延床面積がないため未計算",
    "",
    "基準判定：",
    ...r.judgments.map(
      (j) => `・${j.label}：${j.ok === null ? "基準なし" : j.ok ? "適合" : "不適合"}（UA≦${j.uaStandard ?? "―"}、ηAC≦${j.etaACStandard ?? "―"}）`,
    ),
    "",
    "使った仕様：",
    ...usedSpecs(project).map((s) => `・${SPEC_KIND_LABEL[s.kind]}：${s.name}（${s.kind === "perimeter" ? `ψ ${f(s.psi, 3)}` : `U ${f(specValue(s), 3)}`}${s.kind === "window" ? `・ηd ${s.etaD}` : ""}）`),
    "",
    "部位別（面積・U・熱損失）：",
    ...r.rows.map((x) => `・${x.name}（${SPEC_KIND_LABEL[x.kind]}・${ORIENTATION_LABEL[x.orientation]}）${f(x.amount)}${x.group === "perimeter" ? "m" : "㎡"} × ${f(x.value, 3)} × H${x.h} = ${f(x.q, 3)}`),
    ...(r.warnings.length ? ["", "注意：", ...r.warnings.map((w) => `・${w}`)] : []),
    ...(project.notes.length ? ["", "メモ：", ...project.notes.map((n) => `・${n}`)] : []),
    "",
    `外皮計算ツールで開く（物件として保存・計算書の印刷・Excel 出力）：${link}`,
  ];
  return {
    text: lines.join("\n"),
    structured: {
      name: project.name,
      region: project.region,
      ua: r.ua,
      eta_ac: r.etaAC,
      eta_ah: r.etaAH,
      q_value: r.qValue,
      mu: r.mu,
      total_area_m2: r.totalArea,
      heat_loss_w_per_k: r.q,
      complies_with_energy_standard: kijun.ok,
      judgments: r.judgments.map((j) => ({ grade: j.label, ua_standard: j.uaStandard, eta_ac_standard: j.etaACStandard, ok: j.ok })),
      warnings: r.warnings,
      open_in_tool_url: link,
    },
  };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function zodMessage(e: z.ZodError) {
  return e.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(入力)"}: ${i.message}`)
    .join("\n");
}

export const TOOLS: ToolDef[] = [
  {
    name: "get_drawing_reading_instructions",
    title: "図面の読み取り手順",
    description:
      "設計図書（平面図・立面図・配置図・仕様書）から外皮計算に必要な数量を拾う手順を返す。図面を読む前に一度呼び、その手順で数量を拾ってから calculate_from_drawing_quantities に渡す。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: () => ({
      content: [
        {
          type: "text",
          text: `${EXTRACTION_SYSTEM}\n\n${extractionInstruction(["ユーザーが指定した設計図書"])}\n\n読み取った数量は calculate_from_drawing_quantities の quantities に、ツールの入力スキーマどおりの形で渡してください。`,
        },
      ],
    }),
  },
  {
    name: "calculate_from_drawing_quantities",
    title: "図面の数量から外皮計算",
    description:
      "図面から拾った数量（方位別の外壁面積・窓/ドア・天井/屋根・床・土間と外周長さ・仕様書きなど）から、UA値・ηAC値・ηAH値・Q値・μ値と省エネ基準/等級5〜7の判定を計算する。結果には、外皮計算ツールで物件として開くためのリンクが付く。U値は overrides で指定でき、省略時は社内 Superior 仕様（図面に断熱材の記載があればその材料）で計算する。",
    inputSchema: {
      type: "object",
      properties: { quantities: extractionJsonSchema(), overrides: OVERRIDES_JSON_SCHEMA },
      required: ["quantities"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (args, { origin }) => {
      const a = z.object({ quantities: ExtractionSchema, overrides: OverridesSchema.optional() }).safeParse(args);
      if (!a.success) return errorResult(`入力の形が違います。\n${zodMessage(a.error)}`);
      const p = applyExtraction(newProject(a.data.quantities.project.name || "新規物件"), a.data.quantities);
      if (a.data.overrides) applyOverrides(p, a.data.overrides);
      const s = summarize(p, calculate(p), origin);
      return { content: [{ type: "text", text: s.text }], structuredContent: s.structured };
    },
  },
  {
    name: "calculate_project",
    title: "物件データで外皮計算",
    description: "外皮計算ツールの「保存」で出した物件データ（JSON）をそのまま計算する。物件データを直したあとの再計算に使う。",
    inputSchema: {
      type: "object",
      properties: { project: { type: "object", description: "外皮計算ツールの物件データ（JSON）" } },
      required: ["project"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (args, { origin }) => {
      const a = z.object({ project: z.record(z.string(), z.unknown()) }).safeParse(args);
      if (!a.success) return errorResult("project に物件データ（JSON オブジェクト）を入れてください。");
      const raw = a.data.project as unknown as Project;
      if (!Array.isArray(raw.specs) || !Array.isArray(raw.surfaces)) return errorResult("外皮計算ツールの物件データではありません（specs・surfaces がありません）。");
      const p = normalizeProject(raw);
      const s = summarize(p, calculate(p), origin);
      return { content: [{ type: "text", text: s.text }], structuredContent: s.structured };
    },
  },
  {
    name: "get_standards",
    title: "地域区分の基準値・方位係数",
    description: "地域区分（1〜8）の UA・ηAC 基準値（省エネ基準・等級5/6/7）と方位係数を返す。",
    inputSchema: {
      type: "object",
      properties: { region: { type: "integer", minimum: 1, maximum: 8, description: "地域区分" } },
      required: ["region"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (args) => {
      const a = z.object({ region: z.number().int().min(1).max(8) }).safeParse(args);
      if (!a.success) return errorResult("region は 1〜8 の整数です。");
      const r = a.data.region as Region;
      const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "TOP"] as const;
      const grades = GRADES.map((g) => ({ grade: g.label, ua: UA_STANDARD[g.key][r - 1], eta_ac: ETA_AC_STANDARD[g.key][r - 1] }));
      const coeff = dirs.map((d) => ({ direction: ORIENTATION_LABEL[d], cooling: nu("cooling", r, d), heating: nu("heating", r, d) }));
      const text = [
        `${r}地域の基準値`,
        ...grades.map((g) => `・${g.grade}：UA≦${g.ua ?? "基準なし"}、ηAC≦${g.eta_ac ?? "基準なし"}`),
        "方位係数（冷房期 / 暖房期）",
        ...coeff.map((c) => `・${c.direction}：${c.cooling ?? "―"} / ${c.heating ?? "―"}`),
      ].join("\n");
      return { content: [{ type: "text", text }], structuredContent: { region: r, grades, orientation_coefficients: coeff } };
    },
  },
  {
    name: "list_materials",
    title: "断熱材・建材の熱伝導率",
    description: "外皮計算ツールに登録されている材料（面材・充填断熱材・軸材・外張断熱材）の熱伝導率 λ の一覧を返す。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: () => ({
      content: [{ type: "text", text: MATERIALS.map((m) => `${m.category}\t${m.name}\tλ=${m.lambda}`).join("\n") }],
      structuredContent: { materials: MATERIALS },
    }),
  },
];

export const SERVER_INSTRUCTIONS = `外皮計算ツール（木造戸建住宅の外皮性能・標準計算）の MCP サーバーです。
使い方：
1. 設計図書（Google ドライブ等）を読む前に get_drawing_reading_instructions で拾い方を確認する。
2. 図面から数量を拾い、calculate_from_drawing_quantities に渡すと UA・ηAC・ηAH・Q値・μ値と基準判定が返る。U値の指定は overrides で行う。
3. 結果の「外皮計算ツールで開く」リンクをユーザーに渡すと、ツールで物件として保存し、計算書の印刷や Excel 出力ができる。
基準値・方位係数は get_standards、材料の λ は list_materials。数量の推定や図面間の食い違いは quantities.warnings に必ず書くこと。
地域区分の候補：${REGIONS.join(", ")}`;
