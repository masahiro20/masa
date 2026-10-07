import { runSurvey } from "../lib/survey.js";
import { authorized, rateLimited, readJson, sendJson } from "../lib/http.js";

// 地点の調査データを一括取得する。判定（rules）はブラウザ側で手入力と合わせて行う
export default async function handler(req, res) {
  if (!authorized(req, res)) return;
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  if (rateLimited(req, res, "survey", "RATE_LIMIT_SURVEY")) return;
  const body = await readJson(req);
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return sendJson(res, 400, { error: "座標が不正です" });
  const survey = await runSurvey({ lat, lon, address: body.address });
  // 確認書（社内用）は公開サイトに含めないので、ある場合だけ読み込む
  const hasTemplate = await import("../lib/kakuninsho.js").then((m) => m.templateAvailable()).catch(() => false);
  sendJson(res, 200, { ...survey, hasTemplate });
}
