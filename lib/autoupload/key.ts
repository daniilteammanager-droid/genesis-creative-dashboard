import { warehouse } from "@/lib/warehouse/read";
import { decryptSecret, encryptSecret, secretHint } from "@/lib/connections/crypto";
import { metaTokensOf, WRITE_SCOPE } from "@/lib/connections/metaKeys";
import { proofFor, rememberSecret } from "@/lib/meta/proof";

// Приложение Meta для автозалива (Decision 093). Статистика, алерты, Live Manager и
// антиотклон ходят ключами из «Интеграций», а залив — своим приложением: так он не делит
// с ними лимит, и бан приложения за залив не кладёт статистику. Как у Артёма — ключ и
// необязательный App Secret. Не подключено — заливаем ключом статистики с ads_management,
// как было до этого.

const GRAPH = "https://graph.facebook.com/v26.0";
const db = () => warehouse();

// Лимиты Marketing API — из заголовков ответа Meta (x-business-use-case-usage,
// x-fb-ads-insights-throttle): % часового лимита по вызовам, CPU и времени (максимум по
// бизнесам и кабинетам ключа), через сколько минут вернётся доступ, уровень доступа
// приложения (development_access режется сильно, standard_access — нет) и общий % приложения.
export interface AppUsage { calls: number; cpu: number; time: number; regainMin: number; tier: string | null; appPct: number | null }
export interface AutouploadKeyView {
  name: string; hint: string | null; appId: string | null; appName: string | null;
  canWrite: boolean; expiresAt: string | null; lastError: string | null; hasSecret: boolean; updatedAt: string;
}

// Ключ, которым заливать: своё приложение автозалива, иначе ключ статистики с правом управления.
export async function uploadCred(userId: string): Promise<{ token: string; source: "autoupload" | "stats" } | null> {
  const { data } = await db().from("autoupload_keys").select("token_enc, secret_enc").eq("user_id", userId).maybeSingle();
  if (data) {
    const token = decryptSecret(data.token_enc as string);
    rememberSecret(token, data.secret_enc ? decryptSecret(data.secret_enc as string) : null);
    return { token, source: "autoupload" };
  }
  const k = (await metaTokensOf(userId)).find((x) => x.canWrite);
  return k ? { token: k.token, source: "stats" } : null;
}

export async function viewAutouploadKey(userId: string): Promise<AutouploadKeyView | null> {
  const { data } = await db().from("autoupload_keys")
    .select("name, token_hint, app_id, app_name, scopes, expires_at, last_error, secret_enc, updated_at").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  return {
    name: data.name as string, hint: data.token_hint as string | null, appId: data.app_id as string | null, appName: data.app_name as string | null,
    canWrite: ((data.scopes as string[] | null) ?? []).includes(WRITE_SCOPE), expiresAt: data.expires_at as string | null,
    lastError: data.last_error as string | null, hasSecret: Boolean(data.secret_enc), updatedAt: data.updated_at as string,
  };
}

function usageOf(h: Headers): AppUsage | null {
  let u: AppUsage | null = null;
  try {
    const buc = JSON.parse(h.get("x-business-use-case-usage") ?? "null") as Record<string, { call_count?: number; total_cputime?: number; total_time?: number; estimated_time_to_regain_access?: number; ads_api_access_tier?: string }[]> | null;
    for (const list of Object.values(buc ?? {})) for (const x of list) {
      u ??= { calls: 0, cpu: 0, time: 0, regainMin: 0, tier: null, appPct: null };
      u.calls = Math.max(u.calls, x.call_count ?? 0); u.cpu = Math.max(u.cpu, x.total_cputime ?? 0); u.time = Math.max(u.time, x.total_time ?? 0);
      u.regainMin = Math.max(u.regainMin, x.estimated_time_to_regain_access ?? 0); u.tier = x.ads_api_access_tier ?? u.tier;
    }
    const ins = JSON.parse(h.get("x-fb-ads-insights-throttle") ?? "null") as { app_id_util_pct?: number; ads_api_access_tier?: string } | null;
    if (ins) { u ??= { calls: 0, cpu: 0, time: 0, regainMin: 0, tier: null, appPct: null }; u.appPct = ins.app_id_util_pct ?? null; u.tier ??= ins.ads_api_access_tier ?? null; }
  } catch { /* заголовка нет или он не JSON */ }
  return u;
}
const merge = (a: AppUsage | null, b: AppUsage | null): AppUsage | null => !a ? b : !b ? a : ({
  calls: Math.max(a.calls, b.calls), cpu: Math.max(a.cpu, b.cpu), time: Math.max(a.time, b.time),
  regainMin: Math.max(a.regainMin, b.regainMin), tier: a.tier ?? b.tier, appPct: b.appPct ?? a.appPct,
});

async function get<T>(path: string, token: string, params: Record<string, string> = {}): Promise<{ body: T & { error?: { message?: string } }; usage: AppUsage | null }> {
  const q = new URLSearchParams({ ...params, access_token: token, ...proofFor(token) });
  const res = await fetch(`${GRAPH}/${path}?${q}`, { signal: AbortSignal.timeout(30_000) });
  return { body: (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }, usage: usageOf(res.headers) };
}

// Проверка ключа: живой ли, чьё приложение, есть ли ads_management, видит ли кабинеты,
// и сколько часового лимита приложения уже съедено (заголовок x-app-usage).
export async function inspectUploadKey(token: string, secret: string | null) {
  rememberSecret(token, secret);
  const dbg = await get<{ data?: { is_valid?: boolean; app_id?: string; scopes?: string[]; expires_at?: number; error?: { message?: string } } }>(
    "debug_token", token, { input_token: token });
  if (dbg.body.error) throw new Error(`Meta не приняла ключ: ${dbg.body.error.message ?? "причина не указана"}${secret ? "" : " — если в приложении включено «требовать App Secret», укажи его"}`);
  if (!dbg.body.data?.is_valid) throw new Error(`Ключ недействителен: ${dbg.body.data?.error?.message ?? "истёк или отозван"}`);
  const scopes = dbg.body.data.scopes ?? [];
  if (!scopes.includes(WRITE_SCOPE)) throw new Error("У ключа нет права ads_management — залить им нельзя");
  const acc = await get<{ data?: { id: string }[] }>("me/adaccounts", token, { limit: "1", fields: "id" });
  if (acc.body.error) throw new Error(`Meta не отдала кабинеты: ${acc.body.error.message}`);
  if (!acc.body.data?.length) throw new Error("Ключ рабочий, но не видит ни одного кабинета — дай приложению доступ к БМ");
  const appId = dbg.body.data.app_id ?? null;
  const app = appId ? await get<{ name?: string }>(appId, token, { fields: "name" }).catch(() => null) : null;
  // Общий % приложения Meta отдаёт только на запрос статистики — один дешёвый за сегодня.
  const ins = await get(`${acc.body.data[0].id}/insights`, token, { fields: "spend", date_preset: "today" }).catch(() => null);
  const exp = dbg.body.data.expires_at;
  return { appId, appName: app?.body.name ?? null, scopes, expiresAt: exp ? new Date(exp * 1000).toISOString() : null, usage: merge(acc.usage, ins?.usage ?? null) };
}

export async function setAutouploadKey(userId: string, name: string, token: string, secret: string): Promise<void> {
  const t = token.trim(), s = secret.trim() || null;
  if (!t) throw new Error("Вставь ключ приложения");
  const info = await inspectUploadKey(t, s);
  const { error } = await db().from("autoupload_keys").upsert({
    user_id: userId, name: name.trim() || info.appName || "Приложение автозалива", token_enc: encryptSecret(t), token_hint: secretHint(t),
    secret_enc: s ? encryptSecret(s) : null, app_id: info.appId, app_name: info.appName, scopes: info.scopes, expires_at: info.expiresAt,
    last_error: null, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

export async function deleteAutouploadKey(userId: string): Promise<void> {
  await db().from("autoupload_keys").delete().eq("user_id", userId);
}

// «Проверить»: тот же осмотр уже сохранённого ключа — живой ли и сколько лимита съедено.
export async function checkAutouploadKey(userId: string): Promise<{ usage: AppUsage | null }> {
  const { data } = await db().from("autoupload_keys").select("token_enc, secret_enc").eq("user_id", userId).maybeSingle();
  if (!data) throw new Error("Приложение для автозалива не подключено");
  try {
    const r = await inspectUploadKey(decryptSecret(data.token_enc as string), data.secret_enc ? decryptSecret(data.secret_enc as string) : null);
    await db().from("autoupload_keys").update({ last_error: null, scopes: r.scopes, app_name: r.appName }).eq("user_id", userId);
    return { usage: r.usage };
  } catch (e) {
    await db().from("autoupload_keys").update({ last_error: (e as Error).message.slice(0, 300) }).eq("user_id", userId);
    throw e;
  }
}
