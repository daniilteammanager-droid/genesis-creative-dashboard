// General Report 3.0 — types

// Two levels of sources: company-wide tables (eu/latam/wa) and per-buyer tables.
export type GrSource =
  | "main" | "latam" | "wa"
  | "summary" | "artem" | "matvey" | "andrey" | "sayan";

// wa is the only source whose sheets have a different column layout, so it
// carries its own row/totals types below; every other source is a country sheet.
export type GrKind = "country" | "wa";

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

// ─── WhatsApp funnel ──────────────────────────────────────────────────────────
// The WA spreadsheet has two funnel sheets ("WA TOTAL", "WA СТАТЬИ") that share
// a head (budget → clicks → registrations) but diverge mid-funnel: TOTAL tracks
// "написали за бонусом", СТАТЬИ tracks bot entry + article opens. Both column
// sets are kept; each row carries whichever ones its sheet has (0 elsewhere).

// Base (summable) metrics only — every ratio is recomputed from sums.
export interface WaDayRow {
  date: string;
  funnel: string;        // sheet title, e.g. "WA TOTAL"
  budget: number;
  clicks: number;
  impressions: number;
  registrations: number;
  wroteForBonus: number; // WA TOTAL only — Написали за бонусом
  enteredBot: number;    // WA СТАТЬИ only — Зашли в бота
  opened1: number;       // WA СТАТЬИ only — Открыли 1 статью
  opened2: number;       // WA СТАТЬИ only — Открыли 2 статью
  filledForm: number;    // Заполнили анкету
  enteredWeb: number;    // Зашли на веб
  applications: number;  // Заявка
  payments: number;      // Оплат
}

export interface WaTotals extends Omit<WaDayRow, "date" | "funnel"> {
  cpm: number | null;              // budget / impressions * 1000
  cpc: number | null;              // budget / clicks
  ctr: number | null;              // clicks / impressions
  siteCr: number | null;           // registrations / clicks — % конверсия сайта
  costPerReg: number | null;       // budget / registrations
  crRegToWrote: number | null;     // wroteForBonus / registrations
  crRegToBot: number | null;       // enteredBot / registrations
  costPerActivation: number | null; // budget / enteredBot
  crRegToOpen1: number | null;     // opened1 / registrations
  crRegToOpen2: number | null;     // opened2 / registrations
  crRegToWeb: number | null;       // enteredWeb / registrations
  costPerWeb: number | null;       // budget / enteredWeb — Стоимость участника
  crWebToApp: number | null;       // applications / enteredWeb
  costPerApp: number | null;       // budget / applications
  crAppToPay: number | null;       // payments / applications
  cac: number | null;              // budget / payments
}

export interface WaPeriodRow extends WaTotals {
  periodKey: string;
  periodLabel: string;
}
