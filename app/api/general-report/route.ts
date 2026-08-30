import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { listCountrySheets, fetchSheetValues } from "@/lib/general-report/googleSheets";
import { parseCountrySheet } from "@/lib/general-report/parseCountrySheet";
import { parseWaSheet } from "@/lib/general-report/parseWaSheet";
import { mergeDayRows } from "@/lib/general-report/aggregate";
import { collectSources, publicSources, resolveSource, summarySources } from "@/lib/general-report/sources";
import type { GrDayRow, WaDayRow } from "@/lib/general-report/types";

const CACHE_TTL_MS = 5 * 60_000;
// Ключ кэша — сам spreadsheetId, а не имя источника. Одна таблица, подключённая
// двум людям, читается один раз, а разные таблицы под одним именем не перепутать.
const cache = new Map<string, { rows: GrDayRow[]; countries: string[]; at: number }>();
const waCache = new Map<string, { rows: WaDayRow[]; countries: string[]; at: number }>();

async function loadCountry(spreadsheetId: string) {
  const hit = cache.get(spreadsheetId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit, fromCache: true };

  const titles = await listCountrySheets(spreadsheetId);
  const valuesBySheet = await fetchSheetValues(spreadsheetId, titles);

  const rows: GrDayRow[] = [];
  for (const [title, values] of valuesBySheet) rows.push(...parseCountrySheet(title, values));

  const entry = { rows, countries: titles, at: Date.now() };
  cache.set(spreadsheetId, entry);
  return { ...entry, fromCache: false };
}

async function loadWa(spreadsheetId: string) {
  const hit = waCache.get(spreadsheetId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit, fromCache: true };

  const titles = await listCountrySheets(spreadsheetId);
  const valuesBySheet = await fetchSheetValues(spreadsheetId, titles);

  const rows: WaDayRow[] = [];
  for (const [title, values] of valuesBySheet) rows.push(...parseWaSheet(title, values));

  const entry = { rows, countries: titles, at: Date.now() };
  waCache.set(spreadsheetId, entry);
  return { ...entry, fromCache: false };
}

export async function GET(req: Request) {
  // Список источников собирается отдельно от загрузки данных и попадает даже в
  // ответ с ошибкой. Иначе упавшая «Сводная» оставляла страницу без единой
  // кнопки: переключиться на рабочую таблицу было нечем, а перезагрузка
  // повторяла ту же «Сводную» и ту же ошибку.
  let sources: ReturnType<typeof publicSources> = [];

  try {
    const me = await getProfile();
    if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });

    // Список доступного считается по роли, а не берётся из запроса. Источник,
    // которого нет в этом списке, не откроется, даже если его id подобрали.
    // Собирается один раз за запрос: раньше «Сводная» перечитывала его заново и
    // резолвила каждую таблицу отдельным походом в Supabase.
    const all = await collectSources(me);
    sources = publicSources(all);
    if (sources.length === 0) {
      return NextResponse.json(
        { error: "Ни одной таблицы не подключено", sources: [] },
        { status: 403 }
      );
    }

    const requested = new URL(req.url).searchParams.get("source");
    // По умолчанию — Сводная, как было до переезда источников в базу. Иначе
    // отчёт открывался бы на первой попавшейся таблице.
    const fallback = sources.find((s) => s.id === "summary")?.id ?? sources[0].id;
    const source = sources.find((s) => s.id === requested)?.id ?? fallback;

    if (source === "summary") {
      const parts = summarySources(all);
      const loaded = await Promise.all(parts.map((p) => loadCountry(p.spreadsheetId)));
      return NextResponse.json({
        source,
        sources,
        kind: "country",
        rows: mergeDayRows(loaded.map((l) => l.rows)),
        countries: [...new Set(loaded.flatMap((l) => l.countries))],
        generatedAt: new Date().toISOString(),
        fetchedFrom: loaded.every((l) => l.fromCache) ? "cache" : "api",
      });
    }

    const resolved = resolveSource(all, source);
    if (!resolved) {
      return NextResponse.json({ error: "Таблица не подключена", sources }, { status: 404 });
    }

    const { rows, countries, fromCache } =
      resolved.kind === "wa" ? await loadWa(resolved.spreadsheetId) : await loadCountry(resolved.spreadsheetId);

    return NextResponse.json({
      source,
      sources,
      kind: resolved.kind,
      rows,
      countries,
      generatedAt: new Date().toISOString(),
      fetchedFrom: fromCache ? "cache" : "api",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("General report API error:", message);
    return NextResponse.json({ error: message, sources }, { status: 500 });
  }
}
