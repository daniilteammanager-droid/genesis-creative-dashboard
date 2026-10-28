import type { Profile } from "@/lib/auth/types";
import type { Metrics } from "@/app/live-manager/columns";
import { loadReportTree } from "@/lib/warehouse/reportTree";
import { periodRange, type PeriodId } from "./periods";

// Главная, блок метрик: итог склада за период — по дереву Live Manager.
// Доход — все суммы Torro за период (это и есть выплаты), включая кампании без
// расхода в этом периоде: деп приходит позже, на кампанию, которая лила неделями
// раньше. Live Manager их в итог не берёт, а здесь без них неделя выглядела бы
// минусом (28.10.2026: $2k вместо $26k).

export interface HomeMetrics {
  since: string; until: string;
  totals: Metrics;
  notice?: string;
}

export async function loadHomeMetrics(me: Profile, period: PeriodId): Promise<HomeMetrics> {
  const { since, until } = periodRange(period);
  const tree = await loadReportTree(me, since, until);
  const add = (a: number | null, b: number | null | undefined) => (b == null ? a : (a ?? 0) + b);
  const t: Metrics = {
    spend: 0, clicks: 0, impressions: 0, lpClicks: null, subscribers: null, dialogs: null,
    depCount: null, depSum: null, quals: null, linkClicks: null, results: null,
  };
  for (const c of tree.nodes) {
    t.spend += c.spend; t.clicks += c.clicks; t.impressions += c.impressions;
    t.lpClicks = add(t.lpClicks, c.lpClicks); t.subscribers = add(t.subscribers, c.subscribers);
    t.dialogs = add(t.dialogs, c.dialogs); t.depCount = add(t.depCount, c.depCount); t.depSum = add(t.depSum, c.depSum);
    t.linkClicks = add(t.linkClicks ?? null, c.linkClicks); t.results = add(t.results ?? null, c.results);
    if (c.quals) t.quals = (t.quals ?? [0, 0, 0, 0, 0]).map((v, i) => v + c.quals![i]) as Metrics["quals"];
  }
  return { since, until, totals: t, notice: tree.notice };
}
