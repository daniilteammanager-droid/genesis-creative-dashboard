import { warehouse } from "@/lib/warehouse/read";
import { encryptSecret, decryptSecret, secretHint } from "./crypto";
import { currentAccount } from "@/lib/tgads/api";

// Ключи Telegram Ads (Decision 068). Как ключи Meta: кабинетов несколько, у
// каждого свой ключ, все работают сразу. Строка — название от баера + ключ.
// Таблица закрыта от браузера (026_tgads.sql), сам ключ наружу не отдаётся.

export interface TgadsKeyView {
  id: string; name: string; hint: string | null;
  accountTitle: string | null; currency: string;
  lastError: string | null; lastOkAt: string | null; createdAt: string;
}

export async function listTgadsKeys(userId: string): Promise<TgadsKeyView[]> {
  const { data, error } = await warehouse().from("tgads_keys")
    .select("id, name, token_hint, account_title, currency, last_error, last_ok_at, created_at")
    .eq("user_id", userId).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((k) => ({
    id: k.id, name: k.name, hint: k.token_hint, accountTitle: k.account_title, currency: k.currency,
    lastError: k.last_error, lastOkAt: k.last_ok_at, createdAt: k.created_at,
  }));
}

// Расшифрованные ключи — только серверному коду, который идёт в Telegram Ads.
export async function tgadsKeysOf(userId: string): Promise<{ id: string; token: string; accountId: string; accountTitle: string }[]> {
  const { data, error } = await warehouse().from("tgads_keys").select("id, token_enc, account_id, account_title, name")
    .eq("user_id", userId).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((k) => ({
    id: k.id as string, token: decryptSecret(k.token_enc as string),
    accountId: k.account_id as string, accountTitle: (k.account_title as string) || (k.name as string),
  }));
}

export async function addTgadsKey(userId: string, name: string, token: string): Promise<void> {
  const clean = token.trim();
  if (!clean) throw new Error("Вставь ключ");
  const account = await currentAccount(clean);
  // Деньги переводим в доллары по курсу TON; EUR и Stars пока не встречались.
  // ponytail: только TON; появится кабинет в EUR — курс EUR→USD рядом с tonUsd.
  if (account.currency !== "TON") throw new Error(`Кабинет в ${account.currency} — пока поддерживаются только кабинеты в TON`);

  const db = warehouse();
  const { data: taken } = await db.from("tgads_keys").select("user_id").eq("account_id", account.account_id).maybeSingle();
  if (taken) throw new Error(taken.user_id === userId ? "Этот кабинет уже подключён" : "Этот кабинет подключён у другого человека");

  const { error } = await db.from("tgads_keys").insert({
    user_id: userId, name: name.trim() || account.title, token_enc: encryptSecret(clean), token_hint: secretHint(clean),
    account_id: account.account_id, account_title: account.title, currency: account.currency,
    last_ok_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);

  // Новый кабинет — история TG Ads заново, чтобы догрузилась и его. Источник
  // Facebook не трогаем: площадки параллельны (Decision 069).
  const { error: e2 } = await db.from("buyer_connections").upsert({
    user_id: userId, tgads_backfilled_from: null, tgads_backfill_done: false,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (e2) throw new Error(e2.message);
}

// Последний ключ снят — прогресс сбрасываем. История в складе остаётся.
export async function deleteTgadsKey(userId: string, id: string): Promise<void> {
  const db = warehouse();
  const { error } = await db.from("tgads_keys").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  const { count } = await db.from("tgads_keys").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (!count) {
    await db.from("buyer_connections").update({ tgads_backfilled_from: null, tgads_backfill_done: false }).eq("user_id", userId);
  }
}

export async function markTgadsKey(id: string, error: string | null): Promise<void> {
  await warehouse().from("tgads_keys")
    .update(error ? { last_error: error.slice(0, 300) } : { last_error: null, last_ok_at: new Date().toISOString() })
    .eq("id", id);
}
