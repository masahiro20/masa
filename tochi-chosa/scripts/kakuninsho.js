// 住所から調査して、法令制限確認書（Excel）を output/ に出力する
//   node --env-file=.env scripts/kakuninsho.js "愛知県○○市○○町1-2" [--manual manual.json] [--insight 見解.md] [--lat 35.1 --lon 136.9]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { geocode } from "../lib/gsi.js";
import { runSurvey } from "../lib/survey.js";
import { buildKakuninsho, kakuninshoFileName } from "../lib/kakuninsho.js";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const address = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!address) {
  console.error('使い方: node scripts/kakuninsho.js "住所" [--manual manual.json] [--insight 見解.md] [--lat 緯度 --lon 経度] [--out 出力先]');
  process.exit(1);
}

let lat = opt("lat") && Number(opt("lat"));
let lon = opt("lon") && Number(opt("lon"));
let title = address;
if (!lat || !lon) {
  const [hit] = await geocode(address);
  if (!hit) throw new Error(`住所が見つかりません: ${address}`);
  ({ lat, lon } = hit);
  console.log(`位置: ${hit.title}（${lat}, ${lon}）※街区・番地の代表点。敷地とずれる場合は --lat --lon で指定`);
}

const survey = await runSurvey({ lat, lon, address: title });
if (!survey.hasReinfoKey) console.warn("※ REINFOLIB_API_KEY 未設定のため用途地域などは空欄になります");
const manual = opt("manual") ? JSON.parse(await readFile(opt("manual"), "utf8")) : {};
const insight = opt("insight") ? await readFile(opt("insight"), "utf8") : "";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = opt("out") || path.join(root, "output");
await mkdir(outDir, { recursive: true });
const file = path.join(outDir, kakuninshoFileName(survey));
await writeFile(file, await buildKakuninsho({ survey, manual, insight }));
await writeFile(file.replace(/\.xlsx$/, ".json"), JSON.stringify({ survey, manual }, null, 1));
console.log(`出力しました: ${file}`);
