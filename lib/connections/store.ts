import { createClient } from "@supabase/supabase-js";
import { encryptSecret, decryptSecret, secretHint } from "./crypto";

// Таблица подключений закрыта от браузера целиком (005_connections.sql), поэтому
// ходить в неё можно только сервисным ключом и только отсюда.

export interface ConnectionInput {
  metaToken?: string | null;      // null — отключить, undefined — не трогать
  crmCampaignsUrl?: string | null;
  crmAdsSheetId?: string | null;
}

// То, что можно показать в интерфейсе. Самого токена здесь нет и быть не может:
// секрет, доехавший до браузера, уже не секрет.
export interface ConnectionView {
  metaConnected: boolean;
  metaHint: string | null;
  metaSetAt: string | null;
  crmCampaignsUrl: string | null;
  crmAdsSheetId: string | null;
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
    .select("meta_token_enc, meta_token_hint, meta_token_set_at, crm_campaigns_url, crm_ads_sheet_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  return {
    metaConnected: Boolean(data?.meta_token_enc),
    metaHint: data?.meta_token_hint ?? null,
    metaSetAt: data?.meta_token_set_at ?? null,
    crmCampaignsUrl: data?.crm_campaigns_url ?? null,
    crmAdsSheetId: data?.crm_ads_sheet_id ?? null,
  };
}

// Подключение целиком, с расшифрованным токеном. Только для серверного кода,
// который идёт во внешние сервисы. В браузер это уезжать не должно.
export async function getConnection(userId: string): Promise<{
  metaToken: string | null;
  crmCampaignsUrl: string | null;
  crmAdsSheetId: string | null;
} | null> {
  const { data, error } = await admin()
    .from("buyer_connections")
    .select("meta_token_enc, crm_campaigns_url, crm_ads_sheet_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    metaToken: data.meta_token_enc ? decryptSecret(data.meta_token_enc) : null,
    crmCampaignsUrl: data.crm_campaigns_url ?? null,
    crmAdsSheetId: data.crm_ads_sheet_id ?? null,
  };
}

// Расшифрованный токен — только для серверного кода, который идёт в Meta.
export async function getMetaToken(userId: string): Promise<string | null> {
  const { data, error } = await admin()
    .from("buyer_connections")
    .select("meta_token_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.meta_token_enc ? decryptSecret(data.meta_token_enc) : null;
}

// Не занят ли этот источник кем-то ещё и не командный ли он.
//
// Выгрузки читаются ОБЩИМ сервисным аккаунтом Google, а не ключом баера. Значит
// проверка «сервисный аккаунт может это прочитать» проходит и для командной
// таблицы, и для чужой: достаточно знать её адрес. Без этой проверки баер видел
// бы выгрузку всей команды под видом своей.
export async function sourceTakenBy(
  userId: string,
  input: { crmCampaignsUrl?: string | null; crmAdsSheetId?: string | null }
): Promise<string | null> {
  const url = input.crmCampaignsUrl?.trim();
  const sheet = input.crmAdsSheetId?.trim();

  if (url && url === process.env.MVP_CAMPAIGN_WEEKLY_XLSX_URL) return "выгрузка по кампаниям";
  if (sheet && (sheet === process.env.GR_SPREADSHEET_ADS_BY_NAME || sheet === process.env.GR_SPREADSHEET_ADS)) {
    return "выгрузка по объявлениям";
  }

  const db = admin();

  if (sheet) {
    // Байерские таблицы General 3.0 сюда тоже нельзя: у них другой набор листов,
    // но проверка дешёвая, а ошибка дорогая.
    const { data } = await db.from("profiles").select("id").eq("gr_spreadsheet_id", sheet).neq("id", userId);
    if (data && data.length > 0) return "выгрузка по объявлениям";
  }

  const { data: others } = await db
    .from("buyer_connections")
    .select("crm_campaigns_url, crm_ads_sheet_id")
    .neq("user_id", userId);

  for (const o of others ?? []) {
    if (url && o.crm_campaigns_url === url) return "выгрузка по кампаниям";
    if (sheet && o.crm_ads_sheet_id === sheet) return "выгрузка по объявлениям";
  }

  return null;
}

export async function saveConnection(userId: string, input: ConnectionInput): Promise<void> {
  const patch: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };

  if (input.metaToken !== undefined) {
    const t = input.metaToken?.trim() || null;
    patch.meta_token_enc = t ? encryptSecret(t) : null;
    patch.meta_token_hint = t ? secretHint(t) : null;
    patch.meta_token_set_at = t ? new Date().toISOString() : null;
  }
  if (input.crmCampaignsUrl !== undefined) patch.crm_campaigns_url = input.crmCampaignsUrl?.trim() || null;
  if (input.crmAdsSheetId !== undefined) patch.crm_ads_sheet_id = input.crmAdsSheetId?.trim() || null;

  const { error } = await admin().from("buyer_connections").upsert(patch, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}
