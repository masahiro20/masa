import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { calculate } from "@/lib/gaihi/calc";
import { sampleProject } from "@/lib/gaihi/defaults";
import { importUrl } from "@/lib/mcp/link";
import { packProject, shareUrl, unpackProject } from "@/lib/share";

describe("共有リンク", () => {
  it("物件をリンクにして戻すと、同じ物件・同じ計算結果になる", async () => {
    const p = sampleProject();
    const back = await unpackProject(await packProject(p));
    expect(back).toEqual(p);
    expect(calculate(back).ua).toBe(calculate(p).ua);
  });

  it("MCP のリンクと同じ形式（どちらも /import で開ける）", async () => {
    const p = sampleProject();
    const url = await shareUrl("https://example.com", p);
    expect(url.startsWith("https://example.com/import#p=")).toBe(true);
    const packed = url.split("#p=")[1];
    expect(JSON.parse(inflateRawSync(Buffer.from(packed, "base64url")).toString("utf8")).name).toBe(p.name);
    const fromMcp = importUrl("https://example.com", p).split("#p=")[1];
    expect((await unpackProject(fromMcp)).name).toBe(p.name);
  });
});
