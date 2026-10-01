import { runSurvey } from "../lib/survey.js";
import { templateAvailable } from "../lib/kakuninsho.js";
import { authorized, readJson, sendJson } from "../lib/http.js";

// 地点の調査データを一括取得する。判定（rules）はブラウザ側で手入力と合わせて行う
export default async function handler(req, res) {
  if (!authorized(req, res)) return;
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  const body = await readJson(req);
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return sendJson(res, 400, { error: "座標が不正です" });
  const survey = await runSurvey({ lat, lon, address: body.address });
  sendJson(res, 200, { ...survey, hasTemplate: await templateAvailable() });
}
