import { z } from "zod";

// 図面から読み取る数量の形。Claude の structured outputs にそのまま渡す JSON Schema と、
// 受け取った結果を検証する zod スキーマを同じ定義から作る。

const dir8 = z.enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);

export const ExtractionSchema = z.object({
  project: z.object({
    name: z.string().describe("工事名・物件名（例：〇〇様邸新築工事）"),
    address: z.string().describe("建設地。図面に無ければ空文字"),
    region: z.number().int().describe("建設地から判断した省エネ地域区分 1〜8。判断できなければ 0"),
    region_reason: z.string(),
    total_floor_area_m2: z.number().describe("延床面積。読めなければ 0"),
    structure: z.string().describe("構造（例：木造）"),
  }),
  orientation_note: z
    .string()
    .describe("真北マークから各立面・各辺を8方位のどれに割り当てたか、その根拠"),
  walls: z.array(
    z.object({
      orientation: dir8,
      label: z.string().describe("例：南立面 1階+2階"),
      gross_area_m2: z.number().describe("開口部を含むグロス面積（妻壁の三角形部分を含む）"),
      adjacency: z.enum(["outside", "unheated"]),
      basis: z.string().describe("計算根拠。例：X0-X6 5,460mm × 外壁高さ5.80m + 妻壁 5.46×1.5/2"),
    }),
  ),
  openings: z.array(
    z.object({
      orientation: dir8,
      kind: z.enum(["window", "door"]),
      label: z.string().describe("建具記号・室名など"),
      width_m: z.number(),
      height_m: z.number(),
      count: z.number().int(),
      basis: z.string(),
    }),
  ),
  ceilings: z.array(
    z.object({
      kind: z.enum(["ceiling", "roof"]).describe("天井断熱なら ceiling、屋根断熱なら roof"),
      label: z.string(),
      area_m2: z.number().describe("断熱境界の水平投影面積（屋根断熱の場合は勾配なりの面積）"),
      basis: z.string(),
    }),
  ),
  floors: z.array(
    z.object({
      adjacency: z.enum(["underfloor", "outside"]).describe("床下に接する床は underfloor、オーバーハング等で外気に接する床は outside"),
      label: z.string(),
      area_m2: z.number().describe("床組がある部分の面積（土間部分を除く）"),
      basis: z.string(),
    }),
  ),
  domas: z.array(
    z.object({
      use: z.enum(["entrance", "bath", "other"]).describe("玄関・土間収納は entrance、基礎断熱の浴室は bath"),
      label: z.string(),
      area_m2: z.number(),
      perimeters: z.array(
        z.object({
          orientation: dir8,
          adjacency: z.enum(["outside", "underfloor"]).describe("外気に接する辺は outside、床下空間に接する辺は underfloor"),
          length_m: z.number(),
        }),
      ),
      foundation_rise_m: z.number().describe("基礎立上りの地上部分の高さ（外気側）。読めなければ 0"),
      basis: z.string(),
    }),
  ),
  specs_found: z.object({
    ceiling_or_roof: z.string(),
    wall: z.string(),
    floor: z.string(),
    window: z.string(),
    door: z.string(),
    foundation: z.string(),
  }),
  warnings: z.array(z.string()).describe("読み取れなかった寸法、推定した値、図面間の食い違いなど"),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

/** structured outputs が受け付けない数値制約（z.int() が付ける安全整数の範囲）を取り除く */
function stripNumericBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripNumericBounds);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "minimum" || k === "maximum" || k === "$schema") continue;
      out[k] = stripNumericBounds(v);
    }
    return out;
  }
  return node;
}

/** structured outputs 用の JSON Schema（全プロパティ必須・追加プロパティ禁止） */
export function extractionJsonSchema(): Record<string, unknown> {
  return stripNumericBounds(z.toJSONSchema(ExtractionSchema)) as Record<string, unknown>;
}
