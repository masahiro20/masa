import test from "node:test";
import assert from "node:assert/strict";
import { queryReinfolib } from "../lib/reinfolib.js";

const square = (lon, lat, d = 0.001) => ({
  type: "Polygon",
  coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]],
});

test("APIキーなしは nokey を返す", async () => {
  const r = await queryReinfolib("", 136.9, 35.18);
  assert.ok(r.every((x) => x.status === "nokey"));
});

test("地点を含むポリゴンだけを採用し、キーをヘッダーで送る", async (t) => {
  const lon = 136.9, lat = 35.18;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    calls.push({ url, key: opts.headers["Ocp-Apim-Subscription-Key"] });
    const code = new URL(url).pathname.split("/").pop();
    const features =
      code === "XKT002"
        ? [
            { type: "Feature", geometry: square(lon, lat), properties: { use_area_ja: "第一種住居地域", u_building_coverage_ratio_ja: "60%", u_floor_area_ratio_ja: "200%" } },
            { type: "Feature", geometry: square(lon + 0.01, lat), properties: { use_area_ja: "商業地域" } },
          ]
        : code === "XPT002"
        ? [{ type: "Feature", geometry: { type: "Point", coordinates: [lon + 0.001, lat] }, properties: { location: "テスト1-1", gas_supply_availability: "true" } }]
        : [];
    return new Response(JSON.stringify({ type: "FeatureCollection", features }), { status: 200 });
  });
  const r = await queryReinfolib("KEY", lon, lat);
  const zone = r.find((x) => x.id === "useZone");
  assert.equal(zone.status, "ok");
  assert.deepEqual(zone.hits.map((h) => h.用途地域), ["第一種住居地域"]);
  assert.equal(zone.hits[0].容積率, "200%");
  const lp = r.find((x) => x.id === "landPrice");
  assert.equal(lp.hits[0].所在, "テスト1-1");
  assert.ok(calls.every((c) => c.key === "KEY"));
});
