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
