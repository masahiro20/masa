import { buildKakuninsho, kakuninshoFileName, templateAvailable, TEMPLATE_PATH } from "../lib/kakuninsho.js";
import { authorized, readJson, sendJson } from "../lib/http.js";

// 法令制限確認書（Excel）を作って返す
export default async function handler(req, res) {
  if (!authorized(req, res)) return;
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  if (!(await templateAvailable())) {
    return sendJson(res, 404, { error: `テンプレートがありません。${TEMPLATE_PATH} に法令制限確認書の Excel を置いてください` });
  }
  const { survey, manual, insight } = await readJson(req);
  if (!survey?.address) return sendJson(res, 400, { error: "先に住所で調査してください" });
  const buf = await buildKakuninsho({ survey, manual, insight });
  const name = kakuninshoFileName(survey);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.end(buf);
}
