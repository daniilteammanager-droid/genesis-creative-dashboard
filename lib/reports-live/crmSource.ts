import * as XLSX from "xlsx";
import { parseMvpXlsxWithPlaceholders } from "@/lib/reports/parseMvpXlsx";
import { parseCrmAdExport } from "./parseCrmAdExport";
import { parseCrmAdByNameExport } from "./parseCrmAdByNameExport";
import { fetchSheetValues, listSheetTitles } from "@/lib/general-report/googleSheets";
import { toPeriods, type Period } from "./periods";
import type { MvpRow } from "@/lib/reports/types";
import type { CrmAdRow, CrmAdByNameRow } from "./types";

async function fetchCampaignWorkbook(): Promise<XLSX.WorkBook> {
  const url = process.env.MVP_CAMPAIGN_WEEKLY_XLSX_URL;
  if (!url) throw new Error("Missing MVP_CAMPAIGN_WEEKLY_XLSX_URL env var");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CRM campaign export fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return XLSX.read(buf, { type: "buffer" });
}

function pickPeriod(periods: Period[], requestedKey: string | undefined): Period {
  if (periods.length === 0) {
    throw new Error('No period sheets found (expected sheet names like "2026-07-27_2026-08-02")');
  }
  return periods.find((p) => p.key === requestedKey) ?? periods[0];
}

export async function loadCampaignPeriod(
  requestedKey?: string
): Promise<{ periods: Period[]; period: Period; rows: MvpRow[] }> {
  const wb = await fetchCampaignWorkbook();
  const periods = toPeriods(wb.SheetNames);
  const period = pickPeriod(periods, requestedKey);
  const ws = wb.Sheets[period.key];
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });
  return { periods, period, rows: parseMvpXlsxWithPlaceholders(rawRows) };
}

// Primary source for Ads mode — CRM export keyed by ad NAME, matched to Meta's ad_name.
// The (sparser) old by-id export is loaded alongside as a reserve match path.
export async function loadCreativePeriod(
  requestedKey?: string
): Promise<{ periods: Period[]; period: Period; crmByName: CrmAdByNameRow[]; crmById: CrmAdRow[] }> {
  const byNameId = process.env.GR_SPREADSHEET_ADS_BY_NAME;
  if (!byNameId) throw new Error("Missing GR_SPREADSHEET_ADS_BY_NAME env var");

  const titles = await listSheetTitles(byNameId);
  const periods = toPeriods(titles);
  const period = pickPeriod(periods, requestedKey);

  const byNameValues = await fetchSheetValues(byNameId, [period.key]);
  const crmByName = parseCrmAdByNameExport(byNameValues.get(period.key) ?? []);

  // Reserve path — best-effort only; a missing sheet/env there shouldn't break Ads mode.
  let crmById: CrmAdRow[] = [];
  const byIdSpreadsheet = process.env.GR_SPREADSHEET_ADS;
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
