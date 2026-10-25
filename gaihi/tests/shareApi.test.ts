import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleProject } from "@/lib/gaihi/defaults";

// Vercel Blob の代わりにメモリに置く
const store = new Map<string, string>();
vi.mock("@vercel/blob", () => ({
  put: async (path: string, body: string) => {
    store.set(path, body);
    return { pathname: path };
  },
  get: async (path: string) => (store.has(path) ? { statusCode: 200, stream: new Blob([store.get(path)!]).stream() } : null),
}));

const { POST } = await import("@/app/api/share/route");
const { GET } = await import("@/app/api/share/[id]/route");

const post = (body: string) => POST(new Request("https://x/api/share", { method: "POST", body }));
const read = (id: string) => GET(new Request(`https://x/api/share/${id}`), { params: Promise.resolve({ id }) });

describe("短い共有リンク API", () => {
  beforeEach(() => vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test"));
  afterEach(() => {
    vi.unstubAllEnvs();
    store.clear();
  });

  it("預けると10文字のIDが返り、そのIDで同じ物件を取り出せる", async () => {
    const p = sampleProject();
    const res = await post(JSON.stringify(p));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    expect(id).toMatch(/^[0-9A-Za-z]{10}$/);
    const back = await read(id);
    expect(back.status).toBe(200);
    expect(await back.json()).toEqual(p);
  });

  it("物件でないもの・大きすぎるもの・不正なIDは受け付けない", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ hello: 1 }))).status).toBe(400);
    expect((await post("x".repeat(1_000_001))).status).toBe(413);
    expect((await read("../../etc")).status).toBe(404);
    expect((await read("AAAAAAAAAA")).status).toBe(404);
  });

  it("保存先がない環境では 503（画面は長いリンクに切り替える）", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect((await post(JSON.stringify(sampleProject()))).status).toBe(503);
  });
});
