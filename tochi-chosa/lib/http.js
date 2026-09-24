// Vercel の Node 関数とローカルの server.js の両方で動く小さなヘルパー

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

// APP_PASSCODE を設定した場合のみ、合言葉ヘッダーを要求する（APIキーの無断利用防止）
export function authorized(req, res) {
  const code = process.env.APP_PASSCODE;
  if (!code) return true;
  if (req.headers["x-app-passcode"] === code) return true;
  sendJson(res, 401, { error: "合言葉が違います" });
  return false;
}
