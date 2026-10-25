"use client";

import type { DrawingFile } from "./drawings";

// Google ドライブから図面を選んで読み込む（Google Picker）。
// 使うには Google Cloud で OAuth クライアントと API キーを作り、次の環境変数を設定する（README 参照）：
//   NEXT_PUBLIC_GOOGLE_CLIENT_ID / NEXT_PUBLIC_GOOGLE_API_KEY / NEXT_PUBLIC_GOOGLE_APP_ID
// 権限は drive.file（ユーザーがピッカーで選んだファイルだけ読める）。

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? "";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const MIME_TYPES = "application/pdf,image/jpeg,image/png";

export const driveEnabled = Boolean(CLIENT_ID && API_KEY);

/* eslint-disable @typescript-eslint/no-explicit-any */
type GoogleGlobal = any;
declare global {
  interface Window {
    google?: GoogleGlobal;
    gapi?: GoogleGlobal;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`${src} を読み込めませんでした`));
    document.head.appendChild(s);
  });
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  await loadScript("https://accounts.google.com/gsi/client");
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (res: { access_token?: string; expires_in?: number; error?: string }) => {
        if (!res.access_token) return reject(new Error(res.error ?? "Google にログインできませんでした"));
        cachedToken = { token: res.access_token, expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000 };
        resolve(res.access_token);
      },
    });
    client.requestAccessToken({ prompt: cachedToken ? "" : "consent" });
  });
}

async function pickFiles(token: string): Promise<{ id: string; name: string; mimeType: string }[]> {
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise<void>((resolve) => window.gapi.load("picker", () => resolve()));
  const picker = window.google.picker;
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setMimeTypes(MIME_TYPES);
    const builder = new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setTitle("設計図書（平面図・立面図・仕様書など）を選んでください")
      .setCallback((data: any) => {
        if (data.action === picker.Action.PICKED) {
          resolve(data.docs.map((d: any) => ({ id: d.id, name: d.name, mimeType: d.mimeType })));
        } else if (data.action === picker.Action.CANCEL) {
          resolve([]);
        }
      });
    if (APP_ID) builder.setAppId(APP_ID);
    builder.build().setVisible(true);
  });
}

/** ピッカーで選んだドライブのファイルをダウンロードする */
export async function pickDriveDrawings(): Promise<DrawingFile[]> {
  const token = await getToken();
  const picked = await pickFiles(token);
  const files: DrawingFile[] = [];
  for (const f of picked) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`「${f.name}」をダウンロードできませんでした（${res.status}）`);
    const mediaType = f.mimeType === "image/png" ? "image/png" : f.mimeType === "image/jpeg" ? "image/jpeg" : "application/pdf";
    files.push({ name: f.name, mediaType, bytes: new Uint8Array(await res.arrayBuffer()) });
  }
  return files;
}
