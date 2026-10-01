// 地点の調査データを一括取得する（API・コマンドライン共通）
import { reverseGeocode } from "./gsi.js";
import { queryReinfolib } from "./reinfolib.js";
import { checkHazards, getElevation } from "./hazard.js";
import { buildLinks } from "./links.js";
import { splitAddress } from "./geo.js";

export async function runSurvey({ lat, lon, address = "" }) {
  const [rev, reinfo, hazards, elevation] = await Promise.all([
    reverseGeocode(lon, lat),
    queryReinfolib(process.env.REINFOLIB_API_KEY, lon, lat),
    checkHazards(lon, lat),
    getElevation(lon, lat),
  ]);
  const fromText = splitAddress(address);
  const pref = rev?.pref || fromText.pref;
  const city = rev?.city || fromText.city;
  return {
    address: address || `${pref}${city}${rev?.town || ""}`,
    lat, lon, pref, city,
    elevation,
    reinfo,
    hazards,
    links: buildLinks({ lat, lon, pref, city }),
    hasReinfoKey: Boolean(process.env.REINFOLIB_API_KEY),
    fetchedAt: new Date().toISOString(),
  };
}
