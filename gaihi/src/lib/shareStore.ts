import { get, put } from "@vercel/blob";

// 短い共有リンク用の預け先（Vercel Blob の非公開ストア）。物件データを shares/<ID>.json に置き、
// /s/<ID> を開いた人のブラウザが /api/share/<ID> から取り出して複製を作る。

export const SHARE_ID = /^[0-9A-Za-z]{10}$/;
/** 1物件のデータとしては十分に大きい上限（図面は含まない） */
export const MAX_SHARE_BYTES = 1_000_000;

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** 推測されにくい 10 文字の ID（約 59 ビット） */
export function newShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => ALPHABET[b % 62]).join("");
}

export function shareStoreEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function saveShare(json: string): Promise<string> {
  const id = newShareId();
  await put(`shares/${id}.json`, json, { access: "private", addRandomSuffix: false, contentType: "application/json" });
  return id;
}

export async function loadShare(id: string): Promise<string | null> {
  const r = await get(`shares/${id}.json`, { access: "private" });
  if (!r || r.statusCode !== 200) return null;
  return new Response(r.stream).text();
}
