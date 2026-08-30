import { createClient } from "@/lib/auth/server";
import type { Profile } from "@/lib/auth/types";
import type { GrKind } from "./types";

// Откуда берутся источники сводного отчёта.
//
// Раньше список был зашит: три общие таблицы из GR_SPREADSHEET_* и четыре
// байерские, тоже из env, по именам людей. Новая таблица означала деплой, а
// разграничить их было нечем — из переменной не видно, чья она.
//
// Теперь общие таблицы лежат в gr_spreadsheets, байерские — в профилях, а кто
// что видит, решает роль.

export interface GrSourceInfo {
  id: string;                       // "sheet:<uuid>" | "buyer:<id>" | "summary"
  label: string;
  group: "common" | "buyers";
  kind: GrKind;
}

export interface ResolvedSource {
  spreadsheetId: string;
  kind: GrKind;
}

// Пока список пуст, отчёт продолжает работать на переменных окружения. Так
// перенос не требует простоя: добавил первую таблицу — источником стала база.
const ENV_FALLBACK: { id: string; label: string; env: string; kind: GrKind }[] = [
  { id: "env:main",  label: "🇪🇺 EU",    env: "GR_SPREADSHEET_MAIN",  kind: "country" },
  { id: "env:latam", label: "🌎 LATAM", env: "GR_SPREADSHEET_LATAM", kind: "country" },
  { id: "env:wa",    label: "💬 WA",    env: "GR_SPREADSHEET_WA",    kind: "wa" },
];

const ENV_BUYER_FALLBACK: { id: string; label: string; env: string }[] = [
  { id: "env:artem",  label: "Артём",  env: "GR_SPREADSHEET_ARTEM" },
  { id: "env:matvey", label: "Матвей", env: "GR_SPREADSHEET_MATVEY" },
  { id: "env:andrey", label: "Андрей", env: "GR_SPREADSHEET_ANDREY" },
  { id: "env:sayan",  label: "Саян",   env: "GR_SPREADSHEET_SAYAN" },
];

function envSources(list: { id: string; label: string; env: string; kind?: GrKind }[]) {
  return list
    .filter((s) => process.env[s.env])
    .map((s) => ({ id: s.id, label: s.label, kind: s.kind ?? ("country" as GrKind) }));
}

// Все источники, доступные этому человеку, в порядке показа.
export async function listSources(me: Profile): Promise<GrSourceInfo[]> {
  // Баер видит ровно одну таблицу — свою. Общих команды он не видит вовсе.
  if (me.role === "buyer") {
    return me.gr_spreadsheet_id
      ? [{ id: "buyer:me", label: "Моя таблица", group: "common", kind: "country" }]
      : [];
  }

  const supabase = await createClient();
  const out: GrSourceInfo[] = [];

  const { data: sheets } = await supabase
    .from("gr_spreadsheets")
    .select("id, name, kind, sort")
    .order("sort", { ascending: true })
    .order("created_at", { ascending: true });

  if (sheets && sheets.length > 0) {
    for (const s of sheets) {
      out.push({ id: `sheet:${s.id}`, label: s.name, group: "common", kind: s.kind as GrKind });
    }
  } else {
    for (const s of envSources(ENV_FALLBACK)) out.push({ ...s, group: "common" });
  }

  const { data: buyers } = await supabase
    .from("profiles")
    .select("id, name, email, buyer_code, gr_spreadsheet_id")
    .eq("role", "buyer")
    .not("gr_spreadsheet_id", "is", null)
    .order("buyer_code", { ascending: true });

  const buyerSources: GrSourceInfo[] = (buyers ?? []).map((b) => ({
    id: `buyer:${b.id}`,
    label: b.name || b.buyer_code || b.email,
    group: "buyers",
    kind: "country" as GrKind,
  }));

  // Ни одному баеру таблицу ещё не подключили — держимся за env, чтобы отчёт
  // не опустел на время переноса.
  if (buyerSources.length === 0) {
    for (const s of envSources(ENV_BUYER_FALLBACK)) buyerSources.push({ ...s, group: "buyers" });
  }

  if (buyerSources.length > 0) {
    // Сводная считается по байерским таблицам, поэтому и стоит первой среди них.
    out.push({ id: "summary", label: "Сводная", group: "buyers", kind: "country" });
    out.push(...buyerSources);
  }

  return out;
}

// Конкретная таблица под id. Возвращает null, если источник этому человеку не
// положен — проверка по списку доступного, а не по переданной строке.
export async function resolveSource(me: Profile, id: string): Promise<ResolvedSource | null> {
  if (me.role === "buyer") {
    return id === "buyer:me" && me.gr_spreadsheet_id
      ? { spreadsheetId: me.gr_spreadsheet_id, kind: "country" }
      : null;
  }

  if (id.startsWith("env:")) {
    const all = [...ENV_FALLBACK, ...ENV_BUYER_FALLBACK.map((b) => ({ ...b, kind: "country" as GrKind }))];
    const hit = all.find((s) => s.id === id);
    const value = hit && process.env[hit.env];
    return value ? { spreadsheetId: value, kind: hit.kind } : null;
  }

  if (id.startsWith("sheet:")) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("gr_spreadsheets")
      .select("spreadsheet_id, kind")
      .eq("id", id.slice("sheet:".length))
      .maybeSingle();
    return data ? { spreadsheetId: data.spreadsheet_id, kind: data.kind as GrKind } : null;
  }

  if (id.startsWith("buyer:")) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("gr_spreadsheet_id")
      .eq("id", id.slice("buyer:".length))
      .maybeSingle();
    return data?.gr_spreadsheet_id ? { spreadsheetId: data.gr_spreadsheet_id, kind: "country" } : null;
  }

  return null;
}

// Источники, из которых собирается «Сводная».
export async function summarySources(me: Profile): Promise<ResolvedSource[]> {
  const buyers = (await listSources(me)).filter((s) => s.group === "buyers" && s.id !== "summary");
  const resolved = await Promise.all(buyers.map((s) => resolveSource(me, s.id)));
  return resolved.filter((r): r is ResolvedSource => r !== null);
}
