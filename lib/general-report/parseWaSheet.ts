import type { WaDayRow } from "./types";

// The two WA funnel sheets share columns 0-9 but diverge from column 10 on, so
// each gets its own index map. Derived columns (CPM/CPC/CTR/CV%/цены) are
// skipped everywhere — they are recomputed from sums, and the sheets' own
// formula cells can hold "#DIV/0!" strings.
//
// WA TOTAL:   0 AD DATE | 1 Ad Budget | 2 Ad Clicks | 3 Impressions | 8 Регистраций
//            11 Написали за бонусом | 12 Заполнили анкету | 14 Зашли на веб
//            17 Заявка | 20 Оплат
// WA СТАТЬИ:  0 AD DATE | 1 Ad Budget | 2 Ad Clicks | 3 Impressions | 8 Регистраций
//            11 Зашли в бота | 14 Открыли 1 статью | 16 Открыли 2 статью
//            17 Заполнили анкету | 19 Зашли на веб | 20 Заявка | 23 Оплат

type ColMap = Partial<Record<keyof Omit<WaDayRow, "date" | "funnel">, number>>;

const TOTAL_COLS: ColMap = {
  budget: 1, clicks: 2, impressions: 3, registrations: 8,
  wroteForBonus: 11, filledForm: 12, enteredWeb: 14, applications: 17, payments: 20,
};

const ARTICLES_COLS: ColMap = {
  budget: 1, clicks: 2, impressions: 3, registrations: 8,
  enteredBot: 11, opened1: 14, opened2: 16, filledForm: 17,
  enteredWeb: 19, applications: 20, payments: 23,
};

// Sheet titles are stable in the source spreadsheet; anything else is treated as
// the articles-style layout only if it says so, otherwise the TOTAL layout.
function colsFor(funnel: string): ColMap {
  return /СТАТЬИ/i.test(funnel) ? ARTICLES_COLS : TOTAL_COLS;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function serialToIso(serial: number): string {
  return new Date(EXCEL_EPOCH_MS + serial * 86_400_000).toISOString().slice(0, 10);
}

function n(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const parsed = parseFloat(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseWaSheet(funnel: string, rows: unknown[][]): WaDayRow[] {
  const cols = colsFor(funnel);
  const out: WaDayRow[] = [];

  for (const row of rows) {
    const serial = row[0];
    // Day rows carry a date serial; "TOTAL"/"Weekly Summary"/month labels are strings.
    if (typeof serial !== "number" || serial < 40000 || serial > 60000) continue;

    const pick = (k: keyof ColMap): number => {
      const idx = cols[k];
      return idx === undefined ? 0 : n(row[idx]);
    };

    const day: WaDayRow = {
      date: serialToIso(serial),
      funnel,
      budget:        pick("budget"),
      clicks:        pick("clicks"),
      impressions:   pick("impressions"),
      registrations: pick("registrations"),
      wroteForBonus: pick("wroteForBonus"),
      enteredBot:    pick("enteredBot"),
      opened1:       pick("opened1"),
      opened2:       pick("opened2"),
      filledForm:    pick("filledForm"),
      enteredWeb:    pick("enteredWeb"),
      applications:  pick("applications"),
      payments:      pick("payments"),
    };

    const hasData =
      day.budget || day.clicks || day.impressions || day.registrations ||
      day.wroteForBonus || day.enteredBot || day.opened1 || day.opened2 ||
      day.filledForm || day.enteredWeb || day.applications || day.payments;
    if (hasData) out.push(day);
  }

  return out;
}
