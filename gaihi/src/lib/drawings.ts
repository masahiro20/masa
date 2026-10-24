"use client";

import type { PDFPageProxy } from "pdfjs-dist";

// ブラウザ側での図面の下ごしらえ：PDF をページに分け、図面の種類を推定し、
// 外皮計算に使うページだけを1つの PDF にまとめて送る（製本図面一式でも送信サイズを抑えられる）。

export type PageType = "plan" | "elevation" | "section" | "spec" | "site" | "fittings" | "cover" | "other";

export const PAGE_TYPE_LABEL: Record<PageType, string> = {
  plan: "平面図",
  elevation: "立面図",
  section: "断面・矩計図",
  spec: "仕様書・仕上表",
  site: "配置図",
  fittings: "建具表",
  cover: "表紙",
  other: "その他",
};

/** 外皮計算に使う図面の種類 */
const USEFUL: PageType[] = ["plan", "elevation", "section", "spec", "site", "fittings"];

export interface DrawingPage {
  key: string;
  fileIndex: number;
  fileName: string;
  /** PDF のページ番号（1始まり）。画像ファイルなら 0 */
  pageNumber: number;
  type: PageType;
  selected: boolean;
  thumbnail: string;
}

export interface DrawingFile {
  name: string;
  mediaType: "application/pdf" | "image/jpeg" | "image/png";
  bytes: Uint8Array;
}

/** 送信できる上限（base64 後）。Vercel の関数は 4.5MB までのリクエストしか受けない */
export const MAX_PAYLOAD_BYTES = 4_200_000;

export function classifyPage(text: string): PageType {
  const t = text.replace(/\s+/g, "");
  const has = (re: RegExp) => re.test(t);
  // 製本の表紙は図面名が全部並ぶので先に判定する
  const kinds = [/平面/, /立面図/, /断面図|矩計/, /仕様書|仕上表/, /配置図/, /建具/].filter((re) => re.test(t)).length;
  if (has(/表紙/) && kinds >= 3) return "cover";
  if (has(/プレゼン|照明器具|電気図面|電灯|コンセント/)) return "other";
  if (has(/立面図/)) return "elevation";
  if (has(/矩計|断面図/)) return "section";
  if (has(/平面詳細図|平面図/)) return "plan";
  if (has(/建具表|建具仕様/)) return "fittings";
  if (has(/配置図/)) return "site";
  if (has(/仕様書|仕上表|断熱/)) return "spec";
  return "other";
}

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs;
}

async function renderPage(
  page: PDFPageProxy,
  longEdge: number,
  type: "image/jpeg" | "image/png",
  quality = 0.85,
): Promise<string> {
  const vp1 = page.getViewport({ scale: 1 });
  const scale = longEdge / Math.max(vp1.width, vp1.height);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  return canvas.toDataURL(type, quality);
}

/** ファイルをページ一覧にする（種類の推定とサムネイル付き） */
export async function inspectFiles(files: DrawingFile[]): Promise<DrawingPage[]> {
  const pages: DrawingPage[] = [];
  for (const [fileIndex, f] of files.entries()) {
    if (f.mediaType !== "application/pdf") {
      const url = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mediaType }));
      pages.push({ key: `${fileIndex}-0`, fileIndex, fileName: f.name, pageNumber: 0, type: "plan", selected: true, thumbnail: url });
      continue;
    }
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({ data: f.bytes.slice() });
    const doc = await task.promise;
    let anyText = false;
    const filePages: DrawingPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      const text = tc.items.map((it) => ("str" in it ? it.str : "")).join(" ");
      if (text.trim()) anyText = true;
      const type = classifyPage(text);
      filePages.push({
        key: `${fileIndex}-${n}`,
        fileIndex,
        fileName: f.name,
        pageNumber: n,
        type,
        selected: USEFUL.includes(type),
        thumbnail: await renderPage(page, 360, "image/jpeg", 0.7),
      });
    }
    // 文字情報のない（スキャンした）PDF は種類が分からないので全ページ選択にする
    if (!anyText) for (const p of filePages) p.selected = true;
    pages.push(...filePages);
    await task.destroy();
  }
  return pages;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export interface Payload {
  name: string;
  mediaType: "application/pdf" | "image/jpeg" | "image/png";
  data: string;
}

/**
 * 選択したページを送信用データにする。
 * まず PDF のまま（図面の文字情報を残して）切り出し、大きすぎるときだけ画像に変換する。
 */
export async function buildPayload(files: DrawingFile[], pages: DrawingPage[]): Promise<Payload[]> {
  const selected = pages.filter((p) => p.selected);
  const asPdf: Payload[] = [];
  const { PDFDocument } = await import("pdf-lib");
  for (const [fileIndex, f] of files.entries()) {
    const mine = selected.filter((p) => p.fileIndex === fileIndex);
    if (mine.length === 0) continue;
    if (f.mediaType !== "application/pdf") {
      asPdf.push({ name: f.name, mediaType: f.mediaType, data: toBase64(f.bytes) });
      continue;
    }
    const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
    const out = await PDFDocument.create();
    const copied = await out.copyPages(
      src,
      mine.map((p) => p.pageNumber - 1),
    );
    copied.forEach((pg) => out.addPage(pg));
    const bytes = await out.save();
    const label = mine.map((p) => `p${p.pageNumber}`).join(",");
    asPdf.push({ name: `${f.name}（${label}）`, mediaType: "application/pdf", data: toBase64(bytes) });
  }
  if (payloadSize(asPdf) <= MAX_PAYLOAD_BYTES) return asPdf;

  // 画像化して縮める（文字情報は失われるが、画像として読める解像度は保つ）
  const pdfjs = await loadPdfjs();
  const images: Payload[] = [];
  for (const [fileIndex, f] of files.entries()) {
    const mine = selected.filter((p) => p.fileIndex === fileIndex);
    if (mine.length === 0) continue;
    if (f.mediaType !== "application/pdf") {
      images.push({ name: f.name, mediaType: f.mediaType, data: toBase64(f.bytes) });
      continue;
    }
    const task = pdfjs.getDocument({ data: f.bytes.slice() });
    const doc = await task.promise;
    for (const p of mine) {
      const page = await doc.getPage(p.pageNumber);
      const dataUrl = await renderPage(page, 2400, "image/jpeg", 0.8);
      images.push({ name: `${f.name} p${p.pageNumber}`, mediaType: "image/jpeg", data: dataUrl.split(",")[1] });
    }
    await task.destroy();
  }
  return images;
}

export function payloadSize(payload: Payload[]): number {
  return payload.reduce((a, p) => a + p.data.length + p.name.length + 64, 0);
}
