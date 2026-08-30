import { parseMvpXlsxWithPlaceholders } from "@/lib/reports/parseMvpXlsx";
import { parseCrmAdExport } from "./parseCrmAdExport";
import { parseCrmAdByNameExport } from "./parseCrmAdByNameExport";
import { fetchSheetValues, listSheetTitles } from "@/lib/general-report/googleSheets";
import { toPeriods, type Period } from "./periods";
import type { MvpRow } from "@/lib/reports/types";
import type { CrmAdRow, CrmAdByNameRow } from "./types";

// Ссылки и ключи таблиц приходят параметрами, а не из env: у каждого баера свои
// выгрузки Торро, и общие командные ему не достаются (Decision 035).
// Кампанийная выгрузка тоже переехала на Sheets API: дневные выгрузки Torro —
// это Google-таблицы с ключом, а не ссылки на XLSX. Один способ доступа вместо
// двух, и заодно отпадает скачивание файла целиком в память.
function pickPeriod(periods: Period[], requestedKey: string | undefined): Period {
  if (periods.length === 0) {
    throw new Error('No period sheets found (expected sheet names like "2026-07-27_2026-08-02")');
  }
  return periods.find((p) => p.key === requestedKey) ?? periods[0];
}

export async function loadCampaignPeriod(
  campaignsSheetId: string,
  requestedKey?: string
): Promise<{ periods: Period[]; period: Period; rows: MvpRow[] }> {
  const titles = await listSheetTitles(campaignsSheetId);
  const periods = toPeriods(titles);
  const period = pickPeriod(periods, requestedKey);
  const values = await fetchSheetValues(campaignsSheetId, [period.key]);
  return { periods, period, rows: parseMvpXlsxWithPlaceholders(values.get(period.key) ?? []) };
}

// Primary source for Ads mode — CRM export keyed by ad NAME, matched to Meta's ad_name.
// The (sparser) old by-id export is loaded alongside as a reserve match path.
export async function loadCreativePeriod(
  byNameId: string,
  byIdSpreadsheet: string | undefined,
  requestedKey?: string
): Promise<{ periods: Period[]; period: Period; crmByName: CrmAdByNameRow[]; crmById: CrmAdRow[] }> {

  const titles = await listSheetTitles(byNameId);
  const periods = toPeriods(titles);
  const period = pickPeriod(periods, requestedKey);

  const byNameValues = await fetchSheetValues(byNameId, [period.key]);
  const crmByName = parseCrmAdByNameExport(byNameValues.get(period.key) ?? []);

  // Reserve path — best-effort only; a missing sheet/env there shouldn't break Ads mode.
  let crmById: CrmAdRow[] = [];
  if (byIdSpreadsheet) {
    try {
      const byIdValues = await fetchSheetValues(byIdSpreadsheet, [period.key]);
      crmById = parseCrmAdExport(byIdValues.get(period.key) ?? []);
    } catch {
      crmById = [];
    }
  }

  return { periods, period, crmByName, crmById };
}
