// 座標・タイル計算と点の内外判定

export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const xf = ((lon + 180) / 360) * n;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  // タイル内のピクセル位置（256px タイル）
  return { z, x, y, px: Math.floor((xf - x) * 256), py: Math.floor((yf - y) * 256) };
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(lon, lat, rings) {
  if (!rings.length || !pointInRing(lon, lat, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) {
    if (pointInRing(lon, lat, rings[k])) return false; // 穴
  }
  return true;
}

export function geometryContains(geometry, lon, lat) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return pointInPolygon(lon, lat, geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((poly) => pointInPolygon(lon, lat, poly));
  }
  return false;
}

// 2点間の距離（m）
export function distanceM(lon1, lat1, lon2, lat2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 点から線分までのおおよその距離（m）。狭い範囲なので平面近似で十分
function pointToSegmentM(lon, lat, a, b) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110574;
  const px = lon * kx, py = lat * ky;
  const ax = a[0] * kx, ay = a[1] * ky, bx = b[0] * kx, by = b[1] * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ジオメトリまでの最短距離（m）。内部なら 0
export function distanceToGeometryM(geometry, lon, lat) {
  if (!geometry) return Infinity;
  if (geometryContains(geometry, lon, lat)) return 0;
  const lines = [];
  const t = geometry.type;
  const c = geometry.coordinates;
  if (t === "Point") return distanceM(lon, lat, c[0], c[1]);
  if (t === "LineString") lines.push(c);
  if (t === "MultiLineString" || t === "Polygon") lines.push(...c);
  if (t === "MultiPolygon") c.forEach((p) => lines.push(...p));
  let min = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      min = Math.min(min, pointToSegmentM(lon, lat, line[i - 1], line[i]));
    }
  }
  return min;
}

// 「愛知県名古屋市中区三の丸三丁目」→ { pref, city }
export function splitAddress(address) {
  const s = (address || "").replace(/\s/g, "");
  // 「四日市市」「蒲郡市」「郡上市」は単純な正規表現だと誤分割するので先に拾う
  const m = s.match(
    /^(.+?[都道府県])?(四日市市|蒲郡市|郡上市|名古屋市.+?区|.+?郡.+?[町村]|.+?[市区町村])?/
  );
  return { pref: m?.[1] || "", city: m?.[2] || "" };
}
