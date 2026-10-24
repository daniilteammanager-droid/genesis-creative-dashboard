import { warehouse } from "@/lib/warehouse/read";
import { buildCheckText, loadCheck, type CheckGroup, type CheckResult } from "@/lib/warehouse/check";
import { escapeHtml, sendToLinks } from "@/lib/telegram/links";
import { mskDay, mskTime } from "@/lib/day";
import type { Profile } from "@/lib/auth/types";

// Авточек: живой чек за сегодня в привязанный чат по расписанию привязки.
// Шлёт прогон склада «сегодня», а он идёт раз в 15 минут — отсюда и шаг времени.

export const CHECK_GROUPS: CheckGroup[] = ["campaign", "creative", "country"];
// Слот, пропущенный дольше получаса (VPS лежал), не догоняем: вечерний чек,
// пришедший ночью, уже никому не нужен.
const LATE_LIMIT_MIN = 30;

// «10:00, 14:30 18:00» → ["10:00","14:30","18:00"]. Только четверти часа.
export function parseCheckTimes(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.join(",") : String(input ?? "");
  const out = new Set<string>();
  for (const token of raw.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(token);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`«${token}» — не время, нужно ЧЧ:ММ`);
    if (Number(m[2]) % 15 !== 0) throw new Error(`«${token}»: минуты кратны 15 — 00, 15, 30 или 45`);
    out.add(`${m[1].padStart(2, "0")}:${m[2]}`);
  }
  if (out.size > 12) throw new Error("Не больше 12 чеков в день");
  return [...out].sort();
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// Какой слот отправить сейчас: последний наступивший сегодня, не старше
// получаса и ещё не отправленный. null — ничего.
export function dueSlot(times: string[], day: string, now: string, sentSlot: string | null): string | null {
  const due = times.filter((t) => t <= now && minutes(now) - minutes(t) < LATE_LIMIT_MIN).sort().pop();
  if (!due) return null;
  const slot = `${day} ${due}`;
  return slot === sentSlot ? null : slot;
}

// В чат — только верх по расходу. Чек владельца по всей команде — сотня
// кампаний по копейкам, и целиком он превращается в простыню на пять сообщений
// (24.10.2026). Полный чек остаётся на странице Checks.
// ponytail: порог константой; понадобится разный у разных чатов — переедет в привязку.
export const TOP_ROWS = 15;

const money = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const UNIT: Record<CheckGroup, string> = { campaign: "кампаний", creative: "креативов", country: "стран" };

export function checkMessage(r: CheckResult, at: Date = new Date()): string {
  if (r.rows.length === 0) return escapeHtml(`${r.text}\n\nСегодня расхода пока нет.`);

  // Строки уже отсортированы по расходу (loadCheck).
  const top = r.rows.slice(0, TOP_ROWS);
  const rest = r.rows.slice(TOP_ROWS);
  const lines = [buildCheckText(top, r.totalBudget, at)];
  if (rest.length) {
    const spend = rest.reduce((s, x) => s + x.spend, 0);
    lines.push(`…и ещё ${rest.length} ${UNIT[r.groupBy]} на ${money(spend)}$`);
  }
  const t = r.totals;
  lines.push(`Итого: ${money(t.spend)}$ / доход ${t.revenue === null ? "—" : `${money(t.revenue)}$`} / ROMI ${t.romi === null ? "—" : `${t.romi.toFixed(0)}%`}`);

  return [escapeHtml(lines.join("\n\n")), r.warning ? `\n\n⚠️ ${escapeHtml(r.warning)}` : ""].join("");
}

interface LinkRow {
  id: string; user_id: string; chat_id: number; thread_id: number | null;
  check_times: string[]; check_group: CheckGroup; check_sent_slot: string | null;
}

export async function runAutocheck(at: Date = new Date()): Promise<{ due: number; sent: number; failed: number }> {
  const db = warehouse();
  const { data, error } = await db.from("telegram_links")
    .select("id, user_id, chat_id, thread_id, check_times, check_group, check_sent_slot")
    .contains("events", ["autocheck"]).neq("check_times", "{}");
  if (error) throw new Error(`telegram_links: ${error.message}`);

  const day = mskDay(at), now = mskTime(at);
  const due = ((data ?? []) as LinkRow[])
    .map((l) => ({ link: l, slot: dueSlot(l.check_times, day, now, l.check_sent_slot) }))
    .filter((d): d is { link: LinkRow; slot: string } => d.slot !== null);
  if (due.length === 0) return { due: 0, sent: 0, failed: 0 };

  const { data: profiles } = await db.from("profiles").select("*").in("id", [...new Set(due.map((d) => d.link.user_id))]);
  const profileOf = new Map(((profiles ?? []) as Profile[]).map((p) => [p.id, p]));

  // Один человек, один разрез — один сбор чека, сколько бы чатов его ни ждали.
  const checks = new Map<string, Promise<CheckResult>>();
  let sent = 0, failed = 0;
  for (const { link, slot } of due) {
    const me = profileOf.get(link.user_id);
    // Отключённому — ничего, но слот отмечаем, чтобы не перебирать его каждый прогон.
    if (me?.status === "active") {
      const key = `${me.id}|${link.check_group}`;
      if (!checks.has(key)) checks.set(key, loadCheck(me, day, day, link.check_group));
      try {
        sent += await sendToLinks([link], checkMessage(await checks.get(key)!));
      } catch (e) {
        // Слот не отмечаем: следующий прогон в пределах получаса попробует снова.
        failed++;
        console.warn("autocheck:", e instanceof Error ? e.message : e);
        continue;
      }
    }
    await db.from("telegram_links").update({ check_sent_slot: slot }).eq("id", link.id);
  }
  return { due: due.length, sent, failed };
}
