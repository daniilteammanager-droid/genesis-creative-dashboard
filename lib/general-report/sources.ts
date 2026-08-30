import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/auth/server";
import type { Profile } from "@/lib/auth/types";
import type { GrKind } from "./types";

// Откуда берутся источники сводного отчёта.
//
// Раньше список был зашит: три общие таблицы из GR_SPREADSHEET_* и четыре
// байерские, тоже из env, по именам людей. Новая таблица означала деплой, а
// разграничить их было нечем — из переменной не видно, чья она.
//
// Теперь общие таблицы лежат в gr_spreadsheets, байерские — в профилях. Env
// остаётся как ещё один источник списка, а не как «режим до переезда»: см.
// правило слияния ниже.

export interface GrSourceInfo {
  id: string;                       // "sheet:<uuid>" | "buyer:<uuid>" | "env:*" | "summary"
  label: string;
  group: "common" | "buyers";
  kind: GrKind;
}

// То же самое плюс сама таблица. Наружу не отдаётся: список источников уезжает
// в браузер, а ключи чужих таблиц там незачем.
interface InternalSource extends GrSourceInfo {
  spreadsheetId?: string;           // у «Сводной» своей таблицы нет
}

export interface ResolvedSource {
  spreadsheetId: string;
  kind: GrKind;
}

const ENV_COMMON: { id: string; label: string; env: string; kind: GrKind }[] = [
  { id: "env:main",  label: "🇪🇺 EU",    env: "GR_SPREADSHEET_MAIN",  kind: "country" },
  { id: "env:latam", label: "🌎 LATAM", env: "GR_SPREADSHEET_LATAM", kind: "country" },
  { id: "env:wa",    label: "💬 WA",    env: "GR_SPREADSHEET_WA",    kind: "wa" },
];

const ENV_BUYERS: { id: string; label: string; env: string }[] = [
  { id: "env:artem",  label: "Артём",  env: "GR_SPREADSHEET_ARTEM" },
  { id: "env:matvey", label: "Матвей", env: "GR_SPREADSHEET_MATVEY" },
  { id: "env:andrey", label: "Андрей", env: "GR_SPREADSHEET_ANDREY" },
  { id: "env:sayan",  label: "Саян",   env: "GR_SPREADSHEET_SAYAN" },
];

// Таблицы из env, которых ещё нет в базе. Вынесено отдельно и накрыто
// самопроверкой (sources.test.ts): именно здесь ошибка не роняет отчёт, а тихо
// убирает источник из «Сводной» — суммы становятся меньше и правдоподобнее.
export function envExtras(
  list: { id: string; label: string; env: string; kind: GrKind }[],
  known: Set<string>,
  group: "common" | "buyers"
): InternalSource[] {
  const seen = new Set(known);
  const out: InternalSource[] = [];
  for (const e of list) {
    const spreadsheetId = process.env[e.env];
    // Пустая переменная — не источник. Уже известная таблица — не дубль:
    // одна и та же таблица не должна попасть в «Сводную» дважды.
    if (!spreadsheetId || seen.has(spreadsheetId)) continue;
    seen.add(spreadsheetId);
    out.push({ id: e.id, label: e.label, group, kind: e.kind, spreadsheetId });
  }
  return out;
}

// Список баеров читается сервисным ключом нарочно. Политика profiles_select
// показывает тимлиду только закреплённых за ним, а видеть отчёт он должен по
// всей команде (Decision 035). Если брать список обычным клиентом, у тимлида он
// окажется пустым — и состав «Сводной» у него молча разойдётся с владельцем.
function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Не заданы NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

// Все источники этого человека вместе с таблицами. Единственное место, где
// решается, кому что положено.
export async function collectSources(me: Profile): Promise<InternalSource[]> {
  // Баер видит ровно одну таблицу — свою. Общих команды он не видит вовсе.
  if (me.role === "buyer") {
    return me.gr_spreadsheet_id
      ? [{ id: "buyer:me", label: "Моя таблица", group: "common", kind: "country",
           spreadsheetId: me.gr_spreadsheet_id }]
      : [];
  }

  const out: InternalSource[] = [];

  // ─── Общие таблицы ─────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: sheets } = await supabase
    .from("gr_spreadsheets")
    .select("id, name, spreadsheet_id, kind, created_at")
    .order("sort", { ascending: true })
    .order("created_at", { ascending: true });

  for (const s of sheets ?? []) {
    out.push({ id: `sheet:${s.id}`, label: s.name, group: "common",
               kind: s.kind as GrKind, spreadsheetId: s.spreadsheet_id });
  }

  // ─── Байерские таблицы ─────────────────────────────────────────────────────
  const { data: buyers } = await serviceClient()
    .from("profiles")
    .select("id, name, email, buyer_code, gr_spreadsheet_id")
    .eq("role", "buyer")
    .not("gr_spreadsheet_id", "is", null)
    .order("buyer_code", { ascending: true });

  const buyerSources: InternalSource[] = (buyers ?? []).map((b) => ({
    id: `buyer:${b.id}`,
    label: b.name || b.buyer_code || b.email,
    group: "buyers" as const,
    kind: "country" as GrKind,
    spreadsheetId: b.gr_spreadsheet_id as string,
  }));

  // ─── Переменные окружения ──────────────────────────────────────────────────
  // Правило: env добавляет только те таблицы, которых ещё нет в базе, и никогда
  // не отключается целиком.
  //
  // Раньше здесь стоял выключатель «пока в базе пусто — берём env». Он ломался
  // на половине переноса: подключил таблицу одному баеру — и три остальные
  // исчезали разом. Отчёт при этом не падал, а показывал меньшие суммы. Такое
  // не замечают: цифра правдоподобная, просто неверная.
  const known = new Set(
    out.concat(buyerSources).map((s) => s.spreadsheetId).filter((v): v is string => Boolean(v))
  );

  out.push(...envExtras(ENV_COMMON, known, "common"));
  buyerSources.push(
    ...envExtras(ENV_BUYERS.map((e) => ({ ...e, kind: "country" as GrKind })), known, "buyers")
  );

  if (buyerSources.length > 0) {
    // Сводная считается по байерским таблицам, поэтому и стоит первой среди них.
    out.push({ id: "summary", label: "Сводная", group: "buyers", kind: "country" });
    out.push(...buyerSources);
  }

  return out;
}

// То же для браузера — без ключей таблиц.
export function publicSources(all: InternalSource[]): GrSourceInfo[] {
  return all.map(({ id, label, group, kind }) => ({ id, label, group, kind }));
}

export async function listSources(me: Profile): Promise<GrSourceInfo[]> {
  return publicSources(await collectSources(me));
}

// Конкретная таблица под id — только из того, что этому человеку положено.
// Проверка по собранному списку, а не по переданной строке.
export function resolveSource(all: InternalSource[], id: string): ResolvedSource | null {
  const hit = all.find((s) => s.id === id);
  return hit?.spreadsheetId ? { spreadsheetId: hit.spreadsheetId, kind: hit.kind } : null;
}

// Источники, из которых собирается «Сводная».
export function summarySources(all: InternalSource[]): ResolvedSource[] {
  return all
    .filter((s) => s.group === "buyers" && s.id !== "summary" && s.spreadsheetId)
    .map((s) => ({ spreadsheetId: s.spreadsheetId as string, kind: s.kind }));
}
