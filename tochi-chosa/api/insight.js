import { streamInsight } from "../lib/ai.js";
import { authorized, readJson, sendJson } from "../lib/http.js";

// AI 所見を Server-Sent Events で逐次返す
export default async function handler(req, res) {
  if (!authorized(req, res)) return;
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) {
    return sendJson(res, 503, { error: "ANTHROPIC_API_KEY が未設定のため、AI見解は利用できません" });
  }
  const report = await readJson(req);

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    await streamInsight(report, (text) => send("text", text));
    send("done", {});
  } catch (e) {
    send("error", { message: e.message || String(e) });
  }
  res.end();
}
