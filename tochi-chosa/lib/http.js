// Vercel の Node 関数とローカルの server.js の両方で動く小さなヘルパー

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 512 * 1024) throw Object.assign(new Error("リクエストが大きすぎます"), { status: 413 });
    chunks.push(c);
  }
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

// 公開時の使いすぎ防止：IPごとの1時間あたりの回数制限（環境変数で上限を指定したときだけ有効）
// サーバーのメモリ上で数えるだけの簡易版。複数インスタンスでは各インスタンスごとの上限になる
const hits = new Map();
export function rateLimited(req, res, name, envVar) {
  const max = Number(process.env[envVar]);
  if (!max) return false;
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  const key = `${name}:${ip}`;
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < 3600_000);
  if (list.length >= max) {
    sendJson(res, 429, { error: "短時間に多く利用されたため、一時的に制限しています。しばらくしてからお試しください。" });
    return true;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 3600_000)) hits.delete(k);
  return false;
}
