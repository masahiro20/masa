#!/usr/bin/env node
// Google ドライブ（共有ドライブ含む）へファイルをアップロードする。
// 認証はサービスアカウント。鍵は環境変数で渡す（リポジトリには置かない）:
//   GDRIVE_SA_JSON  … サービスアカウント鍵のJSON（そのまま、またはbase64）
//   GDRIVE_SA_FILE  … 鍵ファイルのパス（GDRIVE_SA_JSON がない場合）
// 使い方:
//   node scripts/drive-upload.js --folder <フォルダID> [--replace] [--dry-run] ファイル...
//   --replace … 同じフォルダにある同名ファイルをゴミ箱へ移してから入れる
//   --check   … 認証とフォルダへのアクセスだけ確認する
import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { createSign } from "node:crypto";

const MIME = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".json": "application/json", ".txt": "text/plain", ".zip": "application/zip",
};
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

function parseArgs(argv) {
  const o = { files: [], replace: false, dryRun: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--folder") o.folder = argv[++i];
    else if (a === "--replace") o.replace = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--check") o.check = true;
    else o.files.push(a);
  }
  return o;
}

function loadKey() {
  let raw = process.env.GDRIVE_SA_JSON;
  if (!raw && process.env.GDRIVE_SA_FILE) raw = readFileSync(process.env.GDRIVE_SA_FILE, "utf8");
  if (!raw) throw new Error("GDRIVE_SA_JSON（または GDRIVE_SA_FILE）が設定されていません");
  raw = raw.trim();
  if (!raw.startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8");
  const key = JSON.parse(raw);
  if (!key.client_email || !key.private_key) throw new Error("サービスアカウント鍵の形式が違います");
  return key;
}

const b64url = (b) => Buffer.from(b).toString("base64url");

async function getToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: key.client_email, scope: "https://www.googleapis.com/auth/drive",
    aud: key.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const sig = createSign("RSA-SHA256").update(`${head}.${claim}`).sign(key.private_key, "base64url");
  const r = await fetch(key.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`トークン取得に失敗: ${r.status} ${JSON.stringify(j)}`);
  return j.access_token;
}

async function api(token, path, init = {}) {
  const r = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${init.method || "GET"} ${path.split("?")[0]} → ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
}

async function findSameName(token, folder, name) {
  const q = `'${folder}' in parents and name = '${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and trashed = false`;
  const u = `${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  return (await api(token, u)).files || [];
}

async function upload(token, folder, file) {
  const name = basename(file);
  const mime = MIME[extname(file).toLowerCase()] || "application/octet-stream";
  const size = statSync(file).size;
  // 再開可能アップロード（5MBを超えるPDFにも対応）
  const init = await fetch(`${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,md5Checksum`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(size) },
    body: JSON.stringify({ name, parents: [folder] }),
  });
  if (!init.ok) throw new Error(`アップロード開始に失敗: ${init.status} ${(await init.text()).slice(0, 300)}`);
  const loc = init.headers.get("location");
  const r = await fetch(loc, { method: "PUT", headers: { "Content-Type": mime, "Content-Length": String(size) }, body: readFileSync(file) });
  const t = await r.text();
  if (!r.ok) throw new Error(`アップロードに失敗: ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

const o = parseArgs(process.argv.slice(2));
if (!o.folder) { console.error("--folder <フォルダID> を指定してください"); process.exit(2); }
try {
  const key = loadKey();
  const token = await getToken(key);
  const folder = await api(token, `${API}/files/${o.folder}?fields=id,name,driveId&supportsAllDrives=true`);
  console.log(`接続OK: ${key.client_email} → フォルダ「${folder.name}」`);
  if (o.check) process.exit(0);
  for (const f of o.files) {
    const same = await findSameName(token, o.folder, basename(f));
    if (o.dryRun) { console.log(`[dry-run] ${basename(f)}${same.length ? `（同名 ${same.length}件あり）` : ""}`); continue; }
    if (same.length && o.replace) {
      for (const s of same) await api(token, `${API}/files/${s.id}?supportsAllDrives=true`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
    }
    const res = await upload(token, o.folder, f);
    console.log(`アップロード: ${res.name}（${res.size} bytes, md5 ${res.md5Checksum}）${same.length && o.replace ? " ※旧ファイルはゴミ箱へ" : ""}`);
  }
} catch (e) {
  console.error(String(e.message || e));
  process.exit(1);
}
