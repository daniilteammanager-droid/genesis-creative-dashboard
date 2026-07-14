import type { GrDayRow } from "./types";

// Country sheet layout (columns A..AE, 0-indexed):
//  0 Ad Date (Excel serial on day rows; "TOTAL"/"Weekly Summary"/month labels otherwise)
//  1 Revenue | 6 Ad Budget | 7 Ad Clicks | 8 Website Clicks | 9 Impressions
// 15 Registrations in Telegram Channel | 18 Total New Dialog MVP
// 21 Number of Deposits (CPA) | 22 Number of Deposits (IB)
// 23 Total Deposit Amount (CPA) | 24 Total Deposit Amount (IB)
// 26 Number of CPA Payouts | 27 Number of IB Payouts
// 28 Revenue from CPA Payouts | 29 Revenue from IB Payouts
// Derived columns (2-5, 10-14, 16-17, 19-20, 25, 30) are ignored — recomputed from sums.

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function serialToIso(serial: number): string {
  return new Date(EXCEL_EPOCH_MS + serial * 86_400_000).toISOString().slice(0, 10);
}

function n(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const parsed = parseFloat(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseCountrySheet(country: string, rows: unknown[][]): GrDayRow[] {
  const out: GrDayRow[] = [];

  for (const row of rows) {
    const serial = row[0];
    // Day rows are identified by a plausible date serial; label rows are strings.
    if (typeof serial !== "number" || serial < 40000 || serial > 60000) continue;

    const day: GrDayRow = {
      date: serialToIso(serial),
      country,
      revenue:       n(row[1]),
      budget:        n(row[6]),
      adClicks:      n(row[7]),
      websiteClicks: n(row[8]),
      impressions:   n(row[9]),
      registrations: n(row[15]),
      dialogs:       n(row[18]),
      depCountCpa:   n(row[21]),
      depCountIb:    n(row[22]),
      depAmountCpa:  n(row[23]),
      depAmountIb:   n(row[24]),
      payoutsCpa:    n(row[26]),
      payoutsIb:     n(row[27]),
      revenueCpa:    n(row[28]),
      revenueIb:     n(row[29]),
    };

    // Keep only rows that carry any signal — empty template days are noise.
    const hasData =
      day.revenue || day.budget || day.adClicks || day.websiteClicks ||
      day.impressions || day.registrations || day.dialogs ||
      day.depCountCpa || day.depCountIb || day.depAmountCpa || day.depAmountIb ||
      day.payoutsCpa || day.payoutsIb || day.revenueCpa || day.revenueIb;
    if (hasData) out.push(day);
  }

  return out;
}
