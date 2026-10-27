import { warehouse } from "@/lib/warehouse/read";

// История антиотклона (Decision 091): новые отклонения и действия — из бота, со страницы и
// уникализации. Как «История антиотклона» у Артёма.

// Записать событие истории. Ошибка записи не должна ронять само действие.
export async function logEvent(e: {
  kind: "rejected" | "action"; adId: string; accountId?: string | null; adName?: string | null; campaignName?: string | null;
  ownerId?: string | null; actor?: string | null; text?: string | null; ok?: boolean | null; status?: string | null;
}): Promise<void> {
  await warehouse().from("antireject_events").insert({
    kind: e.kind, ad_id: e.adId, account_id: e.accountId ?? null, ad_name: e.adName ?? null, campaign_name: e.campaignName ?? null,
    owner_user_id: e.ownerId ?? null, actor: e.actor ?? null, text: e.text ?? null, ok: e.ok ?? null, status: e.status ?? null,
  }).then(({ error }) => { if (error) console.warn("antireject_events:", error.message); });
}

