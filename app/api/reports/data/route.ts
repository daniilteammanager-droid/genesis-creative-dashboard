import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { parseMvpReport } from "@/lib/reports/parseMvpReport";
import { parseMvpXlsxWithDebug } from "@/lib/reports/parseMvpXlsx";
import type { MvpParseDebug } from "@/lib/reports/parseMvpXlsx";
import { parseFbtoolReport } from "@/lib/reports/parseFbtoolReport";
import { buildReportRows } from "@/lib/reports/buildReportRows";
import { buildFbtoolApiError } from "@/lib/reports/fbtoolApiError";
import type { EntityType, TimeGrain, FbtoolCampaign, FbtoolApiError } from "@/lib/reports/types";

// ─── Env maps ────────────────────────────────────────────────────────────────

const MVP_XLSX_ENV_MAP: Partial<Record<EntityType, Partial<Record<TimeGrain, string>>>> = {
  campaign: { weekly: "MVP_CAMPAIGN_WEEKLY_XLSX_URL" },
  creative: { weekly: "MVP_CREATIVE_WEEKLY_XLSX_URL" },
};

const MVP_CSV_ENV_MAP: Partial<Record<EntityType, Partial<Record<TimeGrain, string>>>> = {
  campaign: { weekly: "MVP_CAMPAIGN_WEEKLY_CSV_URL" },
  creative: { weekly: "MVP_CREATIVE_WEEKLY_CSV_URL" },
};

// Dev-only escape hatch — must be explicitly enabled, off by default.
// Gates: (1) local test-data/mvp/*.xlsx MVP fallback, (2) local test-data/fbtool/*.json FBTool fallback.
// Does NOT gate the legacy MVP_*_CSV_URL fallback — that's a real (if old) production source, not test data.
function allowTestDataFallback(): boolean {
  return process.env.REPORTS_ALLOW_TEST_DATA_FALLBACK === "true";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findLatestFile(dir: string, ext: string): string | null {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort();
    return files.length > 0 ? path.join(dir, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

// Parses "2026-06-29_2026-07-05" → { from, to } or null
function parseDateRange(sheetName: string): { from: string; to: string } | null {
  const m = sheetName.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
  if (!m) return null;
  return { from: m[1], to: m[2] };
}

// ─── MVP loader ──────────────────────────────────────────────────────────────

type MvpLoadResult = {
  rows: ReturnType<typeof parseMvpReport>;
  filename: string;
  sheets: string[];
  selectedSheet: string;
  mvpDebug?: MvpParseDebug;
};

async function loadMvpRows(
  entity: EntityType,
  timeGrain: TimeGrain,
  requestedSheet?: string
): Promise<MvpLoadResult | null> {

  // 1. XLSX URL (primary — sheet-aware, English-header format)
  const xlsxEnvKey = MVP_XLSX_ENV_MAP[entity]?.[timeGrain];
  const xlsxUrl = xlsxEnvKey ? process.env[xlsxEnvKey] : undefined;

  if (xlsxUrl) {
    const res = await fetch(xlsxUrl);
    if (!res.ok) throw new Error(`XLSX fetch failed: ${res.status} ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheets = wb.SheetNames;
    const selectedSheet =
      requestedSheet && sheets.includes(requestedSheet) ? requestedSheet : sheets[0];
    // raw: false → all values as strings; preserves large numeric IDs
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[selectedSheet], { header: 1, raw: false });
    const { rows, debug } = parseMvpXlsxWithDebug(rawRows);
    return { rows, filename: xlsxEnvKey!, sheets, selectedSheet, mvpDebug: debug };
  }

  // 2. CSV URL fallback (no sheet selection, legacy Russian-header format) — real fallback, always on
  const csvEnvKey = MVP_CSV_ENV_MAP[entity]?.[timeGrain];
  const csvUrl =
    (csvEnvKey ? process.env[csvEnvKey] : undefined) ??
    (entity === "campaign" && timeGrain === "weekly" ? process.env.MVP_WEEKLY_CSV_URL : undefined);

  if (csvUrl) {
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
    const text = await res.text();
    const { data } = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
    return {
      rows: parseMvpReport(data as unknown[][]),
      filename: csvEnvKey ?? "MVP_WEEKLY_CSV_URL",
      sheets: [],
      selectedSheet: "",
    };
  }

  // 3. Local test-data fallback — dev-only, requires explicit opt-in
  if (!allowTestDataFallback()) return null;

  const localPath = findLatestFile(path.join(process.cwd(), "test-data", "mvp"), ".xlsx");
  if (!localPath) return null;

  const wb = XLSX.read(fs.readFileSync(localPath), { type: "buffer" });
  const sheets = wb.SheetNames;
  const selectedSheet =
    requestedSheet && sheets.includes(requestedSheet) ? requestedSheet : sheets[0];
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[selectedSheet], { header: 1 });
  return { rows: parseMvpReport(rawRows), filename: path.basename(localPath), sheets, selectedSheet };
}

// ─── FBTool API ───────────────────────────────────────────────────────────────

function redactedRequestUrl(account: string, dates: string): string {
  const qs = new URLSearchParams({ account, mode: "campaigns", status: "all", dates, key: "[REDACTED]" });
  return `https://fbtool.pro/api/get-statistics?${qs}`;
}

async function callFbtoolApi(dateRange: { from: string; to: string }): Promise<{
  campaigns: FbtoolCampaign[];
  apiErrors: FbtoolApiError[];
}> {
  const key     = process.env.FBTOOL_API_KEY!;
  const account = process.env.FBTOOL_ACCOUNT_ID!;
  const dates   = `${dateRange.from} - ${dateRange.to}`;

  const qs = new URLSearchParams({ key, account, mode: "campaigns", status: "all", dates });
  const apiUrl = `https://fbtool.pro/api/get-statistics?${qs}`;

  // Debug params sent back to the client — API key always redacted, never the real value
  const debugParams = {
    account, mode: "campaigns", status: "all", dates,
    key: "[REDACTED]",
    requestUrl: redactedRequestUrl(account, dates),
  };

  let rawBody = "";
  let statusCode = 0;

  try {
    const res = await fetch(apiUrl);
    statusCode = res.status;
    rawBody = await res.text();

    if (!res.ok) {
      return {
        campaigns: [],
        apiErrors: [buildFbtoolApiError({
          statusCode,
          errorMessage: `HTTP ${res.status} ${res.statusText}`,
          rawBody,
          accountId: account,
          dateRange,
          requestParams: debugParams,
        })],
      };
    }

    const json = JSON.parse(rawBody) as Record<string, unknown>;

    // FBTool API-level error in response body
    if (!json.data || json.success === false || json.error) {
      // FBTool/Facebook errors often come back as { error: { message, type, code, ... } }
      const errObj = json.error as Record<string, unknown> | string | undefined;
      const errorMessage =
        typeof errObj === "string" ? errObj :
        typeof errObj === "object" && errObj !== null && typeof errObj.message === "string" ? errObj.message :
        typeof json.message === "string" ? json.message :
        "FBTool returned no data";

      return {
        campaigns: [],
        apiErrors: [buildFbtoolApiError({
          statusCode,
          errorMessage,
          rawBody,
          accountId: account,
          dateRange,
          requestParams: debugParams,
        })],
      };
    }

    return { campaigns: parseFbtoolReport(json), apiErrors: [] };

  } catch (e) {
    return {
      campaigns: [],
      apiErrors: [buildFbtoolApiError({
        statusCode,
        errorMessage: e instanceof Error ? e.message : "Unknown error",
        rawBody,
        accountId: account,
        dateRange,
        requestParams: debugParams,
      })],
    };
  }
}

// Missing FBTOOL_API_KEY / FBTOOL_ACCOUNT_ID — no request is sent; report this the same way as a real API error
function buildMissingEnvError(dateRange: { from: string; to: string }): FbtoolApiError {
  const key     = process.env.FBTOOL_API_KEY;
  const account = process.env.FBTOOL_ACCOUNT_ID;
  const missing = [
    !key     ? "FBTOOL_API_KEY"     : null,
    !account ? "FBTOOL_ACCOUNT_ID"  : null,
  ].filter((v): v is string => v !== null);

  const dates = `${dateRange.from} - ${dateRange.to}`;

  return buildFbtoolApiError({
    statusCode: 0,
    errorMessage: `Missing required environment variable(s): ${missing.join(", ")}. Request was not sent.`,
    rawBody: "",
    accountId: account ?? "(missing)",
    dateRange,
    requestParams: {
      missingEnvVars: missing,
      requestUrl: redactedRequestUrl(account ?? "(missing)", dates),
    },
  });
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const requestedSheet = searchParams.get("sheet") ?? undefined;

    const mvpResult = await loadMvpRows("campaign", "weekly", requestedSheet);
    if (!mvpResult) {
      return NextResponse.json(
        {
          error:
            "MVP data not found. Set MVP_CAMPAIGN_WEEKLY_XLSX_URL (or MVP_CAMPAIGN_WEEKLY_CSV_URL), " +
            "or set REPORTS_ALLOW_TEST_DATA_FALLBACK=true to use local test-data/mvp/ for development.",
        },
        { status: 404 }
      );
    }

    // Auto Report's only intended FBTool source is the API, which requires a date-range sheet.
    const dateRange = parseDateRange(mvpResult.selectedSheet);
    if (!dateRange) {
      return NextResponse.json(
        {
          error:
            "Auto Report requires a date-range sheet. Select a sheet like 2026-06-29_2026-07-05.",
          sheets: mvpResult.sheets,
          selectedSheet: mvpResult.selectedSheet,
        },
        { status: 400 }
      );
    }

    const hasFbtoolCreds = !!(process.env.FBTOOL_API_KEY && process.env.FBTOOL_ACCOUNT_ID);

    let fbCampaigns: FbtoolCampaign[] = [];
    let apiErrors: FbtoolApiError[]   = [];
    let fbtoolFilename: string;
    let fbtoolSource: "api" | "local";

    if (hasFbtoolCreds) {
      const ft = await callFbtoolApi(dateRange);
      fbCampaigns    = ft.campaigns;
      apiErrors      = ft.apiErrors;
      fbtoolFilename = "FBTool API";
      fbtoolSource   = "api";
    } else if (allowTestDataFallback()) {
      // Explicit dev opt-in only — never triggered silently
      const fbtoolPath = findLatestFile(path.join(process.cwd(), "test-data", "fbtool"), ".json");
      if (!fbtoolPath) {
        return NextResponse.json(
          {
            error: "REPORTS_ALLOW_TEST_DATA_FALLBACK is enabled but no file was found in test-data/fbtool/.",
            sheets: mvpResult.sheets,
            selectedSheet: mvpResult.selectedSheet,
          },
          { status: 404 }
        );
      }
      fbCampaigns    = parseFbtoolReport(JSON.parse(fs.readFileSync(fbtoolPath, "utf8")) as unknown);
      fbtoolFilename = path.basename(fbtoolPath);
      fbtoolSource   = "local";
    } else {
      // Default, production behavior: no silent fallback — surface the missing config as an API error
      apiErrors      = [buildMissingEnvError(dateRange)];
      fbtoolFilename = "FBTool API";
      fbtoolSource   = "api";
    }

    const { rows, summary } = buildReportRows(mvpResult.rows, fbCampaigns);
    const matchedCount = rows.filter((r) => r.sourceStatus === "matched").length;

    const warnings: string[] = [];
    if (mvpResult.rows.length === 0 && (mvpResult.mvpDebug?.rawRowCount ?? 0) > 0) {
      warnings.push(
        `MVP sheet has ${mvpResult.mvpDebug?.rawRowCount} rows but 0 campaign IDs were parsed. ` +
        `Check "Detected columns" below — the ID column may not have been recognized.`
      );
    }
    if (fbCampaigns.length > 0 && mvpResult.rows.length > 0 && matchedCount === 0) {
      warnings.push(
        `${fbCampaigns.length} FBTool campaigns and ${mvpResult.rows.length} MVP campaigns loaded, ` +
        `but 0 matched by campaign_id. Check ID formatting (whitespace, .0 suffix, leading zeros).`
      );
    }

    const debug = {
      selectedSheet: mvpResult.selectedSheet,
      mvpRawRowCount: mvpResult.mvpDebug?.rawRowCount ?? mvpResult.rows.length,
      mvpFirst5RawRows: mvpResult.mvpDebug?.first5RawRows ?? [],
      mvpDetectedColumns: mvpResult.mvpDebug?.detectedColumns ?? null,
      mvpParsedCampaignIds: mvpResult.mvpDebug?.parsedCampaignIds ?? mvpResult.rows.slice(0, 10).map((r) => r.campaignId),
      mvpParsedCount: mvpResult.rows.length,
      fbtoolCampaignCount: fbCampaigns.length,
      fbtoolFirst10CampaignIds: fbCampaigns.slice(0, 10).map((c) => c.campaignId),
      matchedCount,
      warnings,
    };

    return NextResponse.json({
      rows,
      summary,
      generatedAt: new Date().toISOString(),
      dataFile: { mvp: mvpResult.filename, fbtool: fbtoolFilename },
      sheets: mvpResult.sheets,
      selectedSheet: mvpResult.selectedSheet,
      dateRange,
      fbtoolSource,
      apiErrors,
      debug,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Reports API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
