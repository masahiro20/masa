import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/mcp/route";
import { calculate } from "@/lib/gaihi/calc";
import type { Project } from "@/lib/gaihi/types";
import type { Extraction } from "@/lib/extract/schema";

const quantities: Extraction = {
  project: { name: "MCPテスト邸", address: "愛知県日進市", region: 6, region_reason: "日進市", total_floor_area_m2: 100, structure: "木造" },
  orientation_note: "",
  walls: [
    { orientation: "SE", label: "南東", gross_area_m2: 50, adjacency: "outside", basis: "" },
    { orientation: "NW", label: "北西", gross_area_m2: 50, adjacency: "outside", basis: "" },
  ],
  openings: [{ orientation: "SE", kind: "window", label: "窓", width_m: 1.69, height_m: 2.4, count: 2, basis: "" }],
  ceilings: [{ kind: "ceiling", label: "天井", area_m2: 50, basis: "" }],
  floors: [{ adjacency: "underfloor", label: "床", area_m2: 45, basis: "" }],
  domas: [],
  specs_found: { ceiling_or_roof: "", wall: "防火サイディング16mm＋セルローズファイバー＋PB12.5", floor: "", window: "", door: "", foundation: "" },
  warnings: [],
};

async function rpc(body: unknown) {
  const res = await POST(
    new Request("https://gaihi.example.com/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  );
  return { status: res.status, json: res.status === 202 ? null : await res.json() };
}

describe("MCP エンドポイント", () => {
  it("initialize でバージョン・ツール機能・説明を返す", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(json.result.protocolVersion).toBe("2025-06-18");
    expect(json.result.capabilities.tools).toBeDefined();
    expect(json.result.serverInfo.name).toBe("gaihi-keisan");
    expect(json.result.instructions).toContain("calculate_from_drawing_quantities");
  });

  it("未知のバージョンには最新で答え、通知には 202 を返す", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(json.result.protocolVersion).toBe("2025-06-18");
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
  });

  it("tools/list にツールが並ぶ", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(["get_drawing_reading_instructions", "calculate_from_drawing_quantities", "calculate_project", "get_standards", "list_materials"]);
    for (const t of json.result.tools) expect(t.inputSchema.type).toBe("object");
  });

  it("図面の数量から計算し、ツールで開けるリンクを返す", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "calculate_from_drawing_quantities", arguments: { quantities } } });
    const r = json.result;
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent.ua).toBeGreaterThan(0);
    expect(r.content[0].text).toContain("セルロースファイバー");
    const url: string = r.structuredContent.open_in_tool_url;
    expect(url.startsWith("https://gaihi.example.com/import#p=")).toBe(true);
    // リンクの中身を展開すると、同じ結果になる物件データ
    const p = JSON.parse(inflateRawSync(Buffer.from(url.split("#p=")[1], "base64url")).toString("utf8")) as Project;
    expect(p.name).toBe("MCPテスト邸");
    expect(calculate(p).ua).toBe(r.structuredContent.ua);
  });

  it("U値の指定（overrides）が効く", async () => {
    const call = (overrides?: object) =>
      rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "calculate_from_drawing_quantities", arguments: { quantities, overrides } } });
    const base = (await call()).json.result.structuredContent.ua;
    const better = (await call({ wall_u: 0.2, window_u: 1.0 })).json.result.structuredContent.ua;
    expect(better).toBeLessThan(base);
  });

  it("入力の形が違えばエラーを返す", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "calculate_from_drawing_quantities", arguments: { quantities: { walls: [] } } } });
    expect(json.result.isError).toBe(true);
    const unknown = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope", arguments: {} } });
    expect(unknown.json.error.code).toBe(-32602);
    const nomethod = await rpc({ jsonrpc: "2.0", id: 7, method: "resources/list" });
    expect(nomethod.json.error.code).toBe(-32601);
  });

  it("基準値を返す", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "get_standards", arguments: { region: 6 } } });
    expect(json.result.structuredContent.grades[0].ua).toBe(0.87);
  });

  it("GET は 405", async () => {
    expect((await GET()).status).toBe(405);
  });
});
