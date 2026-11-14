import { createHash, randomBytes } from "node:crypto";

// OAuth 2.1 для AI-доступа по MCP (Decision 116): чистая часть без базы — токены, PKCE,
// адреса возврата, метаданные. Требования Claude: https://claude.com/docs/connectors/building/authentication
// (PKCE S256, публичный клиент, CIMD или DCR, refresh вращается, 401 со ссылкой на метаданные).

export const SCOPE = "read";                 // этап 1: только чтение; управление — отдельный scope потом
export const CODE_TTL_S = 5 * 60;
export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_S = 30 * 24 * 3600;
export const PERSONAL_CLIENT = "personal";   // ключ для терминала, без OAuth

export const newToken = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

// PKCE S256: base64url(sha256(verifier)) === challenge. plain не принимаем.
export function pkceOk(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Адрес возврата, который вообще можно зарегистрировать: https или http на свою машину
// (Claude Code и Codex ловят код на localhost). Остальные схемы — нет.
export function redirectUsable(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    return u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.has(u.hostname));
  } catch {
    return false;
  }
}

// Совпадает ли адрес из запроса с зарегистрированным. Loopback — без учёта порта (RFC 8252 §7.3):
// Claude Code объявляет http://localhost/callback, а приходит с http://localhost:3118/callback.
export function redirectMatches(registered: string[], uri: string): boolean {
  if (!redirectUsable(uri)) return false;
  const u = new URL(uri);
  return registered.some((r) => {
    if (r === uri) return true;
    if (u.protocol !== "http:" || !LOOPBACK.has(u.hostname)) return false;
    try {
      const x = new URL(r);
      return x.protocol === "http:" && x.hostname === u.hostname && x.pathname === u.pathname && x.search === u.search;
    } catch {
      return false;
    }
  });
}

// client_id по CIMD — https-адрес документа клиента. Не IP и не локальные имена: сервер сам
// пойдёт по этому адресу, и ходить им во внутреннюю сеть незачем.
export function isCimdClientId(id: string): boolean {
  try {
    const u = new URL(id);
    return u.protocol === "https:" && u.pathname !== "/" && u.hostname.includes(".") &&
      !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) && !u.hostname.startsWith("[");
  } catch {
    return false;
  }
}

export const mcpUrl = (origin: string) => `${origin}/api/mcp`;
export const resourceMetadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource`;

// RFC 9728: resource — ровно тот адрес, что человек вставляет в Claude.
export const protectedResource = (origin: string) => ({
  resource: mcpUrl(origin),
  authorization_servers: [origin],
  scopes_supported: [SCOPE],
  bearer_methods_supported: ["header"],
  resource_name: "Genesis Dashboard",
});

// RFC 8414. CIMD выбирается Claude, только если есть и client_id_metadata_document_supported,
// и "none" среди способов входа на token endpoint; иначе — DCR.
export const authorizationServer = (origin: string) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/api/oauth/token`,
  registration_endpoint: `${origin}/api/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: [SCOPE],
  client_id_metadata_document_supported: true,
});

// 401 без токена — Claude по нему начинает вход; без resource_metadata не найдёт сервер авторизации.
export const unauthorizedHeader = (origin: string, error?: string) =>
  `Bearer resource_metadata="${resourceMetadataUrl(origin)}"${error ? `, error="${error}"` : ""}, scope="${SCOPE}"`;

// Браузерные клиенты (MCP Inspector) ходят с другого origin. Куки здесь не участвуют —
// только Bearer, поэтому открытый CORS ничего не отдаёт без токена.
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};
