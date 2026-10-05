// 「敷地調査 建築法令制限確認書」テンプレートへの自動入力。
// お客様情報・仕様欄は営業が入力するので触らず、土地に関する欄だけを埋める。
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveFindings, normalizeZone, pct } from "../public/shared/rules.js";
import {
  openWorkbook, saveWorkbook, sheetPath, setCell, setRowHeight, setCheckboxes, addAlignedStyle, addSimpleSheet, forceRecalc,
} from "./xlsx-fill.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const TEMPLATE_PATH = process.env.KAKUNINSHO_TEMPLATE || path.join(ROOT, "templates", "法令制限確認書.xlsx");

// テンプレート（Ver1-2）のチェックボックスのシェイプ ID
const CB = {
  cityPlanIn: 1028, cityPlanOut: 1029, urbanization: 1030, adjustment: 1031, unzoned: 1032,
  fire: 1033, quasiFire: 1034, art22: 1035,
  heightDistrictYes: 1036, heightDistrictNo: 1037,
  wallSetbackYes: 1038, wallSetbackNo: [1039, 1043],
  agreementYes: 1040, agreementNo: 1041,
  road1: { national: 1044, prefectural: 1045, municipal: 1046 },
  road2: { national: 1047, prefectural: 1048, municipal: 1049 },
  waterYes: 1063, waterNo: 1064, waterCheck: 1065,
  sewer: 1066, septic: 1111, centralSeptic: 1067,
  cityGas: 1112, lpIndividual: 1113, lpCentral: 1114,
  surveyFixed: 1121, surveyCurrent: 1122,
  loanFlat35: 1093, loanBank: 1094,
};

const ROAD_ARTICLE = {
  "1-1": [1, 1], "1-2": [1, 2], "1-3": [1, 3], "1-4": [1, 4], "1-5": [1, 5], "2": [2, ""],
};

const LOW_RISE = ["1低", "2低", "田住"];

// 「第１種低層住居専用地域」→ テンプレートの書き方「第一種低層住居専用」（後ろに「地域」が印字済み）
function zoneForForm(name) {
  if (!name) return "";
  return name
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace("第1種", "第一種")
    .replace("第2種", "第二種")
    .replace(/地域$/, "");
}

const hitsOf = (reinfo, id) => {
  const r = reinfo.find((x) => x.id === id);
  return r?.status === "ok" ? r.hits || [] : null; // null = 未取得
};

export async function templateAvailable() {
  try {
    await access(TEMPLATE_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object} survey  /api/survey の結果
 * @param {object} manual  手入力（道路・ライフラインなど）
 * @param {string} insight AI見解（Markdown）。なくてもよい
 */
export async function buildKakuninsho({ survey, manual = {}, insight = "" }) {
  const wb = await openWorkbook(await readFile(TEMPLATE_PATH));
  const main = await sheetPath(wb, "敷地調査書");
  let xml = await wb.get(main);
  const set = (ref, v, style) => (xml = setCell(xml, ref, v, style));
  const checks = {};
  const check = (ids, on = true) => [ids].flat().forEach((id) => (checks[id] = on));

  const reinfo = survey.reinfo || [];
  const { findings } = deriveFindings({ reinfo, hazards: survey.hazards || [], manual, city: survey.city });
  const f = (key) => findings.find((x) => x.key === key);
  const notes = []; // 備考欄
  const todo = []; // 要確認

  // --- お客様情報（入力があるときだけ。無ければ営業が手書き・手入力する欄なので触らない） ---
  const c = manual.customer || {};
  if (c.sales) set("B2", c.sales);
  if (c.kana1) set("B3", c.kana1);
  if (c.kana2) set("F3", c.kana2);
  if (c.name1) set("B4", c.name1);
  if (c.name2) set("F4", c.name2);
  if (c.phone1) set("B5", c.phone1);
  if (c.phone2) set("F5", c.phone2);
  if (c.zip) set("B6", `〒${c.zip}`);
  if (c.address) set("D6", c.address);
  if (manual.loan === "flat35") check(CB.loanFlat35);
  if (manual.loan === "bank") check(CB.loanBank);

  // --- 建築地住所・地番 ---
  set("D7", survey.address || "");
  if (manual.zip) set("B7", `〒${manual.zip}`);
  if (manual.lotNumber) set("B10", manual.lotNumber);

  // --- 都市計画区域 ---
  const area = hitsOf(reinfo, "areaDivision");
  if (area) {
    const names = area.map((h) => h.区域区分 || "");
    if (names.length) check(CB.cityPlanIn);
    else {
      todo.push("都市計画区域（データなし：区域外または未整備）");
    }
    if (names.some((n) => n.includes("調整"))) check(CB.adjustment);
    else if (names.some((n) => n.includes("市街化区域"))) check(CB.urbanization);
    else if (names.some((n) => n.includes("非線引") || n.includes("未線引"))) check(CB.unzoned);
    // 区域区分の記載がなく「都市計画区域」だけの場合は非線引き（未線引）都市計画区域
    else if (names.length && names.every((n) => n === "都市計画区域")) check(CB.unzoned);
    else if (names.length) todo.push("区域区分（線引きの有無）");
  } else todo.push("都市計画区域");

  // --- 用途地域・建蔽率・容積率 ---
  const zones = hitsOf(reinfo, "useZone");
  const uniqueZones = zones ? [...new Map(zones.map((z) => [z.用途地域, z])).values()] : [];
  set("B12", zoneForForm(uniqueZones[0]?.用途地域)); // テンプレートの見本値も上書き
  set("G12", uniqueZones[1] ? `${zoneForForm(uniqueZones[1].用途地域)}地域` : "");
  if (uniqueZones.length > 1) notes.push("用途地域が敷地内で2つにまたがる可能性（面積按分を要確認）");
  if (!uniqueZones.length && manual.bcr == null) todo.push("用途地域・建蔽率・容積率");
  if (!uniqueZones.length) set("B12", "無指定"); // 書式上「無指定地域」（白地）と読める
  // 用途地域の指定がない区域（白地）は役所で確認した値を手入力で受け付ける
  const bcr = pct(uniqueZones[0]?.建蔽率) ?? pct(manual.bcr);
  const far = pct(uniqueZones[0]?.容積率) ?? pct(manual.far);
  set("B13", bcr ?? "");
  set("E13", "容積率");
  set("G13", far ?? "");
  const farFinding = f("far");
  if (farFinding && /実効/.test(farFinding.value) && farFinding.level === "warn") {
    notes.push(`容積率：${farFinding.value.replace(/^指定 \d+% ／ /, "")}`);
  }

  // --- 防火 ---
  const fire = hitsOf(reinfo, "fireZone");
  const fireName = fire?.[0]?.地域 || "";
  if (fireName.includes("準防火")) check(CB.quasiFire);
  else if (fireName.includes("防火")) check(CB.fire);
  else if (manual.art22) check(CB.art22); // 役所・県告示で確認できた場合
  else todo.push("法22条区域の指定");

  // --- 高度地区（データが無いので要確認。近隣の地価公示に記載があれば参考に書く） ---
  const lp = hitsOf(reinfo, "landPrice") || [];
  const altitude = lp.map((p) => p.高度地区).find(Boolean);
  if (altitude) {
    set("D15", `${altitude.replace(/高度地区$/, "")}（近隣参考）`);
    todo.push("高度地区（近隣の地価公示地点に指定あり）");
  } else {
    set("D15", "");
    todo.push("高度地区");
  }

  // --- 壁面後退 ---
  const zoneKey = normalizeZone(uniqueZones[0]?.用途地域);
  const district = hitsOf(reinfo, "districtPlan") || [];
  if (district.length) {
    todo.push(`壁面後退（地区計画「${district[0].計画名}」）`);
  } else if (zoneKey && !LOW_RISE.includes(zoneKey)) {
    check(CB.wallSetbackNo);
  } else if (!zoneKey && zones && area?.length) {
    check(CB.wallSetbackNo); // 都市計画区域内の用途地域無指定（白地）には外壁後退の定めなし
  } else {
    todo.push("外壁後退（低層住居専用地域）");
  }

  // --- 建築協定（GISデータ無し） ---
  set("D17", "");
  todo.push("建築協定");

  // --- その他地区 ---
  const other = [];
  if (district.length) other.push(`地区計画：${district.map((d) => d.計画名).join("・")}`);
  const adv = hitsOf(reinfo, "advancedUse") || [];
  if (adv.length) other.push("高度利用地区");
  const loc = (hitsOf(reinfo, "locationPlan") || []).map((x) => x.区域);
  if (loc.includes("居住誘導区域")) other.push("居住誘導区域内");
  else if (loc.length) other.push("居住誘導区域外（届出要確認）");
  const cpr = hitsOf(reinfo, "cityPlanRoad") || [];
  if (cpr.length) other.push(`都市計画道路 近接（${cpr[0].距離}）`);
  for (const id of ["disasterZone", "steepSlopeArea", "landslideArea"]) {
    const h = hitsOf(reinfo, id) || [];
    if (h.length) other.push(reinfo.find((x) => x.id === id).name);
  }
  const sed = hitsOf(reinfo, "sediment") || [];
  if (sed.length) other.push(`土砂災害${String(sed[0].区域).includes("特別") ? "特別" : ""}警戒区域`);

  // --- 接道 ---
  const writeRoad = (n, { type, width, dir, admin }) => {
    const [artRow, dirRow, cbs] = n === 1 ? [20, 21, CB.road1] : [23, 24, CB.road2];
    const art = ROAD_ARTICLE[type];
    set(`D${artRow}`, art ? art[0] : "");
    set(`G${artRow}`, art ? art[1] : "");
    set(`D${dirRow}`, dir || "");
    set(`H${dirRow}`, width ? Number(width) : "");
    if (admin === "national") check(cbs.national);
    if (admin === "prefectural") check(cbs.prefectural);
    if (admin === "municipal") check(cbs.municipal);
    if (type === "43") notes.push(`接道${n}：法43条2項（例外許可・認定）`);
    if (type === "none") notes.push(`接道${n}：建築基準法上の道路に該当しない`);
    if (admin === "private") notes.push(`接道${n}：私道`);
  };
  writeRoad(1, { type: manual.roadType, width: manual.roadWidth, dir: manual.roadDir, admin: manual.roadAdmin });
  writeRoad(2, { type: manual.road2Type, width: manual.road2Width, dir: manual.road2Dir, admin: manual.road2Admin });
  if (!manual.roadType) todo.push("前面道路の種別・幅員");
  const sb = f("setback");
  if (sb) notes.push(`${sb.label}：${sb.value}`);

  // --- 上下水道・ガス ---
  if (manual.waterService === "none") check(CB.waterNo);
  else if (manual.waterService) check(CB.waterYes);
  else check(CB.waterCheck);
  const water = [manual.waterMain && `前面本管φ${manual.waterMain}`, manual.waterService && manual.waterService !== "none" && `既存引込φ${manual.waterService}`]
    .filter(Boolean).join("・");
  if (water) notes.push(`給水：${water}`);
  else todo.push("給水（本管・引込口径）");

  if (manual.sewer === "public") check(CB.sewer);
  else if (manual.sewer === "septic") check(CB.septic);
  else if (manual.sewer === "central") check(CB.centralSeptic);
  else if (manual.sewer === "rural") notes.push("排水：農業集落排水");
  else todo.push("排水（下水道・浄化槽）");

  if (manual.gas === "city") check(CB.cityGas);
  else if (manual.gas === "lp") check(CB.lpIndividual);
  else if (manual.gas === "lpCentral") check(CB.lpCentral);
  else if (manual.gas === "allElectric") notes.push("ガス：オール電化予定");
  else todo.push("ガス（都市ガス本管の有無）");
  if (manual.gasMain) notes.push(`ガス本管：${manual.gasMain}`);

  // --- 測量 ---
  if (manual.surveyFixed) check(CB.surveyFixed);
  if (manual.surveyCurrent) check(CB.surveyCurrent);

  // --- 高さ制限・ハザード（専用欄が無いので「その他地区」と備考へ） ---
  if (zoneKey && LOW_RISE.includes(zoneKey)) other.push("絶対高さ10m/12m（要確認）");
  const hz = findings.filter((x) => (x.key.startsWith("hz_") || x.key.startsWith("rf_") || x.key === "liquefaction") && ["warn", "danger"].includes(x.level));
  if (hz.length) notes.push(`ハザード：${hz.map((x) => `${x.label.replace(/（.*）/, "")} ${x.value}`).join("、")}`);

  if (manual.memo) notes.push(...manual.memo.split(/\n+/).filter(Boolean));
  if (todo.length) notes.push(`要確認：${todo.join("、")}`);
  notes.push("※詳細は「調査結果・AI見解」シート");

  // 備考は折り返し・左上詰めで表示（元の書式は中央揃え1行のため）
  const wrapStyle = await addAlignedStyle(wb, 67, '<alignment horizontal="left" vertical="top" wrapText="1"/>');
  const shrinkStyle = await addAlignedStyle(wb, 75, '<alignment horizontal="center" vertical="center" shrinkToFit="1"/>');
  set("B18", other.join("／") || (zones ? "地区計画等の指定なし（データ上）" : ""), shrinkStyle);
  set("B50", notes.map((n) => `・${n}`).join("\n"), wrapStyle);
  // 備考の行数に合わせて 50・51 行目を広げる（1行あたり約14pt、全角約45文字で折り返し）
  const lines = notes.reduce((n, t) => n + Math.ceil((t.length + 1) / 45), 0);
  const ht = Math.max(20, Math.ceil((lines * 14) / 2));
  xml = setRowHeight(setRowHeight(xml, 50, ht), 51, ht);

  wb.set(main, xml);
  await setCheckboxes(wb, main, checks);

  // 申請スケジュールの「防火指定」
  try {
    const sched = await sheetPath(wb, "申請スケジュール");
    let sx = await wb.get(sched);
    const fireText = fireName.includes("準防火") ? "準防火地域" : fireName.includes("防火") ? "防火地域" : "";
    sx = setCell(sx, "B6", fireText);
    wb.set(sched, sx);
  } catch {
    /* シートが無い版のテンプレートでも続行 */
  }

  // --- 調査結果・AI見解シート ---
  const head = (t) => Object.assign([t, ""], { head: true });
  const rows = [
    head("敷地調査 自動調査結果"),
    ["住所", survey.address || ""],
    ["座標", `${survey.lat}, ${survey.lon}`],
    ["標高", survey.elevation ? `約${survey.elevation.elevation}m` : "-"],
    ["取得日時", new Date(survey.fetchedAt || Date.now()).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })],
    head("判定結果"),
    ...findings.map((x) => [x.label, `${x.value}${x.note ? `\n${x.note}` : ""}`]),
  ];
  const extra = [
    ["小学校区", (hitsOf(reinfo, "elementarySchool") || []).map((h) => h.学校).join("・") || "-"],
    ["中学校区", (hitsOf(reinfo, "juniorHighSchool") || []).map((h) => h.学校).join("・") || "-"],
  ];
  rows.push(...extra);
  if (lp.length) {
    rows.push(head("近隣の地価公示・地価調査（参考：対象地そのものではありません）"));
    for (const p of lp) {
      rows.push([p.距離, [p.所在, p.価格, `前面道路 ${p.前面道路 || "-"}`, `水道${p.水道 ? "あり" : "なし"}・ガス${p.ガス ? "あり" : "なし"}・下水道${p.下水道 ? "あり" : "なし"}`, `${p.用途地域 || ""} ${p.建蔽率 || ""}/${p.容積率 || ""}`].join("\n")]);
    }
  }
  if (insight) {
    rows.push(head("AIによる見解"));
    for (const block of insight.split(/\n(?=#{1,4}\s)/)) {
      const [first, ...rest] = block.trim().split("\n");
      const title = first.replace(/^#{1,4}\s*/, "");
      rows.push([title, rest.join("\n").replace(/\*\*/g, "").trim()]);
    }
  }
  rows.push(head("出典・注意"));
  rows.push(["出典", "不動産情報ライブラリ（国土交通省）、重ねるハザードマップ・地理院地図（国土地理院）"]);
  rows.push(["注意", "公開データによる一次調査です。重要事項説明・設計の根拠とする場合は、市町村・各事業者の原本で必ず確認してください。"]);

  const headStyle = await addAlignedStyle(wb, 75, '<alignment horizontal="left" vertical="center"/>');
  const bodyStyle = await addAlignedStyle(wb, 67, '<alignment horizontal="left" vertical="top" wrapText="1"/>');
  await addSimpleSheet(wb, "調査結果・AI見解", rows, { headStyle, bodyStyle });
  await forceRecalc(wb);
  return saveWorkbook(wb);
}

export function kakuninshoFileName(survey) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const place = (survey.address || "土地").replace(/[\\/:*?"<>|\s]/g, "");
  return `法令制限確認書_${place}_${ymd}.xlsx`;
}
