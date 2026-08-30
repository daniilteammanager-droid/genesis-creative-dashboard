import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { listCountrySheets, fetchSheetValues } from "@/lib/general-report/googleSheets";
import { parseCountrySheet } from "@/lib/general-report/parseCountrySheet";
import { parseWaSheet } from "@/lib/general-report/parseWaSheet";
import { mergeDayRows } from "@/lib/general-report/aggregate";
import type { GrDayRow, GrSource, WaDayRow } from "@/lib/general-report/types";

// Country-sheet sources — same column layout, same parser.
type CountrySource = Exclude<GrSource, "summary" | "wa">;

const SPREADSHEET_ENV: Record<CountrySource, string> = {
  main:   "GR_SPREADSHEET_MAIN",
  latam:  "GR_SPREADSHEET_LATAM",
  artem:  "GR_SPREADSHEET_ARTEM",
  matvey: "GR_SPREADSHEET_MATVEY",
  andrey: "GR_SPREADSHEET_ANDREY",
  sayan:  "GR_SPREADSHEET_SAYAN",
};

const BUYERS = ["artem", "matvey", "andrey", "sayan"] as const;

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { rows: GrDayRow[]; countries: string[]; at: number }>();
const waCache = new Map<string, { rows: WaDayRow[]; countries: string[]; at: number }>();

async function loadSource(source: CountrySource) {
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

async function loadWa() {
  const hit = waCache.get("wa");
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit, fromCache: true };

  const spreadsheetId = process.env.GR_SPREADSHEET_WA;
  if (!spreadsheetId) throw new Error("Missing env var GR_SPREADSHEET_WA");

  const titles = await listCountrySheets(spreadsheetId);
  const valuesBySheet = await fetchSheetValues(spreadsheetId, titles);

  const rows: WaDayRow[] = [];
  for (const [title, values] of valuesBySheet) {
    rows.push(...parseWaSheet(title, values));
  }

  const entry = { rows, countries: titles, at: Date.now() };
  waCache.set("wa", entry);
  return { ...entry, fromCache: false };
}

const DENIED = "Раздел работает по твоим подключениям, а их пока нет";

export async function GET(req: Request) {
  try {
    // Проверка стоит и здесь, а не только в layout страницы: роут вызывается
    // напрямую, и спрятанная страница ничего не закрывает.
    const me = await getProfile();
    if (!me || me.role === "buyer") {
      return NextResponse.json({ error: DENIED }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const source = (searchParams.get("source") ?? "summary") as GrSource;

    if (source === "wa") {
      const { rows, countries, fromCache } = await loadWa();
      return NextResponse.json({
        source,
        kind: "wa",
        rows,
        countries,
        generatedAt: new Date().toISOString(),
        fetchedFrom: fromCache ? "cache" : "api",
      });
    }

    if (source === "summary") {
      const loaded = await Promise.all(BUYERS.map(loadSource));
      const rows = mergeDayRows(loaded.map((l) => l.rows));
      const countries = [...new Set(loaded.flatMap((l) => l.countries))];
      return NextResponse.json({
        source,
        kind: "country",
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
      kind: "country",
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
