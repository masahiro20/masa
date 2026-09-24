// 重ねるハザードマップ（国土地理院）のラスタタイルを地点の色で判定する。
// APIキー不要。タイルが 404 のときは「その範囲にデータなし＝区域外」として扱う。
import { PNG } from "pngjs";
import { lonLatToTile } from "./geo.js";

const BASE = "https://disaportaldata.gsi.go.jp/raster";
const Z = 17; // 1px ≒ 1m
const NEAR_PX = 20; // 周辺チェックの半径（約20m）

// 浸水深の凡例（国土地理院の新凡例）
const DEPTH_LEGEND = [
  { rgb: [255, 255, 179], label: "0.3m未満", rank: 1 },
  { rgb: [247, 245, 169], label: "0.3〜0.5m", rank: 2 },
  { rgb: [248, 225, 166], label: "0.5〜1.0m", rank: 3 },
  { rgb: [255, 216, 192], label: "1.0〜3.0m", rank: 4 },
  { rgb: [255, 183, 183], label: "3.0〜5.0m", rank: 5 },
  { rgb: [255, 145, 145], label: "5.0〜10.0m", rank: 6 },
  { rgb: [242, 133, 201], label: "10.0〜20.0m", rank: 7 },
  { rgb: [220, 122, 220], label: "20m以上", rank: 8 },
];

function nearestDepth([r, g, b]) {
  let best = null;
  let bestD = Infinity;
  for (const item of DEPTH_LEGEND) {
    const d = (item.rgb[0] - r) ** 2 + (item.rgb[1] - g) ** 2 + (item.rgb[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = item;
    }
  }
  return best;
}

// 土砂災害：赤系＝特別警戒区域（レッド）、黄系＝警戒区域（イエロー）
function sedimentClass([r, g]) {
  return r > 180 && g < 120 ? { label: "特別警戒区域（レッドゾーン）", rank: 2 } : { label: "警戒区域（イエローゾーン）", rank: 1 };
}

export const HAZARD_LAYERS = [
  { id: "flood", name: "洪水浸水想定（想定最大規模）", path: "01_flood_l2_shinsuishin_data", kind: "depth" },
  { id: "highTide", name: "高潮浸水想定", path: "03_hightide_l2_shinsuishin_data", kind: "depth" },
  { id: "tsunami", name: "津波浸水想定", path: "04_tsunami_newlegend_data", kind: "depth" },
  { id: "debrisFlow", name: "土砂災害（土石流）", path: "05_dosekiryukeikaikuiki", kind: "sediment" },
  { id: "steepSlope", name: "土砂災害（急傾斜地の崩壊）", path: "05_kyukeishakeikaikuiki", kind: "sediment" },
  { id: "landslide", name: "土砂災害（地すべり）", path: "05_jisuberikeikaikuiki", kind: "sediment" },
];

function classify(layer, rgba) {
  if (!rgba || rgba[3] < 128) return null;
  return layer.kind === "depth" ? nearestDepth(rgba) : sedimentClass(rgba);
}

async function checkLayer(layer, lon, lat) {
  const t = lonLatToTile(lon, lat, Z);
  const url = `${BASE}/${layer.path}/${Z}/${t.x}/${t.y}.png`;
  const base = { id: layer.id, name: layer.name, source: "重ねるハザードマップ（国土地理院）" };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.status === 404) return { ...base, status: "ok", atPoint: null, nearby: null };
    if (!res.ok) return { ...base, status: "error", error: `HTTP ${res.status}` };
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    const px = (x, y) => {
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) return null;
      const i = (y * png.width + x) * 4;
      return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
    };
    const atPoint = classify(layer, px(t.px, t.py));
    // 周辺（タイル内のみ）で最も危険度の高いもの
    let nearby = null;
    for (let dy = -NEAR_PX; dy <= NEAR_PX; dy += 2) {
      for (let dx = -NEAR_PX; dx <= NEAR_PX; dx += 2) {
        if (dx * dx + dy * dy > NEAR_PX * NEAR_PX) continue;
        const c = classify(layer, px(t.px + dx, t.py + dy));
        if (c && (!nearby || c.rank > nearby.rank)) nearby = c;
      }
    }
    return { ...base, status: "ok", atPoint: atPoint?.label || null, nearby: nearby?.label || null };
  } catch (e) {
    return { ...base, status: "error", error: e.message };
  }
}

export async function checkHazards(lon, lat) {
  return Promise.all(HAZARD_LAYERS.map((l) => checkLayer(l, lon, lat)));
}

export async function getElevation(lon, lat) {
  try {
    const res = await fetch(
      `https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${lon}&lat=${lat}&outtype=JSON`,
      { signal: AbortSignal.timeout(8000) }
    );
    const j = await res.json();
    if (j.elevation === "-----") return null;
    return { elevation: Number(j.elevation), source: j.hsrc };
  } catch {
    return null;
  }
}
