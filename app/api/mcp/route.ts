import { after, NextResponse } from "next/server";
import { authenticate, logCall, touchToken } from "@/lib/mcp/store";
import { handleRpc } from "@/lib/mcp/protocol";
import { SERVER, TOOLS } from "@/lib/mcp/tools";
import { seatOf } from "@/lib/auth/server";
import { juniorAreas, juniorTool } from "@/lib/nav";
import { CORS, unauthorizedHeader } from "@/lib/mcp/oauth";

// AI-доступ по MCP (Decision 116): Claude и Codex баера ходят сюда с токеном OAuth или личным
// ключом. Без сессий: каждый POST — одно сообщение JSON-RPC, ответ — JSON. Мимо middleware:
// вход здесь — Bearer, а не cookie.

export const maxDuration = 300;

// ponytail: лимит в памяти инстанса — инстансов на Vercel несколько, поэтому он примерный;
// точный — по mcp_calls, если кто-то начнёт его обходить.
const RATE_PER_MIN = 60;
const hits = new Map<string, number[]>();
function limited(tokenId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(tokenId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(tokenId, recent);
  return recent.length > RATE_PER_MIN;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...CORS, ...headers } });

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const auth = bearer ? await authenticate(bearer).catch(() => null) : null;
  // 401 со ссылкой на метаданные — по нему Claude и Codex начинают вход в дашборд.
  if (!auth) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: bearer ? "Токен не действует — подключись заново" : "Нужен вход в дашборд" } },
      401, { "WWW-Authenticate": unauthorizedHeader(origin, bearer ? "invalid_token" : undefined) });
  }

  // Джун (060_junior.sql): AI-доступ включают владелец или баер; данные — его баера (seatOf), инструменты —
  // только открытых ему разделов. Задачи и заявки внутри инструментов — его собственные (selfOf).
  let me = auth.me, tools = TOOLS;
  if (auth.me.role === "junior") {
    const seat = auth.me.junior_mcp ? await seatOf(auth.me) : null;
    if (!seat) {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: auth.me.junior_mcp ? "Твой баер отключён — данные закрыты" : "AI-доступ джуну выключен — его включают владелец или твой баер" } }, 403);
    }
    const areas = juniorAreas(auth.me.junior_areas, seat);
    me = seat;
    tools = TOOLS.filter((t) => juniorTool(t.name, areas));
  }

  let msg: unknown;
  try { msg = await req.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Тело запроса — не JSON" } }, 400); }
  if (auth.touch) after(() => touchToken(auth.tokenId));

  const m = msg as { method?: unknown; id?: unknown };
  if (m?.method === "tools/call" && limited(auth.tokenId)) {
    return json({ jsonrpc: "2.0", id: m.id ?? null, result: { content: [{ type: "text", text: `Слишком много запросов: не больше ${RATE_PER_MIN} в минуту. Подожди минуту.` }], isError: true } });
  }

  const res = await handleRpc(msg, { me, tokenId: auth.tokenId }, tools, SERVER, (tool, args, ok, error, ms) =>
    after(() => logCall(auth.me.id, auth.tokenId, tool, args, ok, error, ms).catch(() => {})));
  return res ? json(res) : new NextResponse(null, { status: 202, headers: CORS });
}

// Потока событий от сервера нет: всё — ответами на POST.
export function GET() {
  return new NextResponse(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
