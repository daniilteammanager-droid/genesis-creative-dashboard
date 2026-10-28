import { mskDay, mskDaysAgo } from "@/lib/day";

// Периоды блока метрик Главной. Отдельно от summary.ts: их берёт и страница, а тот тянет склад.

export const PERIODS = [
  { id: "today", label: "Сегодня" },
  { id: "yesterday", label: "Вчера" },
  { id: "7d", label: "7 дней" },
  { id: "30d", label: "30 дней" },
  { id: "all", label: "Всё время" },
] as const;
export type PeriodId = (typeof PERIODS)[number]["id"];

export function periodRange(id: PeriodId, now = new Date()): { since: string; until: string } {
  const today = mskDay(now);
  switch (id) {
    case "today": return { since: today, until: today };
    case "yesterday": { const d = mskDaysAgo(1, now); return { since: d, until: d }; }
    case "30d": return { since: mskDaysAgo(29, now), until: today };
    // ponytail: «всё время» = с начала склада; станет медленным — дневные итоги в отдельную таблицу.
    case "all": return { since: "2020-01-01", until: today };
    default: return { since: mskDaysAgo(6, now), until: today };
  }
}
