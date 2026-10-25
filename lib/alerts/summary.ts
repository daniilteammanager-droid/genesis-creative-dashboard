import { warehouse } from "@/lib/warehouse/read";
import { loadCheck } from "@/lib/warehouse/check";
import { escapeHtml, sendToLinks } from "@/lib/telegram/links";
import { mskDay, mskDaysAgo, mskTime } from "@/lib/day";
import type { Profile } from "@/lib/auth/types";
import { dueSlot, openCheckButton } from "./autocheck";

// Утренняя сводка владельцу и тимлиду (Decision 066). Моментальные алерты им
// больше не идут — только баеру, чей кабинет. Вместо них раз в день: вчерашние
// цифры по баерам и что сломалось за сутки.
//
// Цифры — тем же loadCheck, что и чек: сводка и Checks за вчера обязаны совпадать.
// ponytail: время константой; понадобится своё у каждого — переедет в привязку, как у авточека.
export const SUMMARY_TIME = "10:00";

// Проблемные статусы кабинета — те же, по которым шлётся алерт (cabinets.ts).
const PROBLEM = ["DISABLED", "MISSING", "IN_GRACE_PERIOD", "UNSETTLED", "PENDING_RISK_REVIEW"];
const NO_OWNER = "без владельца";

export interface BuyerLine { label: string; spend: number; revenue: number | null; romi: number | null }
export interface TroubleLine { label: string; cabinets: number; rejected: number }

const money = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const line = (spend: number, revenue: number | null, romi: number | null) =>
  `${money(spend)}$ / доход ${revenue === null ? "—" : `${money(revenue)}$`} / ROMI ${romi === null ? "—" : `${romi.toFixed(0)}%`}`;

export function summaryText(day: string, buyers: BuyerLine[], total: BuyerLine, trouble: TroubleLine[]): string {
  const e = escapeHtml;
  const lines = [`<b>📊 Сводка за ${day.slice(8, 10)}.${day.slice(5, 7)}</b>`, ""];
  // Баеры без расхода за день — не строка сводки, а шум.
  for (const b of buyers.filter((x) => x.spend > 0).sort((a, b) => b.spend - a.spend)) {
    lines.push(`${e(b.label)}: ${line(b.spend, b.revenue, b.romi)}`);
  }
  if (lines.length === 2) lines.push("Расхода за день не было.");
  lines.push("", `<b>Итого:</b> ${line(total.spend, total.revenue, total.romi)}`);

  const bad = trouble.filter((t) => t.cabinets || t.rejected);
  lines.push("", "<b>За сутки:</b>");
  if (!bad.length) lines.push("блокировок и отклонений не было ✅");
  for (const t of bad) {
    lines.push(`${e(t.label)} — ${[
      t.cabinets ? `проблемных кабинетов: ${t.cabinets}` : null,
      t.rejected ? `отклонённых объявлений: ${t.rejected}` : null,
    ].filter(Boolean).join(", ")}`);
  }
  return lines.join("\n");
}

interface LinkRow { id: string; user_id: string; chat_id: number; thread_id: number | null; summary_sent_slot: string | null }

// Что сломалось за сутки, по тому, за кем кабинет: ровно то, о чём ушёл бы
// алерт (alerted_at), а не всё, что впервые попало в таблицу.
export async function troubleByOwner(since: string, label: Map<string, string>): Promise<TroubleLine[]> {
  const db = warehouse();
  const [{ data: cabs }, { data: ads }] = await Promise.all([
    db.from("wh_cabinet_states").select("account_id").in("status", PROBLEM).gte("alerted_at", since),
    db.from("wh_rejected_ads").select("account_id, owner_user_id").gte("alerted_at", since),
  ]);
  const ids = [...new Set([...(cabs ?? []), ...(ads ?? [])].map((r) => r.account_id as string))];
  const { data: owners } = ids.length
    ? await db.from("wh_account_owners").select("account_id, owner_user_id").in("account_id", ids)
    : { data: [] };
  const ownerOf = new Map((owners ?? []).map((o) => [o.account_id as string, o.owner_user_id as string | null]));
  const by = new Map<string, TroubleLine>();
  const bump = (accountId: string, k: "cabinets" | "rejected", direct?: string | null) => {
    const owner = direct ?? ownerOf.get(accountId);
    const name = owner ? label.get(owner) ?? owner : NO_OWNER;
    const t = by.get(name) ?? { label: name, cabinets: 0, rejected: 0 };
    t[k]++;
    by.set(name, t);
  };
  for (const c of cabs ?? []) bump(c.account_id as string, "cabinets");
  for (const a of ads ?? []) bump(a.account_id as string, "rejected", a.owner_user_id as string | null);
  return [...by.values()];
}

export async function runDailySummary(at: Date = new Date()): Promise<{ due: number; sent: number; failed: number }> {
  const db = warehouse();
  const day = mskDay(at), now = mskTime(at);
  const { data, error } = await db.from("telegram_links")
    .select("id, user_id, chat_id, thread_id, summary_sent_slot")
    .contains("events", ["daily_summary"]);
  if (error) throw new Error(`telegram_links: ${error.message}`);

  const due = ((data ?? []) as LinkRow[])
    .map((l) => ({ link: l, slot: dueSlot([SUMMARY_TIME], day, now, l.summary_sent_slot) }))
    .filter((d): d is { link: LinkRow; slot: string } => d.slot !== null);
  if (due.length === 0) return { due: 0, sent: 0, failed: 0 };

  const { data: profiles } = await db.from("profiles").select("*").in("id", [...new Set(due.map((d) => d.link.user_id))]);
  const profileOf = new Map(((profiles ?? []) as Profile[]).map((p) => [p.id, p]));

  // Сводка одна на всех получателей: и владелец, и тимлид видят всю команду.
  let text: Promise<string> | null = null;
  const build = async (me: Profile) => {
    const yesterday = mskDaysAgo(1, at);
    const all = await loadCheck(me, yesterday, yesterday, "campaign");
    const buyers = await Promise.all(all.buyers.map(async (b) => {
      const c = await loadCheck(me, yesterday, yesterday, "campaign", b.id);
      return { label: b.label, ...c.totals };
    }));
    const label = new Map(all.buyers.map((b) => [b.id, b.label]));
    const trouble = await troubleByOwner(new Date(at.getTime() - 24 * 3600_000).toISOString(), label);
    return summaryText(yesterday, buyers, { label: "Итого", ...all.totals }, trouble);
  };

  let sent = 0, failed = 0;
  for (const { link, slot } of due) {
    const me = profileOf.get(link.user_id);
    // Баеру сводка не положена: в ней цифры всей команды.
    if (me?.status === "active" && (me.role === "main" || me.role === "teamlead")) {
      try {
        text ??= build(me);
        sent += await sendToLinks([link], await text, openCheckButton(mskDaysAgo(1, at), "campaign"));
      } catch (e) {
        // Слот не отмечаем: следующий прогон в пределах получаса попробует снова.
        failed++;
        text = null;
        console.warn("summary:", e instanceof Error ? e.message : e);
        continue;
      }
    }
    await db.from("telegram_links").update({ summary_sent_slot: slot }).eq("id", link.id);
  }
  return { due: due.length, sent, failed };
}
