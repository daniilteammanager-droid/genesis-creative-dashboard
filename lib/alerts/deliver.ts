import { warehouse } from "@/lib/warehouse/read";
import { notify } from "@/lib/telegram/links";

// Кому уходит алерт про кабинет: его владельцу (Decision 052) плюс всем
// владельцам дашборда и тимлидам — они видят всю команду. Кабинет без
// владельца — только им. Общее для всех алертов про кабинеты и объявления.

export interface Alert {
  accountId: string;
  text: string;                       // HTML
  extra?: Record<string, unknown>;    // reply_markup и прочее для sendMessage
}

export async function deliver(alerts: Alert[], event: string): Promise<number> {
  if (alerts.length === 0) return 0;
  const db = warehouse();
  const ids = [...new Set(alerts.map((a) => a.accountId))];
  const [{ data: owners }, { data: leads }] = await Promise.all([
    db.from("wh_account_owners").select("account_id, owner_user_id").in("account_id", ids),
    db.from("profiles").select("id").in("role", ["main", "teamlead"]).eq("status", "active"),
  ]);
  const ownerOf = new Map((owners ?? []).map((o) => [o.account_id as string, o.owner_user_id as string | null]));
  const team = (leads ?? []).map((l) => l.id as string);

  let sent = 0;
  for (const a of alerts) {
    const to = new Set(team);
    const owner = ownerOf.get(a.accountId);
    if (owner) to.add(owner);
    for (const userId of to) {
      try {
        sent += await notify(userId, event, a.text, a.extra);
      } catch (e) {
        // Один недоставленный алерт не должен останавливать остальные.
        console.warn(`${event}: не доставлено:`, e instanceof Error ? e.message : e);
      }
    }
  }
  return sent;
}
