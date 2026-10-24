import { NextResponse } from "next/server";
import { SERVER_INFO, handleMessage } from "@/lib/mcp/server";

// Claude（claude.ai のコネクタ・Claude Code など）から使う MCP の窓口。
// 追加先 URL：https://<このアプリのドメイン>/api/mcp
export const runtime = "nodejs";

function originOf(req: Request) {
  const env = process.env.GAIHI_PUBLIC_URL;
  if (env) return env.replace(/\/$/, "");
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const ctx = { origin: originOf(req) };
  if (Array.isArray(body)) {
    const out = body.map((m) => handleMessage(m, ctx)).filter((x) => x !== null);
    return out.length ? NextResponse.json(out) : new Response(null, { status: 202 });
  }
  const res = handleMessage(body, ctx);
  return res === null ? new Response(null, { status: 202 }) : NextResponse.json(res);
}

/** ステートレスなのでサーバーからの通知ストリームは提供しない */
export async function GET() {
  return NextResponse.json(
    { ...SERVER_INFO, message: "MCP endpoint. Send JSON-RPC requests with POST." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
