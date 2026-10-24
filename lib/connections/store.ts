import { createClient } from "@supabase/supabase-js";
import { encryptSecret, decryptSecret, secretHint } from "./crypto";

// Таблица подключений закрыта от браузера целиком (005_connections.sql), поэтому
// ходить в неё можно только сервисным ключом и только отсюда.

export interface ConnectionInput {
  metaToken?: string | null;      // null — отключить, undefined — не трогать
  crmCampaignsSheetId?: string | null;
  crmAdsSheetId?: string | null;
  crmAdsByIdSheetId?: string | null;
  torroToken?: string | null;     // null — отключить, undefined — не трогать
  torroBuyerId?: number | null;
}

// То, что можно показать в интерфейсе. Самого токена здесь нет и быть не может:
// секрет, доехавший до браузера, уже не секрет.
export interface ConnectionView {
  metaConnected: boolean;
  metaHint: string | null;
  metaSetAt: string | null;
  crmCampaignsSheetId: string | null;
  crmAdsSheetId: string | null;
  crmAdsByIdSheetId: string | null;
  torroConnected: boolean;
  torroHint: string | null;
  torroBuyerId: number | null;
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Не заданы NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function getConnectionView(userId: string): Promise<ConnectionView> {
  const { data, error } = await admin()
    .from("buyer_connections")
    .select("meta_token_enc, meta_token_hint, meta_token_set_at, crm_campaigns_sheet_id, crm_ads_sheet_id, crm_ads_by_id_sheet_id, torro_token_enc, torro_token_hint, torro_buyer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  return {
    metaConnected: Boolean(data?.meta_token_enc),
    metaHint: data?.meta_token_hint ?? null,
    metaSetAt: data?.meta_token_set_at ?? null,
    crmCampaignsSheetId: data?.crm_campaigns_sheet_id ?? null,
    crmAdsSheetId: data?.crm_ads_sheet_id ?? null,
    crmAdsByIdSheetId: data?.crm_ads_by_id_sheet_id ?? null,
    torroConnected: Boolean(data?.torro_token_enc),
    torroHint: data?.torro_token_hint ?? null,
    torroBuyerId: data?.torro_buyer_id ?? null,
  };
}

// Подключение целиком, с расшифрованным токеном. Только для серверного кода,
// который идёт во внешние сервисы. В браузер это уезжать не должно.
export async function getConnection(userId: string): Promise<{
  metaToken: string | null;
  crmCampaignsSheetId: string | null;
  crmAdsSheetId: string | null;
  crmAdsByIdSheetId: string | null;
  torroToken: string | null;
  torroBuyerId: number | null;
  spendSource: "meta" | "fbtool" | "dolphin" | null;
  dolphinToken: string | null;
} | null> {
  const { data, error } = await admin()
    .from("buyer_connections")
    .select("meta_token_enc, crm_campaigns_sheet_id, crm_ads_sheet_id, crm_ads_by_id_sheet_id, torro_token_enc, torro_buyer_id, spend_source, dolphin_token_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    metaToken: data.meta_token_enc ? decryptSecret(data.meta_token_enc) : null,
    crmCampaignsSheetId: data.crm_campaigns_sheet_id ?? null,
    crmAdsSheetId: data.crm_ads_sheet_id ?? null,
    crmAdsByIdSheetId: data.crm_ads_by_id_sheet_id ?? null,
    torroToken: data.torro_token_enc ? decryptSecret(data.torro_token_enc) : null,
    torroBuyerId: data.torro_buyer_id ?? null,
    spendSource: data.spend_source ?? null,
    dolphinToken: data.dolphin_token_enc ? decryptSecret(data.dolphin_token_enc) : null,
  };
}

// Подключить Dolphin источником расхода или снять его (token = null). Источник
// у человека один (Decision 061): при подключённом Meta вызывающий отказывает раньше.
export async function setDolphinToken(userId: string, token: string | null): Promise<void> {
  const t = token?.trim() || null;
  const { error } = await admin().from("buyer_connections").upsert({
    user_id: userId,
    dolphin_token_enc: t ? encryptSecret(t) : null,
    dolphin_token_hint: t ? secretHint(t) : null,
    dolphin_set_at: t ? new Date().toISOString() : null,
    spend_source: t ? "dolphin" : null,
    // Новый источник — догрузка истории заново: те же строки перезапишутся.
    spend_backfilled_from: null, spend_backfill_done: false, spend_backfill_empty: 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

// Занят ли id баера Torro кем-то ещё. Уникальный индекс в базе это тоже ловит,
// но его ошибка ничего не говорит человеку.
export async function torroBuyerTakenBy(userId: string, buyerId: number): Promise<boolean> {
  const { data, error } = await admin()
    .from("buyer_connections").select("user_id")
    .eq("torro_buyer_id", buyerId).neq("user_id", userId).limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function saveConnection(userId: string, input: ConnectionInput): Promise<void> {
  const patch: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };

  if (input.metaToken !== undefined) {
    const t = input.metaToken?.trim() || null;
    patch.meta_token_enc = t ? encryptSecret(t) : null;
    patch.meta_token_hint = t ? secretHint(t) : null;
    patch.meta_token_set_at = t ? new Date().toISOString() : null;
  }
  if (input.crmCampaignsSheetId !== undefined) patch.crm_campaigns_sheet_id = input.crmCampaignsSheetId?.trim() || null;
  if (input.crmAdsSheetId !== undefined) patch.crm_ads_sheet_id = input.crmAdsSheetId?.trim() || null;
  if (input.crmAdsByIdSheetId !== undefined) patch.crm_ads_by_id_sheet_id = input.crmAdsByIdSheetId?.trim() || null;
  if (input.torroToken !== undefined) {
    const t = input.torroToken?.trim() || null;
    patch.torro_token_enc = t ? encryptSecret(t) : null;
    patch.torro_token_hint = t ? secretHint(t) : null;
    patch.torro_token_set_at = t ? new Date().toISOString() : null;
  }
  if (input.torroBuyerId !== undefined) patch.torro_buyer_id = input.torroBuyerId;

  const { error } = await admin().from("buyer_connections").upsert(patch, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}
