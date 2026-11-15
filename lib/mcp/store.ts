import { warehouse } from "@/lib/warehouse/read";
import type { Profile } from "@/lib/auth/types";
import {
  ACCESS_TTL_S, CODE_TTL_S, PERSONAL_CLIENT, REFRESH_TTL_S, SCOPE,
  hashToken, isCimdClientId, newToken, pkceOk, redirectMatches, redirectUsable,
} from "./oauth";

// OAuth и подключения AI-доступа (Decision 116): клиенты, коды, токены, журнал. Пишет ключом
// service role — таблицы mcp_* браузеру закрыты. Токены и коды хранятся только хэшами.

const db = () => warehouse();
const PROFILE_COLS = "id, email, name, role, buyer_code, crm_buyer_id, notion_url, gr_spreadsheet_id, gr4_spreadsheet_id, status, onboarded_at, start_page, legacy_access";
const at = (sec: number) => new Date(Date.now() + sec * 1000).toISOString();

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export interface Client { id: string; name: string; redirectUris: string[] }

// CIMD: client_id — адрес JSON-документа клиента (так входят Claude и Claude Code).
async function cimdClient(id: string): Promise<Client> {
  let doc: { client_id?: unknown; client_name?: unknown; redirect_uris?: unknown };
  try {
    const res = await fetch(id, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5_000) });
    const text = await res.text();
    if (!res.ok || text.length > 20_000) throw new Error(`HTTP ${res.status}`);
    doc = JSON.parse(text);
  } catch (e) {
    throw new OAuthError("invalid_client", `Документ клиента не открылся: ${e instanceof Error ? e.message : e}`);
  }
  if (doc.client_id !== id) throw new OAuthError("invalid_client", "client_id в документе клиента не совпадает с его адресом");
  const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter((u): u is string => typeof u === "string" && redirectUsable(u)) : [];
  if (!uris.length) throw new OAuthError("invalid_client", "В документе клиента нет годного адреса возврата");
  const name = typeof doc.client_name === "string" && doc.client_name.trim() ? doc.client_name.trim().slice(0, 80) : new URL(id).hostname;
  return { id, name, redirectUris: uris };
}

export async function findClient(id: string): Promise<Client> {
  if (!id) throw new OAuthError("invalid_request", "Нет client_id");
  if (isCimdClientId(id)) return cimdClient(id);
  const { data } = await db().from("mcp_oauth_clients").select("client_name, redirect_uris").eq("client_id", id).maybeSingle();
  if (!data) throw new OAuthError("invalid_client", "Клиент не зарегистрирован — удали коннектор и подключи заново");
  return { id, name: (data.client_name as string | null) || "AI-клиент", redirectUris: data.redirect_uris as string[] };
}

// DCR (RFC 7591): клиент регистрирует себя сам. Только публичные клиенты, только безопасные адреса возврата.
export async function registerClient(body: unknown) {
  const b = (body ?? {}) as { client_name?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown };
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
  if (!uris.length || uris.length > 10 || !uris.every((u) => typeof u === "string" && redirectUsable(u))) {
    throw new OAuthError("invalid_redirect_uri", "Адреса возврата — https или http://localhost");
  }
  if (b.token_endpoint_auth_method && b.token_endpoint_auth_method !== "none") {
    throw new OAuthError("invalid_client_metadata", "Поддерживаются только публичные клиенты (token_endpoint_auth_method: none)");
  }
  const clientId = newToken("gncl");
  const name = typeof b.client_name === "string" ? b.client_name.trim().slice(0, 80) : null;
  const { error } = await db().from("mcp_oauth_clients").insert({ client_id: clientId, client_name: name, redirect_uris: uris });
  if (error) throw new Error(error.message);
  return {
    client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name ?? undefined,
    redirect_uris: uris, token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: SCOPE,
  };
}

export interface AuthorizeRequest { client: Client; redirectUri: string; state: string | null; codeChallenge: string }

// Запрос на вход — один разбор и для страницы согласия, и для её кнопки: скрытым полям формы не верим.
export async function checkAuthorize(get: (k: string) => string | null): Promise<AuthorizeRequest> {
  if (get("response_type") !== "code") throw new OAuthError("unsupported_response_type", "Поддерживается только response_type=code");
  const client = await findClient(get("client_id") ?? "");
  const redirectUri = get("redirect_uri") ?? "";
  if (!redirectMatches(client.redirectUris, redirectUri)) throw new OAuthError("invalid_request", "Адрес возврата не совпадает с зарегистрированным");
  const codeChallenge = get("code_challenge") ?? "";
  if (!codeChallenge || get("code_challenge_method") !== "S256") throw new OAuthError("invalid_request", "Нужен PKCE с методом S256");
  return { client, redirectUri, state: get("state"), codeChallenge };
}

export async function issueCode(me: Profile, req: AuthorizeRequest): Promise<string> {
  const code = newToken("gnc");
  const { error } = await db().from("mcp_oauth_codes").insert({
    code_hash: hashToken(code), client_id: req.client.id, client_name: req.client.name, user_id: me.id,
    redirect_uri: req.redirectUri, code_challenge: req.codeChallenge, scope: SCOPE, expires_at: at(CODE_TTL_S),
  });
  if (error) throw new Error(error.message);
  const back = new URL(req.redirectUri);
  back.searchParams.set("code", code);
  if (req.state) back.searchParams.set("state", req.state);
  return back.toString();
}

export const deniedRedirect = (req: AuthorizeRequest) => {
  const back = new URL(req.redirectUri);
  back.searchParams.set("error", "access_denied");
  if (req.state) back.searchParams.set("state", req.state);
  return back.toString();
};

async function activeProfile(userId: string): Promise<Profile | null> {
  const { data } = await db().from("profiles").select(PROFILE_COLS).eq("id", userId).maybeSingle();
  return data && (data as Profile).status === "active" ? (data as Profile) : null;
}

function tokenPair() {
  const access = newToken("gna"), refresh = newToken("gnr");
  return {
    access, refresh,
    row: { access_hash: hashToken(access), access_expires_at: at(ACCESS_TTL_S), refresh_hash: hashToken(refresh), refresh_expires_at: at(REFRESH_TTL_S) },
    body: { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE },
  };
}

export async function exchangeCode(f: (k: string) => string | null) {
  const code = f("code") ?? "";
  // Код одноразовый: удаляем и тем же запросом получаем — второй обмен того же кода ничего не найдёт.
  const { data } = await db().from("mcp_oauth_codes").delete().eq("code_hash", hashToken(code))
    .select("client_id, client_name, user_id, redirect_uri, code_challenge, expires_at");
  const c = data?.[0];
  if (!c || Date.parse(c.expires_at as string) < Date.now()) throw new OAuthError("invalid_grant", "Код не найден или устарел");
  if (f("client_id") && f("client_id") !== c.client_id) throw new OAuthError("invalid_grant", "Код выдан другому клиенту");
  if (f("redirect_uri") !== c.redirect_uri) throw new OAuthError("invalid_grant", "Адрес возврата не совпадает");
  if (!pkceOk(f("code_verifier") ?? "", c.code_challenge as string)) throw new OAuthError("invalid_grant", "PKCE не сошёлся");
  if (!(await activeProfile(c.user_id as string))) throw new OAuthError("invalid_grant", "Доступ к дашборду отключён");
  const t = tokenPair();
  const { error } = await db().from("mcp_tokens").insert({ user_id: c.user_id, client_id: c.client_id, client_name: c.client_name, scope: SCOPE, ...t.row });
  if (error) throw new Error(error.message);
  return t.body;
}

// Refresh вращается: старый перестаёт работать в том же ответе, где выдан новый.
export async function refreshTokens(f: (k: string) => string | null) {
  const { data: row } = await db().from("mcp_tokens").select("id, user_id, client_id, refresh_expires_at, revoked_at")
    .eq("refresh_hash", hashToken(f("refresh_token") ?? "")).maybeSingle();
  if (!row || row.revoked_at || Date.parse(row.refresh_expires_at as string) < Date.now()) throw new OAuthError("invalid_grant", "Refresh-токен не действует");
  if (f("client_id") && f("client_id") !== row.client_id) throw new OAuthError("invalid_grant", "Токен выдан другому клиенту");
  if (!(await activeProfile(row.user_id as string))) throw new OAuthError("invalid_grant", "Доступ к дашборду отключён");
  const t = tokenPair();
  const { error } = await db().from("mcp_tokens").update(t.row).eq("id", row.id);
  if (error) throw new Error(error.message);
  return t.body;
}

// Каждый вызов MCP: токен живой и не отозван, человек не отключён. Отключение в «Команде» —
// сразу конец доступа, как в middleware для страниц.
export async function authenticate(bearer: string): Promise<{ me: Profile; tokenId: string; touch: boolean } | null> {
  if (!bearer) return null;
  const { data: row } = await db().from("mcp_tokens").select("id, user_id, access_expires_at, revoked_at, last_used_at")
    .eq("access_hash", hashToken(bearer)).maybeSingle();
  if (!row || row.revoked_at) return null;
  if (row.access_expires_at && Date.parse(row.access_expires_at as string) < Date.now()) return null;
  const me = await activeProfile(row.user_id as string);
  if (!me) return null;
  const touch = !row.last_used_at || Date.now() - Date.parse(row.last_used_at as string) > 5 * 60_000;
  return { me, tokenId: row.id as string, touch };
}

export const touchToken = (id: string) => db().from("mcp_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", id);

export async function logCall(userId: string, tokenId: string, tool: string, args: unknown, ok: boolean, error: string | null, ms: number) {
  const a = JSON.stringify(args ?? {});
  await db().from("mcp_calls").insert({
    user_id: userId, token_id: tokenId, tool, args: a.length > 2000 ? { truncated: a.slice(0, 2000) } : args ?? {}, ok, error: error?.slice(0, 500) ?? null, ms,
  });
}

// ── Подключения в Настройках ─────────────────────────────────────────────────

export interface Connection { id: string; name: string; personal: boolean; createdAt: string; lastUsedAt: string | null }

export async function listConnections(me: Profile): Promise<Connection[]> {
  const { data } = await db().from("mcp_tokens").select("id, client_id, client_name, created_at, last_used_at, refresh_expires_at")
    .eq("user_id", me.id).is("revoked_at", null).order("created_at", { ascending: false }).limit(50);
  return (data ?? [])
    .filter((r) => r.client_id === PERSONAL_CLIENT || Date.parse(r.refresh_expires_at as string) > Date.now())
    .map((r) => ({
      id: r.id as string, personal: r.client_id === PERSONAL_CLIENT,
      name: (r.client_name as string | null) || (r.client_id === PERSONAL_CLIENT ? "Ключ для терминала" : "AI-клиент"),
      createdAt: r.created_at as string, lastUsedAt: r.last_used_at as string | null,
    }));
}

// Личный ключ для Claude Code и Codex: показывается один раз, в базе — только хэш.
export async function createPersonalKey(me: Profile, name: string): Promise<string> {
  const key = newToken("gnx");
  const { error } = await db().from("mcp_tokens").insert({
    user_id: me.id, client_id: PERSONAL_CLIENT, client_name: name.trim().slice(0, 60) || "Ключ для терминала", scope: SCOPE,
    access_hash: hashToken(key), access_expires_at: null,
  });
  if (error) throw new Error(error.message);
  return key;
}

export async function revokeConnection(me: Profile, id: string): Promise<void> {
  const { error } = await db().from("mcp_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("user_id", me.id);
  if (error) throw new Error(error.message);
}
