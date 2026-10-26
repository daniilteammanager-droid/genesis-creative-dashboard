import { createClient } from "@supabase/supabase-js";
import { fetchRanges, listSheetTitles } from "@/lib/general-report/googleSheets";
import { BUYER_RANGE, BUYER_SHEETS, BUYER_TARGETS, MAIN_RANGES, parseBuyer, parseMain } from "./parse";
import type { Gr4Kind, Gr4Row, Gr4Targets } from "./types";

// Снимки таблиц GR4 в базе (Decision 084). Читает Sheets API только синхронизация —
// крон раз в 15 минут и кнопка «Обновить из таблиц»; страница — из базы.

export interface Snapshot { rows: Gr4Row[]; targets: Gr4Targets; at: number; error: string | null }

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Не заданы NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

// Прочитать таблицу по API и разобрать. Один batchGet на таблицу.
async function readSheet(spreadsheetId: string, kind: Gr4Kind) {
  if (kind === "main") {
    const [traffic, deps, crm, targets] = await fetchRanges(spreadsheetId, Object.values(MAIN_RANGES));
    return parseMain({ traffic, deps, crm, targets });
  }
  // «Истории» нет у новых баеров и в шаблоне. Запрос несуществующего листа
  // роняет весь batchGet, поэтому сначала смотрим, какие листы есть.
  const titles = await listSheetTitles(spreadsheetId);
  const sheets = BUYER_SHEETS.filter((s) => titles.includes(s));
  if (!sheets.includes("Ввод")) throw new Error("В таблице нет листа «Ввод» — это не таблица баера GR 4.0");
  const values = await fetchRanges(spreadsheetId, [...sheets.map(BUYER_RANGE), BUYER_TARGETS]);
  return parseBuyer(values.slice(0, -1), values.at(-1));
}

// Перечитать таблицу и положить снимок. Ошибка — пишется рядом, прежний снимок остаётся.
export async function syncSheet(spreadsheetId: string, kind: Gr4Kind): Promise<Snapshot> {
  try {
    const p = await readSheet(spreadsheetId, kind);
    const at = new Date();
    const { error } = await db().from("gr4_snapshots").upsert({ spreadsheet_id: spreadsheetId, kind, rows: p.rows, targets: p.targets, synced_at: at.toISOString(), error: null });
    if (error) throw new Error(error.message);
    return { ...p, at: at.getTime(), error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db().from("gr4_snapshots").update({ error: msg.slice(0, 500) }).eq("spreadsheet_id", spreadsheetId);
    throw e;
  }
}

// Снимок из базы; нет ещё — первый раз читаем таблицу сами.
export async function snapshot(spreadsheetId: string, kind: Gr4Kind): Promise<Snapshot> {
  const { data } = await db().from("gr4_snapshots").select("rows, targets, synced_at, error").eq("spreadsheet_id", spreadsheetId).maybeSingle();
  if (!data) return syncSheet(spreadsheetId, kind);
  return { rows: data.rows as Gr4Row[], targets: data.targets as Gr4Targets, at: Date.parse(data.synced_at as string), error: data.error as string | null };
}

// Все таблицы GR4 команды: общая и таблицы баеров. Для крона.
export async function syncAll(): Promise<{ sheets: number; errors: string[] }> {
  const [{ data: main }, { data: buyers }] = await Promise.all([
    db().from("gr_spreadsheets").select("spreadsheet_id").eq("kind", "v4"),
    db().from("profiles").select("name, gr4_spreadsheet_id").not("gr4_spreadsheet_id", "is", null),
  ]);
  const list: { id: string; kind: Gr4Kind; label: string }[] = [
    ...(main ?? []).map((m) => ({ id: m.spreadsheet_id as string, kind: "main" as const, label: "общая" })),
    ...(buyers ?? []).map((b) => ({ id: b.gr4_spreadsheet_id as string, kind: "buyer" as const, label: b.name as string })),
  ];
  const errors: string[] = [];
  for (const s of list) {
    try { await syncSheet(s.id, s.kind); } catch (e) { errors.push(`${s.label}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return { sheets: list.length, errors };
}
