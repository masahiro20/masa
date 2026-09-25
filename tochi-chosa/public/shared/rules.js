// 取得データと手入力から、建築基準法・都市計画法上の目安を機械的に判定する。
// AI に計算させず、ここで確定的に出す（AI は解釈・所見のみ担当）。

const toHalf = (s) => (s || "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

export function normalizeZone(name) {
  const s = toHalf(name).replace(/\s/g, "").replace("第一種", "第1種").replace("第二種", "第2種");
  const table = [
    ["第1種低層住居専用地域", "1低"],
    ["第2種低層住居専用地域", "2低"],
    ["田園住居地域", "田住"],
    ["第1種中高層住居専用地域", "1中高"],
    ["第2種中高層住居専用地域", "2中高"],
    ["第1種住居地域", "1住"],
    ["第2種住居地域", "2住"],
    ["準住居地域", "準住"],
    ["近隣商業地域", "近商"],
    ["商業地域", "商業"],
    ["準工業地域", "準工"],
    ["工業専用地域", "工専"],
    ["工業地域", "工業"],
  ];
  for (const [full, key] of table) if (s.includes(full)) return key;
  return null;
}

const LOW_RISE = ["1低", "2低", "田住"];
const MID_HIGH = ["1中高", "2中高"];
const RESIDENTIAL = [...LOW_RISE, ...MID_HIGH, "1住", "2住", "準住"];
const COMMERCIAL = ["近商", "商業"];

export const pct = (s) => {
  const m = toHalf(String(s ?? "")).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
};

// 道路斜線の適用距離（法別表第3、概略）
function roadSlopeDistance(zone, far) {
  if (far == null) return null;
  if (COMMERCIAL.includes(zone)) {
    if (far <= 400) return 20;
    if (far <= 600) return 25;
    if (far <= 800) return 30;
    if (far <= 1000) return 35;
    if (far <= 1100) return 40;
    if (far <= 1200) return 45;
    return 50;
  }
  if (far <= 200) return 20;
  if (far <= 300) return 25;
  if (far <= 400) return 30;
  return 35;
}

export function heightRules(zone, far) {
  const dist = roadSlopeDistance(zone, far);
  const road = (grad) => `道路斜線 勾配${grad}${dist ? `（適用距離 ${dist}m）` : ""}`;
  if (LOW_RISE.includes(zone)) {
    return {
      absolute: "絶対高さ制限 10m または 12m（都市計画で指定。どちらかを要確認）",
      lines: [road("1.25"), "北側斜線 5m＋1.25/1", "隣地斜線 なし（絶対高さで制限）"],
      shadow: "日影規制の対象（軒高7m超または地上3階以上）。規制時間は条例で要確認",
      wallSetback: "外壁の後退距離（1mまたは1.5m）が都市計画で定められている場合あり。要確認",
    };
  }
  if (MID_HIGH.includes(zone)) {
    return {
      absolute: "絶対高さ制限なし（高度地区の指定がある場合はそちらに従う）",
      lines: [road("1.25"), "隣地斜線 20m＋1.25/1", "北側斜線 10m＋1.25/1（日影規制がある区域では適用除外）"],
      shadow: "日影規制の対象（高さ10m超）。規制時間は条例で要確認",
      wallSetback: "用途地域による外壁後退の定めなし（地区計画・建築協定で定める場合あり）",
    };
  }
  if (["1住", "2住", "準住"].includes(zone)) {
    return {
      absolute: "絶対高さ制限なし（高度地区の指定がある場合はそちらに従う）",
      lines: [road("1.25"), "隣地斜線 20m＋1.25/1", "北側斜線 なし（高度地区で北側制限がある場合あり）"],
      shadow: "日影規制の対象（高さ10m超）。規制時間は条例で要確認",
      wallSetback: "用途地域による外壁後退の定めなし（地区計画・建築協定で定める場合あり）",
    };
  }
  if (zone) {
    return {
      absolute: "絶対高さ制限なし（高度地区の指定がある場合はそちらに従う）",
      lines: [road("1.5"), "隣地斜線 31m＋2.5/1", "北側斜線 なし"],
      shadow: ["商業", "工業", "工専"].includes(zone)
        ? "日影規制の対象外（ただし隣接する他の用途地域への日影に注意）"
        : "条例により日影規制の対象となる場合あり（高さ10m超）",
      wallSetback: "用途地域による外壁後退の定めなし（地区計画・建築協定で定める場合あり）",
    };
  }
  return {
    absolute: "用途地域の指定なし：絶対高さ制限なし",
    lines: ["道路斜線 1.25または1.5、隣地斜線 20m＋1.25または31m＋2.5（特定行政庁が指定）"],
    shadow: "条例で日影規制が定められている場合あり。要確認",
    wallSetback: "用途地域による外壁後退の定めなし",
  };
}

export const ROAD_TYPES = {
  "1-1": "42条1項1号（道路法の道路）",
  "1-2": "42条1項2号（開発道路等）",
  "1-3": "42条1項3号（既存道路）",
  "1-4": "42条1項4号（計画道路）",
  "1-5": "42条1項5号（位置指定道路）",
  "2": "42条2項道路（みなし道路）",
  "43": "法43条2項（接道の例外許可・認定）",
  "none": "建築基準法上の道路に該当しない",
};

function firstHit(results, id) {
  const r = results.find((x) => x.id === id);
  return r?.status === "ok" ? r.hits?.[0] || null : null;
}

// 地価公示ポイントの「水道/ガス/下水道」は true/false の文字列で返る場合がある
const yesNo = (v) => (v === true || v === "true" ? "あり" : v === false || v === "false" ? "なし" : null);

export function deriveFindings({ reinfo = [], hazards = [], manual = {}, city = "" }) {
  const F = []; // { key, label, value, level, note }
  const add = (key, label, value, level = "info", note = "") => F.push({ key, label, value, level, note });

  const zoneHit = firstHit(reinfo, "useZone");
  const zoneName = zoneHit?.用途地域 || "";
  const zone = normalizeZone(zoneName);
  const bcr = pct(zoneHit?.建蔽率);
  const far = pct(zoneHit?.容積率);
  const areaList = (reinfo.find((r) => r.id === "areaDivision")?.hits || []).map((h) => h.区域区分).filter(Boolean);
  const fire = firstHit(reinfo, "fireZone")?.地域 || "";
  const reinfoOk = reinfo.some((r) => r.status === "ok");

  // --- 区域区分 ---
  if (areaList.some((a) => a.includes("調整"))) {
    add("areaDivision", "区域区分", "市街化調整区域", "danger",
      "原則として住宅の新築は不可。都市計画法34条・43条の許可、既存宅地・分家住宅等の要件を必ず確認");
  } else if (areaList.length) {
    add("areaDivision", "区域区分", [...new Set(areaList)].join("／"), "info");
  } else if (reinfoOk) {
    add("areaDivision", "区域区分", "データなし", "check",
      "都市計画区域外、またはGISデータ未整備の可能性。市町村の都市計画課で確認");
  }

  // --- 用途地域・建蔽率・容積率 ---
  if (zoneName) {
    add("useZone", "用途地域", zoneName, zone === "工専" ? "danger" : "info",
      zone === "工専" ? "工業専用地域では住宅は建築不可" : "");
  } else if (reinfoOk) {
    add("useZone", "用途地域", "指定なし／データなし", "check",
      "用途地域の指定がない区域（白地・調整区域）か、データ未整備。建蔽率・容積率は特定行政庁の指定値を要確認");
  }
  if (bcr != null) {
    const bonus = [];
    if (manual.corner) bonus.push("角地緩和 +10%（特定行政庁の角地指定基準を満たす場合）");
    if (fire.includes("防火") && !fire.includes("準防火")) bonus.push("防火地域内の耐火建築物等 +10%");
    else if (fire.includes("準防火")) bonus.push("準防火地域内の耐火・準耐火建築物等 +10%");
    add("bcr", "建蔽率", `${bcr}%`, "info", bonus.length ? `緩和の可能性：${bonus.join("、")}` : "");
  }

  // --- 前面道路 ---
  const roadType = manual.roadType || "";
  const width = manual.roadWidth ? Number(manual.roadWidth) : null;
  const frontage = manual.frontage ? Number(manual.frontage) : null;
  if (roadType) {
    const level = roadType === "none" ? "danger" : roadType === "2" || roadType === "43" ? "warn" : "info";
    const note =
      roadType === "none" ? "接道義務（幅員4m以上の道路に2m以上接道）を満たさず、原則建築不可"
      : roadType === "43" ? "建築審査会の同意等が必要。再建築の可否を個別に確認"
      : roadType === "1-5" ? "位置指定道路。私道の持分・通行掘削承諾の有無を確認"
      : "";
    add("roadType", "前面道路の種別", ROAD_TYPES[roadType] || roadType, level, note);
  } else {
    add("roadType", "前面道路の種別", "未確認", "check",
      "市町村の指定道路図・道路台帳（建築指導課／道路管理課）で確認し、下の入力欄に記入");
  }
  if (width != null) {
    let setback = 0;
    if (roadType === "2" && width < 4) {
      setback = (4 - width) / 2;
      add("setback", "セットバック", `道路中心線から2m（現況幅員${width}mなら約${setback.toFixed(2)}m後退）`, "warn",
        "向かい側が川・崖等の場合は片側で4m確保が必要。後退部分は敷地面積に算入不可");
    } else if (width < 4 && roadType !== "2") {
      add("setback", "幅員", `${width}m（4m未満）`, "warn", "2項道路の指定の有無、狭あい道路協議の要否を確認");
    }
    add("roadWidth", "前面道路の幅員", `${width}m`, width < 4 ? "warn" : "info");
    if (frontage != null && frontage < 2) {
      add("frontage", "接道長さ", `${frontage}m`, "danger", "接道2m未満。建築不可の可能性（条例で旗竿地等の加重あり）");
    }
    // 容積率の前面道路幅員による制限（法52条2項）
    if (far != null && width < 12) {
      const coef = zone == null || RESIDENTIAL.includes(zone) ? 0.4 : 0.6;
      const byRoad = Math.round(width * coef * 100);
      const eff = Math.min(far, byRoad);
      add("far", "容積率", `指定 ${far}% ／ 道路幅員制限 ${width}m×${coef * 10}/10=${byRoad}% → 実効 ${eff}%`,
        eff < far ? "warn" : "info",
        coef === 0.4 && zone == null ? "用途地域の指定がない区域の係数は特定行政庁の指定による" : "");
    } else if (far != null) {
      add("far", "容積率", `${far}%（前面道路12m以上のため幅員制限なし）`, "info");
    }
  } else if (far != null) {
    add("far", "容積率", `指定 ${far}%`, "info",
      "前面道路が12m未満なら「幅員×0.4（住居系）または0.6」との小さい方が上限。幅員を入力すると自動計算");
  }

  // 敷地面積があれば概算ボリューム
  const lotArea = manual.lotArea ? Number(manual.lotArea) : null;
  if (lotArea && bcr != null) {
    const sbArea = roadType === "2" && width != null && width < 4 && frontage ? ((4 - width) / 2) * frontage : 0;
    const eff = lotArea - sbArea;
    const farEff = far != null ? Math.min(far, width != null && width < 12 ? width * (zone == null || RESIDENTIAL.includes(zone) ? 40 : 60) : far) : null;
    add("volume", "概算ボリューム",
      `有効敷地 約${eff.toFixed(1)}㎡ → 建築面積 約${((eff * bcr) / 100).toFixed(1)}㎡` +
        (farEff != null ? ` ／ 延床面積 約${((eff * farEff) / 100).toFixed(1)}㎡` : ""),
      "info", sbArea ? `セットバック面積 約${sbArea.toFixed(1)}㎡を控除（概算）` : "緩和・地区計画等は未考慮の概算");
  }

  // --- 高さ制限・壁面後退 ---
  // 用途地域が取れていない（キー未設定・取得失敗）のに「指定なし」と判定しないようにする
  const zoneKnown = reinfo.find((r) => r.id === "useZone")?.status === "ok";
  const district = firstHit(reinfo, "districtPlan");
  if (zoneKnown) {
    const h = heightRules(zone, far);
    const advancedUse = firstHit(reinfo, "advancedUse");
    const nearbyAltitude = (reinfo.find((r) => r.id === "landPrice")?.hits || []).map((p) => p.高度地区).find(Boolean);
    add("height", "高さ制限", [h.absolute, ...h.lines].join(" ／ "), zone == null ? "check" : "info",
      [h.shadow, nearbyAltitude ? `近隣の地価公示地点に「${nearbyAltitude}」の指定あり。高度地区を要確認` : "高度地区（北側・絶対高さ）の指定は市町村の都市計画図で要確認", advancedUse ? `高度利用地区：${advancedUse.名称 || advancedUse.区分 || "指定あり"}（容積率の最低限度・壁面の位置等を要確認）` : ""].filter(Boolean).join("。"));
    add("wallSetback", "壁面後退", district ? `地区計画「${district.計画名}」区域内` : h.wallSetback,
      district ? "warn" : zone && LOW_RISE.includes(zone) ? "check" : "info",
      district ? "地区計画で壁面の位置・高さ・用途・最低敷地面積・垣柵等が定められている可能性大。計画書を要確認" : "建築協定・景観計画の有無もあわせて確認");
  } else {
    add("height", "高さ制限", "用途地域が未取得のため判定できません", "none",
      "市町村の都市計画図で用途地域・高度地区・日影規制を確認");
    add("wallSetback", "壁面後退", "用途地域・地区計画が未取得のため判定できません", "none",
      "低層住居専用地域の外壁後退、地区計画・建築協定の有無を市町村で確認");
  }

  // --- 防火 ---
  if (fire.includes("準防火")) {
    add("fire", "防火指定", "準防火地域", "warn",
      "地上3階建は準耐火建築物等または技術的基準適合。2階以下でも延焼のおそれのある部分の外壁・軒裏は防火構造、開口部は防火設備");
  } else if (fire.includes("防火")) {
    add("fire", "防火指定", "防火地域", "danger",
      "3階以上または延べ100㎡超は耐火建築物等。それ以外も準耐火建築物等が必要。コストへの影響大");
  } else if (reinfoOk) {
    add("fire", "防火指定", "指定なし（データ上）", "check",
      "法22条区域（屋根不燃化・外壁の延焼部分に準防火性能）の指定は市町村で要確認");
  }

  // --- 都市計画道路 ---
  const cpr = firstHit(reinfo, "cityPlanRoad");
  if (cpr) add("cityPlanRoad", "都市計画道路", `${cpr.種類 || "都市計画道路"}（${cpr.距離}）`, "warn",
    "計画線にかかる場合は法53条許可が必要（階数2以下・地階なし・木造等なら許可）。計画幅員と線形を要確認");

  // --- 立地適正化計画 ---
  const loc = (reinfo.find((r) => r.id === "locationPlan")?.hits || []).map((x) => x.区域).filter(Boolean);
  if (loc.length) add("locationPlan", "立地適正化計画", [...new Set(loc)].join("／"), "info",
    loc.some((x) => x.includes("居住誘導")) ? "" : "居住誘導区域外の場合、3戸以上の住宅開発等は事前届出");

  // --- ハザード ---
  for (const hz of hazards) {
    if (hz.status !== "ok") continue;
    const severe = (label) => label.includes("特別") || /^(3\.0|5\.0|10|20)/.test(label);
    if (hz.atPoint) add(`hz_${hz.id}`, hz.name, hz.atPoint, severe(hz.atPoint) ? "danger" : "warn");
    else if (hz.nearby) add(`hz_${hz.id}`, hz.name, `地点外（周辺約20m以内に ${hz.nearby}）`, "check", "敷地の範囲・位置を確認");
  }
  for (const id of ["sediment", "disasterZone", "steepSlopeArea", "landslideArea", "embankment"]) {
    const r = reinfo.find((x) => x.id === id);
    const hit = r?.hits?.[0];
    if (!hit) continue;
    const v = Object.entries(hit).filter(([, val]) => val != null && val !== "").map(([k, val]) => `${k}:${val}`).join(" ");
    const danger = id === "disasterZone" || id === "steepSlopeArea" || String(hit.区域 || "").includes("特別");
    add(`rf_${id}`, r.name, v, danger ? "danger" : "warn",
      id === "disasterZone" ? "条例による建築制限（床高・構造等）あり" : id === "embankment" ? "地盤調査・擁壁の状況を確認" : "");
  }
  const liq = firstHit(reinfo, "liquefaction");
  // 強弱6段階は数値が小さいほど液状化しやすい。表記（しやすい／しにくい）で判定する
  if (liq) add("liquefaction", "液状化の傾向", `${liq.傾向 || ""}（${liq.地形 || ""}）`, /しやすい/.test(liq.傾向 || "") ? "warn" : "info");

  // --- ライフライン ---
  const lp = (reinfo.find((r) => r.id === "landPrice")?.hits || [])[0];
  const lpRef = lp ? `参考：最寄りの地価公示地点（${lp.距離}）は 水道${yesNo(lp.水道) ?? "-"}／ガス${yesNo(lp.ガス) ?? "-"}／下水道${yesNo(lp.下水道) ?? "-"}` : "";
  const water = [manual.waterMain && `前面本管 φ${manual.waterMain}`, manual.waterService && `引込 φ${manual.waterService}`].filter(Boolean).join("、");
  add("water", "上水道", water || "未確認", water ? "info" : "check",
    water ? (Number(manual.waterService) && Number(manual.waterService) < 20 ? "引込φ13の場合、2世帯・散水等で口径増径（負担金）が必要になることが多い" : "") : [`${city || "市町村"}の水道課で給水管・配水管図を照会`, lpRef].filter(Boolean).join("。"));
  const SEWER = { public: "公共下水道", septic: "浄化槽（下水道区域外）", rural: "農業集落排水", none: "なし" };
  add("sewer", "下水道", SEWER[manual.sewer] || "未確認", manual.sewer ? (manual.sewer === "septic" ? "warn" : "info") : "check",
    manual.sewer === "septic" ? "浄化槽の設置スペース・放流先（側溝・水路）と放流同意の要否を確認" : manual.sewer ? "公共桝の有無・位置・深さを確認" : [`${city || "市町村"}の下水道課で下水道台帳（本管・公共桝）を照会`, lpRef].filter(Boolean).join("。"));
  const GAS = { city: "都市ガス（本管あり）", lp: "プロパン（LPガス）", allElectric: "オール電化予定" };
  add("gas", "ガス", GAS[manual.gas] || "未確認", manual.gas ? "info" : "check",
    manual.gas ? (manual.gas === "city" && manual.gasMain ? `本管 ${manual.gasMain}` : "") : ["ガス事業者（愛知・岐阜・三重の多くは東邦ガス、東三河は中部ガス等）に埋設管を照会", lpRef].filter(Boolean).join("。"));

  return { zone, zoneName, bcr, far, fire, findings: F };
}
