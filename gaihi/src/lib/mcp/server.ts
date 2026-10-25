import { SERVER_INSTRUCTIONS, TOOLS } from "./tools";

// MCP（Model Context Protocol）の Streamable HTTP をステートレスに実装する。
// 1回の POST に JSON-RPC を1件受け取り、JSON で返す（SSE は使わない）。

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "gaihi-keisan", title: "外皮計算ツール", version: "1.0.0" };

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

function ok(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}
function fail(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

/** JSON-RPC メッセージ1件を処理する。通知（id なし）のときは null を返す */
export function handleMessage(msg: unknown, ctx: { origin: string }) {
  if (!msg || typeof msg !== "object" || (msg as JsonRpcRequest).jsonrpc !== "2.0" || typeof (msg as JsonRpcRequest).method !== "string") {
    return fail(null, -32600, "Invalid Request");
  }
  const req = msg as JsonRpcRequest;
  const isNotification = req.id === undefined;
  const id = req.id ?? null;

  switch (req.method) {
    case "initialize": {
      const requested = String(req.params?.protocolVersion ?? "");
      return ok(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case "ping":
      return isNotification ? null : ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })),
      });
    case "tools/call": {
      const name = String(req.params?.name ?? "");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${name}`);
      try {
        return ok(id, tool.run(req.params?.arguments ?? {}, ctx));
      } catch (e) {
        return ok(id, { content: [{ type: "text", text: `計算中にエラーが起きました：${e instanceof Error ? e.message : String(e)}` }], isError: true });
      }
    }
    default:
      if (isNotification || req.method.startsWith("notifications/")) return null;
      return fail(id, -32601, `Method not found: ${req.method}`);
  }
}
