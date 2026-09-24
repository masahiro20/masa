// 国土地理院：住所検索・逆ジオコーディング（APIキー不要）

export async function geocode(q) {
  const res = await fetch(
    `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error(`住所検索に失敗しました（HTTP ${res.status}）`);
  const list = await res.json();
  return list.slice(0, 10).map((f) => ({
    title: f.properties.title,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
}

let muniTable = null;
async function loadMuni() {
  if (muniTable) return muniTable;
  const res = await fetch("https://maps.gsi.go.jp/js/muni.js", { signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  const table = {};
  for (const m of text.matchAll(/MUNI_ARRAY\["(\d+)"\]\s*=\s*'([^']*)'/g)) {
    const [, pref, , name] = m[2].split(",");
    table[m[1]] = { pref, city: name.replace(/\s|　/g, "") };
  }
  muniTable = table;
  return table;
}

export async function reverseGeocode(lon, lat) {
  try {
    const res = await fetch(
      `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`,
      { signal: AbortSignal.timeout(10000) }
    );
    const j = await res.json();
    const code = j?.results?.muniCd;
    if (!code) return null;
    const muni = (await loadMuni().catch(() => ({})))[String(Number(code))] || {};
    return { pref: muni.pref || "", city: muni.city || "", town: j.results.lv01Nm || "", muniCd: code };
  } catch {
    return null;
  }
}
