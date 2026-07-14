import type { GrDayRow, GrTotals, GrPeriodRow } from "./types";

export type Granularity = "day" | "week" | "month";

const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export function computeTotals(rows: GrDayRow[]): GrTotals {
  let revenue = 0, budget = 0, adClicks = 0, websiteClicks = 0, impressions = 0;
  let registrations = 0, dialogs = 0;
  let depCountCpa = 0, depCountIb = 0, depAmountCpa = 0, depAmountIb = 0;
  let payoutsCpa = 0, payoutsIb = 0, revenueCpa = 0, revenueIb = 0;

  for (const r of rows) {
    revenue       += r.revenue;
    budget        += r.budget;
    adClicks      += r.adClicks;
    websiteClicks += r.websiteClicks;
    impressions   += r.impressions;
    registrations += r.registrations;
    dialogs       += r.dialogs;
    depCountCpa   += r.depCountCpa;
    depCountIb    += r.depCountIb;
    depAmountCpa  += r.depAmountCpa;
    depAmountIb   += r.depAmountIb;
    payoutsCpa    += r.payoutsCpa;
    payoutsIb     += r.payoutsIb;
    revenueCpa    += r.revenueCpa;
    revenueIb     += r.revenueIb;
  }

  const depCount = depCountCpa + depCountIb;

  return {
    revenue, budget, adClicks, websiteClicks, impressions,
    registrations, dialogs,
    depCountCpa, depCountIb, depAmountCpa, depAmountIb,
    payoutsCpa, payoutsIb, revenueCpa, revenueIb,
    netProfit:     revenue - budget,
    romi:          ratio(revenue - budget, budget),
    roas:          ratio(revenue, budget),
    cpm:           impressions > 0 ? (budget / impressions) * 1000 : null,
    cpc:           ratio(budget, adClicks),
    ctr:           ratio(adClicks, impressions),
    crAdToLp:      ratio(websiteClicks, adClicks),
    crLpToChannel: ratio(registrations, websiteClicks),
    costPerSub:    ratio(budget, registrations),
    crToDialog:    ratio(dialogs, registrations),
    costPerDialog: ratio(budget, dialogs),
    crDialogToDep: ratio(depCount, dialogs),
    cac:           ratio(budget, depCount),
  };
}

// ISO week: Monday-based. Returns { key: "2025-W50", monday: Date }
function isoWeek(dateIso: string): { key: string; monday: Date } {
  const d = new Date(dateIso + "T00:00:00Z");
  const day = d.getUTCDay() || 7; // Mon=1..Sun=7
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day + 1);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { key: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`, monday };
}

function fmtDm(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodOf(dateIso: string, g: Granularity): { key: string; label: string } {
  if (g === "day") {
    const [y, m, d] = dateIso.split("-");
    return { key: dateIso, label: `${d}.${m}.${y}` };
  }
  if (g === "week") {
    const { key, monday } = isoWeek(dateIso);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return { key, label: `${fmtDm(monday)}–${fmtDm(sunday)}.${sunday.getUTCFullYear()}` };
  }
  const [y, m] = dateIso.split("-");
  return { key: `${y}-${m}`, label: `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}` };
}

// Groups day rows into periods (newest first) and recomputes totals per period.
export function groupByPeriod(rows: GrDayRow[], g: Granularity): GrPeriodRow[] {
  const buckets = new Map<string, { label: string; rows: GrDayRow[] }>();
  for (const r of rows) {
    const { key, label } = periodOf(r.date, g);
    if (!buckets.has(key)) buckets.set(key, { label, rows: [] });
    buckets.get(key)!.rows.push(r);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, { label, rows: bucketRows }]) => ({
      periodKey: key,
      periodLabel: label,
      ...computeTotals(bucketRows),
    }));
}

// Merge rows from several sources by (date, country), summing base metrics.
// Used by the Summary view across the 3 buyer tables.
export function mergeDayRows(sources: GrDayRow[][]): GrDayRow[] {
  const merged = new Map<string, GrDayRow>();
  for (const rows of sources) {
    for (const r of rows) {
      const key = `${r.date}|${r.country}`;
      const b = merged.get(key);
      if (!b) {
        merged.set(key, { ...r });
        continue;
      }
      b.revenue       += r.revenue;
      b.budget        += r.budget;
      b.adClicks      += r.adClicks;
      b.websiteClicks += r.websiteClicks;
      b.impressions   += r.impressions;
      b.registrations += r.registrations;
      b.dialogs       += r.dialogs;
      b.depCountCpa   += r.depCountCpa;
      b.depCountIb    += r.depCountIb;
      b.depAmountCpa  += r.depAmountCpa;
      b.depAmountIb   += r.depAmountIb;
      b.payoutsCpa    += r.payoutsCpa;
      b.payoutsIb     += r.payoutsIb;
      b.revenueCpa    += r.revenueCpa;
      b.revenueIb     += r.revenueIb;
    }
  }
  return [...merged.values()];
}
