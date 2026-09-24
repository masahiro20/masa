// ローカル／自前サーバー用。Vercel では api/ と public/ がそのまま使われるので不要
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import geocode from "./api/geocode.js";
import survey from "./api/survey.js";
import insight from "./api/insight.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const routes = { "/api/geocode": geocode, "/api/survey": survey, "/api/insight": insight };
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const handler = routes[pathname];
  try {
    if (handler) return await handler(req, res);
    const file = path.join(root, pathname === "/" ? "index.html" : pathname);
    if (!file.startsWith(root)) throw Object.assign(new Error(), { code: "ENOENT" });
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "EISDIR") {
      res.writeHead(404).end("Not found");
    } else {
      console.error(e);
      if (!res.headersSent) res.writeHead(500);
      res.end("Server error");
    }
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`土地調査ツール: http://localhost:${port}`);
  if (!process.env.REINFOLIB_API_KEY) console.log("※ REINFOLIB_API_KEY 未設定：用途地域などの都市計画情報は取得されません");
  if (!process.env.ANTHROPIC_API_KEY) console.log("※ ANTHROPIC_API_KEY 未設定：AI見解は利用できません");
});
