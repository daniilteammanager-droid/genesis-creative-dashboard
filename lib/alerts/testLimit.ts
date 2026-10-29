import { warehouse } from "@/lib/warehouse/read";
import { notify } from "@/lib/telegram/links";
import { escapeHtml } from "@/lib/telegram/api";
import { mskDay, mskDaysAgo } from "@/lib/day";
import type { Profile } from "@/lib/auth/types";
import { loadTrafficReport } from "@/lib/traffic-report/load";
import { TEST_MULT, testLimit, treeOf, type ReportNode } from "@/lib/traffic-report/build";
import { dashboardUrl } from "./autocheck";

// Крео прошло границу теста без депов (Decision 100). Раз в час на прогоне «сегодня»:
// крео в стране, которое крутилось вчера или сегодня, за 30 дней потратило не меньше
// 2,5 × целевой цены депа страны и не дало ни одного депа, — алерт баеру, один раз на
// крео в стране (wh_test_alerts). Правило и граница — те же, что в «Отчётах».

const WINDOW_DAYS = 30;
const usd = (v: number) => `$${Math.round(v).toLocaleString("ru-RU")}`;

export interface Loser { geo: string; country: string; creo: string; spend: number; limit: number; subs: number; dia: number }

// Крео-лузеры, которые ещё крутятся: этап «лузер» за окно и спенд за последние два дня.
export function activeLosers(window: ReportNode[], recent: ReportNode[]): Loser[] {
  const live = new Set(recent.flatMap((b) => (b.children ?? []).flatMap((g) => (g.children ?? []).filter((c) => c.sums.spend > 0).map((c) => `${g.geo}|${c.label}`))));
  return window.flatMap((b) => (b.children ?? []).flatMap((g) => (g.children ?? [])
    .filter((c) => c.stage === "loser" && live.has(`${g.geo}|${c.label}`))
    .map((c) => ({ geo: g.geo!, country: g.label, creo: c.label, spend: c.sums.spend, limit: testLimit(g.geo!), subs: c.sums.subs, dia: c.sums.dia }))));
}

export function loserText(l: Loser): string {
  const e = escapeHtml;
  return [
    "⏹ <b>Крео прошло границу теста без депов</b>",
    `${e(l.creo)} · ${e(l.country)}`,
    `Спенд за ${WINDOW_DAYS} дней: ${usd(l.spend)} при границе ${usd(l.limit)} (${TEST_MULT.toLocaleString("ru-RU")} × целевая цена депа). Депов нет.`,
    `Подписки: ${l.subs}, диалоги: ${l.dia}.`,
  ].join("\n");
}

export async function runTestLimitAlerts(): Promise<{ users: number; found: number; sent: number }> {
  const db = warehouse();
  const { data: conns } = await db.from("buyer_connections").select("user_id");
  const ids = [...new Set((conns ?? []).map((c) => c.user_id as string))];
  const { data: people } = ids.length ? await db.from("profiles").select("*").in("id", ids).eq("status", "active") : { data: [] };
  const base = dashboardUrl();
  const extra = base ? { reply_markup: { inline_keyboard: [[{ text: "Открыть отчёт", url: `${base}/traffic-report` }]] } } : {};
  let found = 0, sent = 0;
  for (const p of (people ?? []) as Profile[]) {
    // Как баер — только его подключения, даже если он владелец или тимлид.
    const me = { ...p, role: "buyer" } as Profile;
    const [window, recent] = await Promise.all([
      loadTrafficReport(me, mskDaysAgo(WINDOW_DAYS - 1), mskDay()),
      loadTrafficReport(me, mskDaysAgo(1), mskDay()),
    ]);
    const losers = activeLosers(treeOf(window.cells), treeOf(recent.cells));
    if (!losers.length) continue;
    const { data: done } = await db.from("wh_test_alerts").select("geo, creo").eq("user_id", p.id);
    const seen = new Set((done ?? []).map((d) => `${d.geo}|${d.creo}`));
    for (const l of losers.filter((x) => !seen.has(`${x.geo}|${x.creo}`))) {
      found++;
      // Сначала отметка, потом сообщение: упавшая отправка не повторит алерт каждый час.
      const { error } = await db.from("wh_test_alerts").insert({ user_id: p.id, geo: l.geo, creo: l.creo, spend: l.spend });
      if (error) continue;
      try { sent += await notify(p.id, "test_limit", loserText(l), extra); } catch { /* алерт не важнее прогона */ }
    }
  }
  return { users: (people ?? []).length, found, sent };
}
