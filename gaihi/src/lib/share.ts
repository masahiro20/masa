import type { Project } from "./gaihi/types";

// 物件の「共有リンク」。ふだんはサーバーに預けて短いリンク（/s/<ID>）にし、預けられないときは
// 物件データを圧縮して URL の # 以降に入れた長いリンクにする（形式は MCP のリンク lib/mcp/link.ts と同じ）。
// どちらも開いた人のブラウザに複製として取り込まれる（元の物件とはつながらない）。

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

/**
 * 共有リンクを作る。サーバーに預けられれば短いリンク（/s/<ID>）、預け先がない・失敗したときは
 * データを丸ごと入れた長いリンクにする。
 */
export async function createShareLink(origin: string, project: Project): Promise<{ url: string; short: boolean }> {
  try {
    const res = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(project) });
    if (res.ok) {
      const { id } = (await res.json()) as { id: string };
      return { url: `${origin}/s/${id}`, short: true };
    }
  } catch {
    // 通信できないときも長いリンクなら渡せる
  }
  return { url: await shareUrl(origin, project), short: false };
}
