import { deflateRawSync } from "node:zlib";
import type { Project } from "../gaihi/types";

/**
 * 物件データを「ツールで開くリンク」にする。データは URL の # 以降に入れるので、サーバーには送られない。
 * 開くと /import ページがブラウザ内で展開して物件一覧に保存する。
 */
export function importUrl(origin: string, project: Project): string {
  const packed = deflateRawSync(Buffer.from(JSON.stringify(project), "utf8")).toString("base64url");
  return `${origin}/import#p=${packed}`;
}
