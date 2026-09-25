// 国土交通省「不動産情報ライブラリ」API
// https://www.reinfolib.mlit.go.jp/help/apiManual/
// APIキー（環境変数 REINFOLIB_API_KEY）が必要。ブラウザから直接呼べないのでサーバー側で取得する。
import { lonLatToTile, geometryContains, distanceToGeometryM } from "./geo.js";

const BASE = "https://www.reinfolib.mlit.go.jp/ex-api/external";

const SEDIMENT_TYPES = { 1: "急傾斜地の崩壊", 2: "土石流", 3: "地すべり" };
const SEDIMENT_ZONES = { 1: "土砂災害警戒区域", 2: "土砂災害特別警戒区域" };
const FLOOD_RANKS = {
  1: "0.5m未満",
  2: "0.5〜3.0m",
  3: "3.0〜5.0m",
  4: "5.0〜10.0m",
  5: "10.0〜20.0m",
  6: "20m以上",
};

// mode: contains = 地点を含むポリゴン / near = 地点から一定距離内
export const LAYERS = [
  {
    id: "areaDivision", code: "XKT001", name: "都市計画区域・区域区分", mode: "contains",
    pick: (p) => ({ 区域区分: p.area_classification_ja, 市区町村: p.city_name, 告示日: p.decision_date }),
  },
  {
    id: "useZone", code: "XKT002", name: "用途地域", mode: "contains",
    pick: (p) => ({
      用途地域: p.use_area_ja,
      建蔽率: p.u_building_coverage_ratio_ja,
      容積率: p.u_floor_area_ratio_ja,
      市区町村: p.city_name,
      告示日: p.decision_date,
    }),
  },
  {
    id: "fireZone", code: "XKT014", name: "防火・準防火地域", mode: "contains",
    pick: (p) => ({ 地域: p.fire_prevention_ja, 告示日: p.decision_date }),
  },
  {
    id: "districtPlan", code: "XKT023", name: "地区計画", mode: "contains",
    pick: (p) => ({ 計画名: p.plan_name, 区分: p.plan_type_ja, 告示日: p.decision_date, 告示番号: p.notice_number }),
  },
  {
    id: "advancedUse", code: "XKT024", name: "高度利用地区", mode: "contains",
    pick: (p) => ({ 名称: p.advanced_name, 区分: p.advanced_type_ja }),
  },
  {
    id: "locationPlan", code: "XKT003", name: "立地適正化計画", mode: "contains",
    pick: (p) => ({ 区域: p.kubun_name_ja || p.area_classification_ja }),
  },
  {
    id: "cityPlanRoad", code: "XKT030", name: "都市計画道路", mode: "near", nearM: 30,
    pick: (p) => ({ 種類: p.planning_road_ja, 当初決定日: p.first_decision_date, 告示日: p.decision_date }),
  },
  {
    id: "disasterZone", code: "XKT016", name: "災害危険区域", mode: "contains",
    pick: (p) => ({ 区域名: p.A48_005_ja, 指定理由: p.A48_007_name_ja, 詳細: p.A48_008_ja, 根拠条例: p.A48_011, その他: p.A48_014 }),
  },
  {
    id: "sediment", code: "XKT029", name: "土砂災害警戒区域", mode: "near", nearM: 20,
    pick: (p) => ({
      現象: SEDIMENT_TYPES[p.A33_001] || p.A33_001,
      区域: SEDIMENT_ZONES[p.A33_002] || p.A33_002,
      区域名: p.A33_005,
    }),
  },
  {
    id: "steepSlopeArea", code: "XKT022", name: "急傾斜地崩壊危険区域", mode: "contains",
    pick: (p) => ({ 区域名: p.region_name, 所在地: p.address }),
  },
  {
    id: "landslideArea", code: "XKT021", name: "地すべり防止地区", mode: "contains",
    pick: (p) => ({ 区域名: p.region_name, 所在地: p.address }),
  },
  {
    id: "embankment", code: "XKT020", name: "大規模盛土造成地", mode: "contains",
    pick: (p) => ({ 盛土区分: p.embankment_classification, 盛土番号: p.embankment_number }),
  },
  {
    id: "liquefaction", code: "XKT025", name: "液状化の発生傾向（地形区分）", mode: "contains",
    pick: (p) => ({ 地形: p.topographic_classification_name_ja, 傾向: p.note, 強弱6段階: p.liquefaction_tendency_level }),
  },
  {
    id: "floodVector", code: "XKT026", name: "洪水浸水想定区域（国土数値情報）", mode: "contains",
    pick: (p) => ({ 河川名: p.A31a_202, 浸水深: FLOOD_RANKS[p.A31a_205] || p.A31a_205 }),
  },
  {
    id: "elementarySchool", code: "XKT004", name: "小学校区", mode: "contains",
    pick: (p) => ({ 学校: p.A27_004_ja, 所在地: p.A27_005 }),
  },
  {
    id: "juniorHighSchool", code: "XKT005", name: "中学校区", mode: "contains",
    pick: (p) => ({ 学校: p.A32_004_ja, 所在地: p.A32_005 }),
  },
];

async function fetchTile(apiKey, code, z, x, y, extra = "") {
  const url = `${BASE}/${code}?response_format=geojson&z=${z}&x=${x}&y=${y}${extra}`;
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return { type: "FeatureCollection", features: [] };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim()) return { type: "FeatureCollection", features: [] };
  return JSON.parse(text);
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((it) => {
    const k = JSON.stringify(it);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function queryLayer(apiKey, layer, lon, lat) {
  const base = { id: layer.id, code: layer.code, name: layer.name, source: "不動産情報ライブラリ（国土交通省）" };
  const t = lonLatToTile(lon, lat, 15);
  try {
    const fc = await fetchTile(apiKey, layer.code, 15, t.x, t.y);
    const features = fc.features || [];
    let hits;
    if (layer.mode === "contains") {
      hits = features.filter((f) => geometryContains(f.geometry, lon, lat)).map((f) => layer.pick(f.properties || {}));
    } else {
      hits = features
        .map((f) => ({ f, d: distanceToGeometryM(f.geometry, lon, lat) }))
        .filter(({ d }) => d <= layer.nearM)
        .sort((a, b) => a.d - b.d)
        .map(({ f, d }) => ({ ...layer.pick(f.properties || {}), 距離: d === 0 ? "地点を含む" : `約${Math.round(d)}m` }));
    }
    return { ...base, status: "ok", tileFeatureCount: features.length, hits: dedupe(hits) };
  } catch (e) {
    return { ...base, status: "error", error: e.message };
  }
}

// 地価公示・地価調査のポイント。近くの標準地の「前面道路・上下水・ガス・高度地区」は周辺相場の参考になる
async function queryLandPrices(apiKey, lon, lat) {
  const base = { id: "landPrice", code: "XPT002", name: "近隣の地価公示・地価調査地点", source: "不動産情報ライブラリ（国土交通省）" };
  const z = 13;
  const t = lonLatToTile(lon, lat, z);
  // 地点がタイルの端に近い場合に備え、近い側の隣接タイルも含めた 2×2 を取得
  const dx = t.px < 128 ? -1 : 1;
  const dy = t.py < 128 ? -1 : 1;
  const tiles = [[t.x, t.y], [t.x + dx, t.y], [t.x, t.y + dy], [t.x + dx, t.y + dy]];
  const thisYear = new Date().getFullYear();
  for (const year of [thisYear, thisYear - 1, thisYear - 2]) {
    try {
      const results = await Promise.all(tiles.map(([x, y]) => fetchTile(apiKey, "XPT002", z, x, y, `&year=${year}`)));
      const features = results.flatMap((fc) => fc.features || []);
      if (!features.length) continue;
      const points = features
        .map((f) => ({ p: f.properties || {}, d: distanceToGeometryM(f.geometry, lon, lat) }))
        .sort((a, b) => a.d - b.d)
        // 同じ地点が地価公示（1月）と地価調査（7月）の両方に載ることがあるので、所在で重複を除く
        .filter(({ p }, i, arr) => arr.findIndex((x) => (x.p.location || x.p.point_id) === (p.location || p.point_id)) === i)
        .slice(0, 3)
        .map(({ p, d }) => ({
          距離: `約${Math.round(d)}m`,
          所在: p.location || p.location_number_ja,
          用途: p.use_category_name_ja,
          価格: p.u_current_years_price_ja,
          対前年: p.year_on_year_change_rate != null ? `${p.year_on_year_change_rate}%` : undefined,
          前面道路: p.front_road_condition,
          水道: p.water_supply_availability,
          ガス: p.gas_supply_availability,
          下水道: p.sewer_supply_availability,
          用途地域: p.regulations_use_category_name_ja,
          高度地区: p.regulations_altitude_district_name_ja || undefined,
          防火: p.regulations_fireproof_name_ja || undefined,
          建蔽率: p.u_regulations_building_coverage_ratio_ja,
          容積率: p.u_regulations_floor_area_ratio_ja,
          周辺: p.current_usage_status_of_surrounding_land_name_ja,
          時点: p.target_year_name_ja,
        }));
      return { ...base, status: "ok", year, hits: points };
    } catch (e) {
      return { ...base, status: "error", error: e.message };
    }
  }
  return { ...base, status: "ok", hits: [] };
}

export async function queryReinfolib(apiKey, lon, lat) {
  if (!apiKey) {
    return [...LAYERS, { id: "landPrice", code: "XPT002", name: "近隣の地価公示・地価調査地点" }].map((l) => ({
      id: l.id, code: l.code, name: l.name, status: "nokey",
    }));
  }
  return Promise.all([...LAYERS.map((l) => queryLayer(apiKey, l, lon, lat)), queryLandPrices(apiKey, lon, lat)]);
}
