import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { COMBINED_ID, collectSources4, publicSources4 } from "@/lib/general-report-4/sources";
import { snapshot, syncSheet } from "@/lib/general-report-4/store";
import type { Gr4Kind, Gr4SourceInfo } from "@/lib/general-report-4/types";

// GR 4.0 читает свою базу (Decision 084): снимки таблиц обновляет крон раз в 15
// минут. refresh=1 — «Обновить из таблиц»: перечитать нужные таблицы по API сейчас.
// report=1 — для вкладки «Отчёт»: общая таблица и таблицы баеров вместе, чтобы
// разложить выплаты по баерам (lib/general-report-4/allocate.ts).

export const maxDuration = 120;

const get = (id: string, kind: Gr4Kind, refresh: boolean) => (refresh ? syncSheet(id, kind) : snapshot(id, kind));

// Сводная по баерам: таблицы всех баеров одной выборкой.
// Баер в строке — из колонки «Баер» его таблицы; пусто — имя из профиля.
async function loadCombined(all: Awaited<ReturnType<typeof collectSources4>>, refresh: boolean) {
  const buyers = all.filter((s) => s.kind === "buyer" && !s.combined);
  const parts = await Promise.all(buyers.map(async (b) => ({ b, d: await get(b.spreadsheetId, "buyer", refresh) })));
  return {
    rows: parts.flatMap(({ b, d }) => d.rows.map((r) => (r.buyer ? r : { ...r, buyer: b.label }))),
    targets: parts[0]?.d.targets ?? { costPerSub: null, costPerDialog: null, crToDialog: null, crDialogToDep: null },
    at: Math.min(...parts.map(({ d }) => d.at)),
    error: parts.map(({ b, d }) => (d.error ? `${b.label}: ${d.error}` : "")).filter(Boolean).join("; ") || null,
  };
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
    const p = new URL(req.url).searchParams;
    const refresh = p.get("refresh") === "1";

    // Отчёт владельца и тимлида: общая + все баеры.
    const mainSrc = all.find((s) => s.kind === "main");
    if (p.get("report") === "1" && mainSrc) {
      const [main, buyers] = await Promise.all([get(mainSrc.spreadsheetId, "main", refresh), loadCombined(all, refresh)]);
      return NextResponse.json({
        sources, report: true, main: main.rows, buyers: buyers.rows, targets: main.targets,
        generatedAt: new Date(Math.min(main.at, buyers.at)).toISOString(),
        syncError: [main.error, buyers.error].filter(Boolean).join("; ") || null,
      });
    }

    // Источник — только из того, что положено этому человеку, а не из запроса.
    const src = all.find((s) => s.id === p.get("source")) ?? all[0];
    const data = src.id === COMBINED_ID ? await loadCombined(all, refresh) : await get(src.spreadsheetId, src.kind, refresh);

    return NextResponse.json({
      source: src.id,
      sources,
      kind: src.kind,
      combined: src.combined ?? false,
      rows: data.rows,
      targets: data.targets,
      generatedAt: new Date(data.at).toISOString(),
      fetchedFrom: refresh ? "api" : "db",
      syncError: data.error,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, sources }, { status: 500 });
  }
}
