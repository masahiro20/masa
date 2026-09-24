import { geocode } from "../lib/gsi.js";
import { authorized, sendJson } from "../lib/http.js";

export default async function handler(req, res) {
  if (!authorized(req, res)) return;
  const q = new URL(req.url, "http://x").searchParams.get("q")?.trim();
  if (!q) return sendJson(res, 400, { error: "住所を入力してください" });
  try {
    sendJson(res, 200, { candidates: await geocode(q) });
  } catch (e) {
    sendJson(res, 502, { error: e.message });
  }
}
