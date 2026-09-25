import test from "node:test";
import assert from "node:assert/strict";
import { deriveFindings, normalizeZone, heightRules } from "../public/shared/rules.js";
import { geometryContains, lonLatToTile, splitAddress } from "../lib/geo.js";

const reinfo = (zone, bcr, far, fire) => [
  { id: "areaDivision", status: "ok", hits: [{ 区域区分: "市街化区域" }] },
  { id: "useZone", status: "ok", hits: [{ 用途地域: zone, 建蔽率: bcr, 容積率: far }] },
  { id: "fireZone", status: "ok", hits: fire ? [{ 地域: fire }] : [] },
];
const get = (r, key) => r.findings.find((f) => f.key === key);

test("用途地域名の正規化（全角・漢数字）", () => {
  assert.equal(normalizeZone("第１種低層住居専用地域"), "1低");
  assert.equal(normalizeZone("第一種中高層住居専用地域"), "1中高");
  assert.equal(normalizeZone("工業専用地域"), "工専");
  assert.equal(normalizeZone("工業地域"), "工業");
  assert.equal(normalizeZone("商業地域"), "商業");
});

test("低層住居専用地域は絶対高さと北側斜線5m", () => {
  const h = heightRules("1低", 100);
  assert.match(h.absolute, /10m または 12m/);
  assert.ok(h.lines.some((l) => l.includes("北側斜線 5m")));
});

test("容積率の前面道路幅員制限（住居系×0.4）", () => {
  const r = deriveFindings({ reinfo: reinfo("第１種住居地域", "60%", "200%"), hazards: [], manual: { roadType: "1-1", roadWidth: "4" } });
  assert.match(get(r, "far").value, /実効 160%/);
  assert.equal(get(r, "far").level, "warn");
});

test("商業系は×0.6、12m以上は制限なし", () => {
  const r1 = deriveFindings({ reinfo: reinfo("近隣商業地域", "80%", "300%"), hazards: [], manual: { roadWidth: "4" } });
  assert.match(get(r1, "far").value, /実効 240%/);
  const r2 = deriveFindings({ reinfo: reinfo("近隣商業地域", "80%", "300%"), hazards: [], manual: { roadWidth: "12" } });
  assert.match(get(r2, "far").value, /幅員制限なし/);
});

test("2項道路はセットバック量を計算", () => {
  const r = deriveFindings({ reinfo: reinfo("第１種低層住居専用地域", "50%", "100%"), hazards: [], manual: { roadType: "2", roadWidth: "3.2", frontage: "10", lotArea: "150" } });
  assert.match(get(r, "setback").value, /約0\.40m後退/);
  assert.match(get(r, "volume").value, /有効敷地 約146\.0㎡/);
});

test("市街化調整区域・工業専用地域・防火地域は重大", () => {
  const r = deriveFindings({
    reinfo: [{ id: "areaDivision", status: "ok", hits: [{ 区域区分: "市街化調整区域" }] }, { id: "useZone", status: "ok", hits: [] }],
    hazards: [],
  });
  assert.equal(get(r, "areaDivision").level, "danger");
  const r2 = deriveFindings({ reinfo: reinfo("工業専用地域", "60%", "200%", "防火地域"), hazards: [] });
  assert.equal(get(r2, "useZone").level, "danger");
  assert.equal(get(r2, "fire").level, "danger");
});

test("ハザードの深さ判定（1.0〜3.0m は注意、3.0m以上は重大）", () => {
  const hz = (atPoint) => deriveFindings({ reinfo: [], hazards: [{ id: "flood", name: "洪水", status: "ok", atPoint }] });
  assert.equal(get(hz("1.0〜3.0m"), "hz_flood").level, "warn");
  assert.equal(get(hz("3.0〜5.0m"), "hz_flood").level, "danger");
  assert.equal(get(hz("特別警戒区域（レッドゾーン）"), "hz_flood").level, "danger");
});

test("APIキーなしでも手入力分は判定できる", () => {
  const r = deriveFindings({ reinfo: [{ id: "useZone", status: "nokey" }], hazards: [], manual: { sewer: "septic" } });
  assert.equal(get(r, "useZone"), undefined);
  assert.equal(get(r, "sewer").level, "warn");
});

test("点の内外判定とタイル計算", () => {
  const square = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
  assert.equal(geometryContains(square, 0.5, 0.5), true);
  assert.equal(geometryContains(square, 1.5, 0.5), false);
  const t = lonLatToTile(136.7835, 35.1245, 15);
  assert.deepEqual([t.x, t.y], [28834, 12965]);
});

test("住所の市町村分割", () => {
  assert.equal(splitAddress("愛知県名古屋市中区三の丸三丁目").city, "名古屋市中区");
  assert.equal(splitAddress("三重県四日市市諏訪町").city, "四日市市");
  assert.equal(splitAddress("愛知県蒲郡市形原町").city, "蒲郡市");
  assert.equal(splitAddress("愛知県海部郡蟹江町蟹江本町").city, "海部郡蟹江町");
});

test("用途地域が未取得なら高さ制限を『指定なし』と判定しない", () => {
  const r = deriveFindings({ reinfo: [{ id: "useZone", status: "nokey" }], hazards: [] });
  assert.equal(get(r, "height").level, "none");
  assert.match(get(r, "height").value, /未取得/);
});

test("液状化は『しやすい』のときだけ注意", () => {
  const liq = (傾向, 強弱6段階) => deriveFindings({ reinfo: [{ id: "liquefaction", status: "ok", hits: [{ 地形: "丘陵", 傾向, 強弱6段階 }] }], hazards: [] });
  assert.equal(get(liq("液状化しにくい", 5), "liquefaction").level, "info");
  assert.equal(get(liq("やや液状化しやすい", 3), "liquefaction").level, "warn");
});
