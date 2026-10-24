import { warehouse } from "@/lib/warehouse/read";
import { notify } from "@/lib/telegram/links";

// Кому уходит алерт про кабинет: только тому, за кем кабинет закреплён
// (Decision 066). Владелец дашборда и тимлиды моментальных алертов не получают —
// им утренняя сводка (summary.ts). Кабинет без владельца — тоже только в сводку.
// Общее для всех алертов про кабинеты и объявления.

export interface Alert {
  accountId: string;
  text: string;                       // HTML
  extra?: Record<string, unknown>;    // reply_markup и прочее для sendMessage
}

export async function deliver(alerts: Alert[], event: string): Promise<number> {
  if (alerts.length === 0) return 0;
  const { data: owners } = await warehouse().from("wh_account_owners").select("account_id, owner_user_id")
    .in("account_id", [...new Set(alerts.map((a) => a.accountId))]);
  const ownerOf = new Map((owners ?? []).map((o) => [o.account_id as string, o.owner_user_id as string | null]));

  let sent = 0;
  for (const a of alerts) {
    const owner = ownerOf.get(a.accountId);
    if (!owner) continue;
    try {
      sent += await notify(owner, event, a.text, a.extra);
    } catch (e) {
      // Один недоставленный алерт не должен останавливать остальные.
      console.warn(`${event}: не доставлено:`, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}
