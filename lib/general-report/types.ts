// General Report 3.0 — types

export type GrSource = "main" | "artem" | "matvey" | "andrey" | "summary";

// Base (summable) metrics of one day row in one country sheet.
// Derived metrics (ROMI, CPM, CR%...) are never stored — always recomputed
// from sums at whatever grouping level is displayed.
export interface GrDayRow {
  date: string;    // "2025-12-13"
  country: string; // sheet title, e.g. "🇪🇸 ES ES (WA)"
  revenue: number;
  budget: number;
  adClicks: number;
  websiteClicks: number;
  impressions: number;
  registrations: number;
  dialogs: number;
  depCountCpa: number;
  depCountIb: number;
  depAmountCpa: number;
  depAmountIb: number;
  payoutsCpa: number;
  payoutsIb: number;
  revenueCpa: number;
  revenueIb: number;
}

// Sums of base metrics + derived metrics recomputed from those sums.
export interface GrTotals {
  revenue: number;
  budget: number;
  adClicks: number;
  websiteClicks: number;
  impressions: number;
  registrations: number;
  dialogs: number;
  depCountCpa: number;
  depCountIb: number;
  depAmountCpa: number;
  depAmountIb: number;
  payoutsCpa: number;
  payoutsIb: number;
  revenueCpa: number;
  revenueIb: number;
  // derived
  netProfit: number;
  romi: number | null;        // (revenue - budget) / budget
  roas: number | null;        // revenue / budget
  cpm: number | null;         // budget / impressions * 1000
  cpc: number | null;         // budget / adClicks
  ctr: number | null;         // adClicks / impressions
  crAdToLp: number | null;    // websiteClicks / adClicks
  crLpToChannel: number | null; // registrations / websiteClicks
  costPerSub: number | null;  // budget / registrations
  crToDialog: number | null;  // dialogs / registrations
  costPerDialog: number | null; // budget / dialogs
  crDialogToDep: number | null; // (depCountCpa + depCountIb) / dialogs
  cac: number | null;         // budget / (depCountCpa + depCountIb)
}

export interface GrPeriodRow extends GrTotals {
  periodKey: string;   // sortable: "2025-12-13" | "2025-W50" | "2025-12"
  periodLabel: string; // display: "13.12.2025" | "08.12–14.12.2025" | "DECEMBER 2025"
}

export interface GrData {
  source: GrSource;
  rows: GrDayRow[];      // day-level, only rows with at least one non-zero metric
  countries: string[];   // sheet titles present in the source
  generatedAt: string;
  fetchedFrom: "api" | "cache";
}
