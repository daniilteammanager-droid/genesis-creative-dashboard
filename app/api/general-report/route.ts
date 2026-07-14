import { NextResponse } from "next/server";
import { listCountrySheets, fetchSheetValues } from "@/lib/general-report/googleSheets";
import { parseCountrySheet } from "@/lib/general-report/parseCountrySheet";
import { mergeDayRows } from "@/lib/general-report/aggregate";
import type { GrDayRow, GrSource } from "@/lib/general-report/types";

const SPREADSHEET_ENV: Record<Exclude<GrSource, "summary">, string> = {
  main:   "GR_SPREADSHEET_MAIN",
  artem:  "GR_SPREADSHEET_ARTEM",
  matvey: "GR_SPREADSHEET_MATVEY",
  andrey: "GR_SPREADSHEET_ANDREY",
};

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { rows: GrDayRow[]; countries: string[]; at: number }>();

async function loadSource(source: Exclude<GrSource, "summary">) {
  const hit = cache.get(source);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit, fromCache: true };

  const spreadsheetId = process.env[SPREADSHEET_ENV[source]];
  if (!spreadsheetId) throw new Error(`Missing env var ${SPREADSHEET_ENV[source]}`);

  const titles = await listCountrySheets(spreadsheetId);
  const valuesBySheet = await fetchSheetValues(spreadsheetId, titles);

  const rows: GrDayRow[] = [];
  for (const [title, values] of valuesBySheet) {
    rows.push(...parseCountrySheet(title, values));
  }

  const entry = { rows, countries: titles, at: Date.now() };
  cache.set(source, entry);
  return { ...entry, fromCache: false };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const source = (searchParams.get("source") ?? "summary") as GrSource;

    if (source === "summary") {
      const buyers = ["artem", "matvey", "andrey"] as const;
      const loaded = await Promise.all(buyers.map(loadSource));
      const rows = mergeDayRows(loaded.map((l) => l.rows));
      const countries = [...new Set(loaded.flatMap((l) => l.countries))];
      return NextResponse.json({
        source,
        rows,
        countries,
        generatedAt: new Date().toISOString(),
        fetchedFrom: loaded.every((l) => l.fromCache) ? "cache" : "api",
      });
    }

    if (!(source in SPREADSHEET_ENV)) {
      return NextResponse.json({ error: `Unknown source: ${source}` }, { status: 400 });
    }

    const { rows, countries, fromCache } = await loadSource(source);
    return NextResponse.json({
      source,
      rows,
      countries,
      generatedAt: new Date().toISOString(),
      fetchedFrom: fromCache ? "cache" : "api",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("General report API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
