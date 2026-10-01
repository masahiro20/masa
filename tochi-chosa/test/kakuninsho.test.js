import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildKakuninsho, templateAvailable } from "../lib/kakuninsho.js";

// テンプレート（会社の書式）はリポジトリに含めないので、置いてある環境でだけ実行する
const hasTemplate = await templateAvailable();

const survey = {
  address: "愛知県テスト市テスト町1-1", lat: 35, lon: 137, city: "テスト市", fetchedAt: "2026-10-01T00:00:00Z",
  elevation: { elevation: 5 },
  hazards: [{ id: "flood", name: "洪水浸水想定（想定最大規模）", status: "ok", atPoint: "0.5〜1.0m" }],
  reinfo: [
    { id: "areaDivision", status: "ok", hits: [{ 区域区分: "都市計画区域" }, { 区域区分: "市街化区域" }] },
    { id: "useZone", status: "ok", hits: [{ 用途地域: "第１種中高層住居専用地域", 建蔽率: "60%", 容積率: "200%" }] },
    { id: "fireZone", status: "ok", hits: [{ 地域: "準防火地域" }] },
    { id: "districtPlan", status: "ok", hits: [] },
    { id: "landPrice", status: "ok", hits: [] },
  ],
};

test("確認書の欄とチェックボックスを埋める", { skip: !hasTemplate && "テンプレート未配置" }, async () => {
  const buf = await buildKakuninsho({
    survey,
    manual: { roadType: "1-1", roadWidth: "6", roadDir: "南", roadAdmin: "municipal", waterService: "20", sewer: "public", gas: "lp" },
    insight: "## 総合所見\nA",
  });
  const zip = await JSZip.loadAsync(buf);
  const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  const cell = (ref) => sheet.match(new RegExp(`<c r="${ref}"[^>]*>(?:<is><t[^>]*>([^<]*)</t></is>|<v>([^<]*)</v>)`))?.slice(1).find(Boolean);
  assert.equal(cell("B12"), "第一種中高層住居専用");
  assert.equal(cell("B13"), "60");
  assert.equal(cell("G13"), "200");
  assert.equal(cell("D20"), "1");
  assert.equal(cell("G20"), "1");
  assert.equal(cell("D21"), "南");
  assert.equal(cell("H21"), "6");
  const vml = await zip.file("xl/drawings/vmlDrawing1.vml").async("string");
  const checked = [...vml.matchAll(/<v:shape id="_x0000_s(\d+)"(?:(?!<\/v:shape>)[\s\S])*?<x:Checked>1<\/x:Checked>/g)].map((m) => Number(m[1]));
  // 内・市街化区域・準防火・壁面後退無・市道・引込有・下水道・LP(個別)
  assert.deepEqual(checked.sort(), [1028, 1030, 1034, 1039, 1043, 1046, 1063, 1066, 1113].sort());
  const book = await zip.file("xl/workbook.xml").async("string");
  assert.match(book, /name="調査結果・AI見解"/);
});

test("お客様情報と融資のチェックも入れられる", { skip: !hasTemplate && "テンプレート未配置" }, async () => {
  const buf = await buildKakuninsho({
    survey,
    manual: { customer: { name1: "山田 太郎", kana1: "ヤマダ タロウ", phone1: "090-0000-0000", zip: "100-0001", address: "東京都千代田区千代田1-1" }, loan: "bank" },
  });
  const zip = await JSZip.loadAsync(buf);
  const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(sheet, /<c r="B4"[^>]*><is><t[^>]*>山田 太郎</);
  assert.match(sheet, /<c r="B6"[^>]*><is><t[^>]*>〒100-0001</);
  const vml = await zip.file("xl/drawings/vmlDrawing1.vml").async("string");
  assert.match(vml, /_x0000_s1094"(?:(?!<\/v:shape>)[\s\S])*?<x:Checked>1/);
});
