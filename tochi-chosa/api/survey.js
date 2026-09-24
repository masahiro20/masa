import { reverseGeocode } from "../lib/gsi.js";
import { queryReinfolib } from "../lib/reinfolib.js";
import { checkHazards, getElevation } from "../lib/hazard.js";
import { buildLinks } from "../lib/links.js";
import { splitAddress } from "../lib/geo.js";
import { authorized, readJson, sendJson } from "../lib/http.js";

// 地点の調査データを一括取得する。判定（rules）はブラウザ側で手入力と合わせて行う
export default async function handler(req, res) {
  if (!authorized(req, res)) return;
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  const body = await readJson(req);
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return sendJson(res, 400, { error: "座標が不正です" });

  const [rev, reinfo, hazards, elevation] = await Promise.all([
    reverseGeocode(lon, lat),
    queryReinfolib(process.env.REINFOLIB_API_KEY, lon, lat),
    checkHazards(lon, lat),
    getElevation(lon, lat),
  ]);

  const fromText = splitAddress(body.address);
  const pref = rev?.pref || fromText.pref;
  const city = rev?.city || fromText.city;
  const address = body.address || `${pref}${city}${rev?.town || ""}`;

  sendJson(res, 200, {
    address, lat, lon, pref, city,
    elevation,
    reinfo,
    hazards,
    links: buildLinks({ lat, lon, pref, city }),
    hasReinfoKey: Boolean(process.env.REINFOLIB_API_KEY),
    fetchedAt: new Date().toISOString(),
  });
}
