// MCP поверх HTTP без сессий (Streamable HTTP, ответ — один JSON): initialize, ping,
// tools/list, tools/call. Своя реализация вместо SDK: методов четыре, а SDK тянет Express
// и свой транспорт под Node, которого в route handler Next нет. Инструменты приходят снаружи —
// протокол не знает ни базы, ни дашборда (самопроверка — protocol.test.ts).

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

export interface ToolDef<C> {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; title?: string };
  run: (ctx: C, args: Record<string, unknown>) => Promise<unknown>;
}

export interface ServerInfo { name: string; title: string; version: string; instructions: string }

type Id = string | number;
export type RpcResponse = { jsonrpc: "2.0"; id: Id | null; result?: unknown; error?: { code: number; message: string } };

const ok = (id: Id, result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });
const fail = (id: Id | null, code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

// Ошибка инструмента — не ошибка протокола: модель видит текст и может поправить запрос.
export class ToolError extends Error {}

// null — ответа нет (уведомление или ответ клиента): HTTP 202 без тела.
export async function handleRpc<C>(
  msg: unknown, ctx: C, tools: ToolDef<C>[], info: ServerInfo,
  onCall?: (tool: string, args: unknown, ok: boolean, error: string | null, ms: number) => void,
): Promise<RpcResponse | null> {
  if (Array.isArray(msg)) return fail(null, -32600, "Пачки JSON-RPC не поддерживаются");
  const m = msg as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown } | null;
  if (!m || typeof m !== "object" || m.jsonrpc !== "2.0") return fail(null, -32600, "Нужен JSON-RPC 2.0");
  const id = typeof m.id === "string" || typeof m.id === "number" ? m.id : null;
  if (typeof m.method !== "string") return id === null ? null : fail(id, -32600, "Нет method");
  if (id === null) return null;   // уведомления (notifications/initialized и т. п.) ответа не ждут
  const params = (m.params && typeof m.params === "object" ? m.params : {}) as Record<string, unknown>;

  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: info.name, title: info.title, version: info.version },
        instructions: info.instructions,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: tools.map(({ run: _run, ...t }) => t) });
    case "tools/call": {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return fail(id, -32602, `Нет инструмента ${String(params.name)}`);
      const args = (params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments : {}) as Record<string, unknown>;
      const started = Date.now();
      try {
        const result = await tool.run(ctx, args);
        onCall?.(tool.name, args, true, null, Date.now() - started);
        return ok(id, { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }] });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        onCall?.(tool.name, args, false, message, Date.now() - started);
        // Наши ToolError — понятный текст для модели; прочее — тоже текстом, но без стека.
        return ok(id, { content: [{ type: "text", text: e instanceof ToolError ? message : `Ошибка: ${message}` }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Метод ${m.method} не поддерживается`);
  }
}
