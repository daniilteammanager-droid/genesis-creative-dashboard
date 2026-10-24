import type { CrmNumbers } from "@/lib/warehouse/parseCrm";

// Torro CRM через его MCP-сервер, а не через выгрузки в Google-таблицы.
//
// MCP здесь — обычный JSON-RPC поверх HTTP: один POST с методом tools/call.
// Ключ у каждого баера свой, и каждый запрос дополнительно режется его id
// в Torro — иначе ключ с широкими правами отдал бы цифры всей команды.

const MCP_URL = "https://api.torrocrm.com/api/v1/mcp/";
// Torro отдаёт не больше 100 строк за раз, summary при этом — по всему периоду.
const ROW_CAP = 100;

export type TorroGroupBy = "ad_name" | "campaign_name" | "country";

export interface TorroRow {
  group: string;
  click?: number; sub?: number; unsub?: number; chat?: number; reg?: number;
  dep_count?: number; dep_summary?: number; redep_count?: number; redep_summary?: number;
  [k: string]: unknown;
}

interface TorroPayload {
  rows: TorroRow[];
  summary: Record<string, number>;
  rows_total?: number;
  truncated?: boolean;
}

interface Query {
  token: string;
  buyerId: number;
  day: string;              // YYYY-MM-DD
  groupBy: TorroGroupBy;
  country?: string[];
  campaignName?: string[];
  adName?: string[];
}

// Любой инструмент Torro MCP: JSON-RPC tools/call, ответ — один текстовый блок с JSON.
//
// Torro режет частоту: ручной прогон и крон подряд дали «Torro: rate_limited» и
// упавший прогон (24.10.2026). На это — пауза и повтор, а не ошибка сразу.
const RATE_WAITS_MS = [5_000, 15_000, 30_000];
export const rateLimited = (e: unknown) => e instanceof Error && /rate.?limit|HTTP 429/i.test(e.message);

// patient = false — без повторов на лимите: фоновая работа (связки) уступает
// основной загрузке и просто ждёт следующего запуска.
export async function callTool<T>(token: string, name: string, args: Record<string, unknown>, doFetch: typeof fetch = fetch, patient = true): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callToolOnce<T>(token, name, args, doFetch);
    } catch (e) {
      if (!rateLimited(e) || !patient || attempt >= RATE_WAITS_MS.length) throw e;
      await new Promise((r) => setTimeout(r, RATE_WAITS_MS[attempt]));
    }
  }
}

async function callToolOnce<T>(token: string, name: string, args: Record<string, unknown>, doFetch: typeof fetch): Promise<T> {
  let res: Response;
  try {
    res = await doFetch(MCP_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new Error(`Torro недоступен: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 401 || res.status === 403) throw new Error("Torro не принял ключ");

  let env: { error?: { message?: string }; result?: { isError?: boolean; content?: { type: string; text?: string }[] } };
  try { env = await res.json(); } catch { throw new Error(`Torro ответил HTTP ${res.status} без JSON`); }
  if (!res.ok) throw new Error(`Torro ответил HTTP ${res.status}`);
  if (env.error) throw new Error(`Torro: ${env.error.message ?? "ошибка без текста"}`);

  const texts = (env.result?.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string");
  if (env.result?.isError) throw new Error(`Torro: ${texts[0]?.text?.slice(0, 200) ?? "ошибка инструмента"}`);
  if (texts.length !== 1) throw new Error(`Torro: ожидался один ответ, пришло ${texts.length}`);

  try { return JSON.parse(texts[0].text!) as T; } catch { throw new Error("Torro: ответ не JSON"); }
}

// fetch подменяется в самопроверке.
export async function callStatistics(q: Query, doFetch: typeof fetch = fetch, patient = true): Promise<TorroPayload> {
  const args: Record<string, unknown> = {
    buyer_ids: [q.buyerId], date_from: q.day, date_to: q.day, group_by: q.groupBy,
  };
  if (q.country) args.country = q.country;
  if (q.campaignName) args.campaign_name = q.campaignName;
  if (q.adName) args.ad_name = q.adName;
  const payload = await callTool<TorroPayload>(q.token, "get_statistics", args, doFetch, patient);
  if (!Array.isArray(payload.rows) || !payload.summary) throw new Error("Torro: в ответе нет rows или summary");
  return payload;
}

export interface TorroLanding { id: number; name: string; url: string; theme?: string; spot?: string; domain?: string }

export async function listLandings(token: string): Promise<TorroLanding[]> {
  const rows = await callTool<TorroLanding[]>(token, "list_landings", {});
  if (!Array.isArray(rows)) throw new Error("Torro: список лендингов не пришёл");
  return rows;
}

function truncated(p: TorroPayload): boolean {
  return p.truncated === true || (p.rows_total ?? p.rows.length) > p.rows.length || p.rows.length > ROW_CAP;
}

// Поля, по которым сверяем склейку частей с общим итогом. Если строки без страны
// выпадут при разбиении, это всплывёт здесь, а не тихой дырой.
const CHECKED = ["click", "sub", "chat", "dep_count", "redep_count"] as const;

// Все строки дня, сколько бы их ни было.
//
// Обход потолка в 100 строк: сначала целиком; не влезло — по странам; страна не
// влезла — по кампаниям внутри страны. Разбиваем по тому, что Torro отдаёт
// значением, годным для фильтра: споты он группирует по названию, а
// фильтрует по id — по ним не разобьёшь. Не влезло и так — честная ошибка с
// адресом, а не обрезанные цифры.
export async function fetchDay(
  base: Omit<Query, "groupBy" | "country" | "campaignName" | "adName">,
  groupBy: "ad_name" | "campaign_name",
  doFetch: typeof fetch = fetch
): Promise<TorroRow[]> {
  const whole = await callStatistics({ ...base, groupBy }, doFetch);
  if (!truncated(whole)) return whole.rows;

  const countries = await callStatistics({ ...base, groupBy: "country" }, doFetch);
  if (truncated(countries)) throw new Error(`Torro: за ${base.day} больше ${ROW_CAP} стран, разбить нечем`);

  const parts: TorroRow[] = [];
  for (const c of countries.rows) {
    const country = [c.group];
    const byCountry = await callStatistics({ ...base, groupBy, country }, doFetch);
    if (!truncated(byCountry)) { parts.push(...byCountry.rows); continue; }
    // По кампаниям внутри страны строк не больше, чем было: дальше делить некуда.
    if (groupBy === "campaign_name") {
      throw new Error(`Torro: за ${base.day} в стране ${c.group} больше ${ROW_CAP} кампаний`);
    }

    const campaigns = await callStatistics({ ...base, groupBy: "campaign_name", country }, doFetch);
    if (truncated(campaigns)) {
      throw new Error(`Torro: за ${base.day} в стране ${c.group} больше ${ROW_CAP} кампаний`);
    }
    for (const k of campaigns.rows) {
      const byCampaign = await callStatistics({ ...base, groupBy, country, campaignName: [k.group] }, doFetch);
      if (truncated(byCampaign)) {
        throw new Error(`Torro: за ${base.day} в кампании «${k.group}» больше ${ROW_CAP} объявлений`);
      }
      parts.push(...byCampaign.rows);
    }
  }

  // Одно объявление может прийти из нескольких стран или кампаний — складываем.
  const merged = new Map<string, TorroRow>();
  for (const r of parts) {
    const cur = merged.get(r.group);
    if (!cur) { merged.set(r.group, { ...r }); continue; }
    for (const [k, v] of Object.entries(r)) {
      if (k !== "group" && typeof v === "number") cur[k] = (Number(cur[k]) || 0) + v;
    }
  }
  const rows = [...merged.values()];

  for (const k of CHECKED) {
    const sum = rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    const expected = Number(whole.summary[k]) || 0;
    if (Math.abs(sum - expected) > 1e-6) {
      throw new Error(`Torro: за ${base.day} части не сошлись с итогом по ${k} (${sum} против ${expected})`);
    }
  }
  return rows;
}

// Torro не присылает поле, если цель за день ни разу не сработала. Значит здесь
// отсутствие — это ноль, а не «не выгружали», как в таблицах: спрашивали все
// поля сразу.
export function toCrm(r: TorroRow): CrmNumbers {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    clicks: n(r.click),
    // ПДП — все подписки, не «чистые»: так же их считает выгрузка в таблицу.
    subscribers: n(r.sub),
    dialogs: n(r.chat),
    registrations: n(r.reg),
    depCount: n(r.dep_count),
    depSum: n(r.dep_summary),
    redepCount: n(r.redep_count),
    redepSum: n(r.redep_summary),
    unsubscribes: n(r.unsub),
  };
}

// Проверка при сохранении: ключ рабочий и id баера Torro принимает.
export async function verifyTorro(token: string, buyerId: number, day: string): Promise<string | null> {
  try {
    await callStatistics({ token, buyerId, day, groupBy: "campaign_name" });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
