import type { Project } from "./gaihi/types";

// 物件の「共有リンク」。物件データを圧縮して URL の # 以降に入れるので、サーバーには送られず、どこにも保存されない。
// 開いた人のブラウザに複製として取り込まれる（元の物件とはつながらない）。形式は MCP のリンク（lib/mcp/link.ts）と同じ。

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

export async function packProject(project: Project): Promise<string> {
  const stream = new Blob([JSON.stringify(project)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

export async function unpackProject(packed: string): Promise<Project> {
  const stream = new Blob([fromBase64Url(packed)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(await new Response(stream).text()) as Project;
}

export async function shareUrl(origin: string, project: Project): Promise<string> {
  return `${origin}/import#p=${await packProject(project)}`;
}
