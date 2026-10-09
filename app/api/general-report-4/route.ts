import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { fetchRanges, listSheetTitles } from "@/lib/general-report/googleSheets";
import { BUYER_RANGE, BUYER_SHEETS, BUYER_TARGETS, MAIN_RANGES, parseBuyer, parseMain } from "@/lib/general-report-4/parse";
import { collectSources4, publicSources4 } from "@/lib/general-report-4/sources";
import type { Gr4Kind, Gr4Row, Gr4SourceInfo, Gr4Targets } from "@/lib/general-report-4/types";

// GR 4.0: одна общая таблица или таблица баера, плоский формат. Читается одним
// batchGet, кэш 5 минут по ключу таблицы — как у GR 3.0.

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { rows: Gr4Row[]; targets: Gr4Targets; at: number }>();

async function load(spreadsheetId: string, kind: Gr4Kind) {
  const hit = cache.get(spreadsheetId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit, fromCache: true };

  let parsed;
  if (kind === "main") {
    const [traffic, deps, crm, targets] = await fetchRanges(spreadsheetId, Object.values(MAIN_RANGES));
    parsed = parseMain({ traffic, deps, crm, targets });
  } else {
    // «Истории» нет у новых баеров и в шаблоне. Запрос несуществующего листа
    // роняет весь batchGet, поэтому сначала смотрим, какие листы есть.
    const titles = await listSheetTitles(spreadsheetId);
    const sheets = BUYER_SHEETS.filter((s) => titles.includes(s));
    if (!sheets.includes("Ввод")) throw new Error("В таблице нет листа «Ввод» — это не таблица баера GR 4.0");
    const values = await fetchRanges(spreadsheetId, [...sheets.map(BUYER_RANGE), BUYER_TARGETS]);
    parsed = parseBuyer(values.slice(0, -1), values.at(-1));
  }

  const entry = { ...parsed, at: Date.now() };
  cache.set(spreadsheetId, entry);
  return { ...entry, fromCache: false };
}

export async function GET(req: Request) {
  // Список источников уходит и в ответе с ошибкой: иначе со сломанной таблицы
  // нечем переключиться на рабочую.
  let sources: Gr4SourceInfo[] = [];
  try {
    const me = await getProfile();
    if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });

    const all = await collectSources4(me);
    sources = publicSources4(all);
    if (all.length === 0) {
      return NextResponse.json({ error: "Ни одной таблицы GR 4.0 не подключено", sources }, { status: 403 });
    }

    // Источник — только из того, что положено этому человеку, а не из запроса.
    const requested = new URL(req.url).searchParams.get("source");
    const src = all.find((s) => s.id === requested) ?? all[0];
    const data = await load(src.spreadsheetId, src.kind);

    return NextResponse.json({
      source: src.id,
      sources,
      kind: src.kind,
      rows: data.rows,
      targets: data.targets,
      generatedAt: new Date(data.at).toISOString(),
      fetchedFrom: data.fromCache ? "cache" : "api",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, sources }, { status: 500 });
  }
}
