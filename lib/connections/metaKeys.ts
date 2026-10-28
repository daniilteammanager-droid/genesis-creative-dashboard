import { warehouse } from "@/lib/warehouse/read";
import { encryptSecret, decryptSecret, secretHint } from "./crypto";

// Ключи Meta. У человека их может быть несколько — у Артёма шесть приложений,
// каждое на свою пачку БМ (Decision 061). Все активны сразу, переключателя нет:
// загрузка и чек собирают кабинеты со всех ключей человека.
//
// Таблица закрыта от браузера (021_sources.sql). Сам токен наружу не отдаётся
// никогда — только подсказка, права и состояние.

const GRAPH = "https://graph.facebook.com/v26.0";

// Без него дашборд только читает. Кнопкам антиотклона и Live Manager нужно
// менять объявления — это ads_management.
export const WRITE_SCOPE = "ads_management";

export interface MetaKeyView {
  id: string;
  name: string;
  hint: string | null;
  appId: string | null;
  scopes: string[];
  canWrite: boolean;
  expiresAt: string | null;
  lastError: string | null;
  lastOkAt: string | null;
  createdAt: string;
}

export async function listMetaKeys(userId: string): Promise<MetaKeyView[]> {
  const { data, error } = await warehouse().from("meta_keys")
    .select("id, name, token_hint, app_id, scopes, expires_at, last_error, last_ok_at, created_at")
    .eq("user_id", userId).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((k) => ({
    id: k.id, name: k.name, hint: k.token_hint, appId: k.app_id, scopes: k.scopes ?? [],
    canWrite: (k.scopes ?? []).includes(WRITE_SCOPE),
    expiresAt: k.expires_at, lastError: k.last_error, lastOkAt: k.last_ok_at, createdAt: k.created_at,
  }));
}

// Расшифрованные ключи — только серверному коду, который идёт в Meta.
export async function metaTokensOf(userId: string): Promise<{ id: string; token: string; canWrite: boolean }[]> {
  const { data, error } = await warehouse().from("meta_keys").select("id, token_enc, scopes").eq("user_id", userId).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((k) => ({
    id: k.id as string, token: decryptSecret(k.token_enc as string),
    canWrite: ((k.scopes as string[] | null) ?? []).includes(WRITE_SCOPE),
  }));
}

interface TokenInfo { appId: string | null; scopes: string[]; expiresAt: string | null }

// Что за ключ: живой ли, чьё приложение, какие права. debug_token отвечает и
// на сам себя, отдельный токен приложения не нужен.
export async function inspectMetaToken(token: string): Promise<TokenInfo | string> {
  try {
    const q = new URLSearchParams({ input_token: token, access_token: token });
    const body = (await (await fetch(`${GRAPH}/debug_token?${q}`)).json()) as {
      error?: { message?: string };
      data?: { is_valid?: boolean; app_id?: string; scopes?: string[]; expires_at?: number; error?: { message?: string } };
    };
    if (body.error) return `Meta не приняла ключ: ${body.error.message ?? "причина не указана"}`;
    if (!body.data?.is_valid) return `Ключ недействителен: ${body.data?.error?.message ?? "истёк или отозван"}`;

    const accounts = (await (await fetch(`${GRAPH}/me/adaccounts?limit=1&fields=id&access_token=${encodeURIComponent(token)}`)).json()) as
      { error?: { message?: string }; data?: unknown[] };
    if (accounts.error) return `Meta не отдала кабинеты: ${accounts.error.message ?? "нет доступа"}`;
    if (!accounts.data?.length) return "Ключ рабочий, но не видит ни одного рекламного кабинета — проверь права";

    const exp = body.data.expires_at;
    return {
      appId: body.data.app_id ?? null,
      scopes: body.data.scopes ?? [],
      // 0 — бессрочный (системный пользователь).
      expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
    };
  } catch {
    return "Не удалось достучаться до Meta — попробуй ещё раз";
  }
}

export async function addMetaKey(userId: string, name: string, token: string): Promise<MetaKeyView> {
  const clean = token.trim();
  const label = name.trim() || "Ключ Meta";
  if (!clean) throw new Error("Вставь ключ");

  // Тот же ключ второй раз — у себя или у другого — дал бы те же кабинеты дважды.
  const { data: all, error: e1 } = await warehouse().from("meta_keys").select("user_id, token_enc");
  if (e1) throw new Error(e1.message);
  for (const k of all ?? []) {
    if (decryptSecret(k.token_enc as string) === clean) {
      throw new Error(k.user_id === userId ? "Этот ключ уже добавлен" : "Этот ключ подключён у другого человека");
    }
  }

  const info = await inspectMetaToken(clean);
  if (typeof info === "string") throw new Error(info);

  const db = warehouse();
  const { data, error } = await db.from("meta_keys").insert({
    user_id: userId, name: label, token_enc: encryptSecret(clean), token_hint: secretHint(clean),
    app_id: info.appId, scopes: info.scopes, expires_at: info.expiresAt, last_ok_at: new Date().toISOString(),
  }).select("id").single();
  if (error) throw new Error(error.message);

  // Первый ключ делает Meta источником расхода. Догрузка истории начнётся с ним.
  const { error: e2 } = await db.from("buyer_connections").upsert(
    { user_id: userId, spend_source: "meta", updated_at: new Date().toISOString() }, { onConflict: "user_id" }
  );
  if (e2) throw new Error(e2.message);
  return (await listMetaKeys(userId)).find((k) => k.id === data.id)!;
}

// Последний ключ снят — источника больше нет, и новый можно выбрать любой.
// История в складе остаётся: отключение забирает доступ, а не данные.
export async function deleteMetaKey(userId: string, id: string): Promise<void> {
  const db = warehouse();
  const { error } = await db.from("meta_keys").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  const { count } = await db.from("meta_keys").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (!count) {
    await db.from("buyer_connections").update({
      spend_source: null, spend_backfilled_from: null, spend_backfill_done: false,
    }).eq("user_id", userId);
  }
}

// Ключ умер насовсем: Meta его больше не принимает (сменили пароль, сессию сбросили,
// отозвали доступ). Таймауты и сбои Meta сюда не подходят — они проходят сами.
export const deadKeyError = (message: string) => /access token|session has been invalidated|OAuthException/i.test(message);

// Отметка после прогона: ключ отработал или упал с такой-то ошибкой. died — ключ
// умер именно сейчас (до этого не был мёртвым): об этом говорят в Telegram один раз.
export async function markMetaKey(id: string, error: string | null): Promise<{ died: boolean; name: string }> {
  const { data: prev } = await warehouse().from("meta_keys").select("name, last_error").eq("id", id).maybeSingle();
  await warehouse().from("meta_keys")
    .update(error ? { last_error: error.slice(0, 300) } : { last_error: null, last_ok_at: new Date().toISOString() })
    .eq("id", id);
  return {
    died: Boolean(error && deadKeyError(error) && !deadKeyError((prev?.last_error as string | null) ?? "")),
    name: (prev?.name as string) ?? "",
  };
}
