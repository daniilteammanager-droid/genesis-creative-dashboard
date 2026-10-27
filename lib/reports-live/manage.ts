import { warehouse } from "@/lib/warehouse/read";
import { metaTokensOf } from "@/lib/connections/metaKeys";
import { getConnection } from "@/lib/connections/store";
import { usdRate } from "@/lib/fx";
import { mskDay } from "@/lib/day";
import type { Profile } from "@/lib/auth/types";

// Live Manager в Reports (Decision 079): статус и бюджет кампаний, адсетов и
// объявлений прямо из таблицы — как у Артёма в Genesis Manager.
//
// Пишем ключом того, за кем кабинет: Meta — его ключом с ads_management, Dolphin —
// через API самого Dolphin (токены аккаунтов не трогаем никогда). FB Tool писать
// не умеет — у таких кабинетов кнопок нет. Менять может владелец кабинета и
// владелец дашборда; тимлид смотрит.

export type Level = "campaign" | "adset" | "ad";
export interface Item { level: Level; id: string; accountId: string }
export interface LiveState {
  id: string; status: string; effective: string;
  dailyBudget: number | null;   // в долларах; null — бюджет не на этом уровне
  canEdit: boolean;
}

const GRAPH = "https://graph.facebook.com/v26.0";
const EDGE: Record<Level, string> = { campaign: "campaigns", adset: "adsets", ad: "ads" };
const DOLPHIN = "https://cloud.dolphin.tech/api/v1";
const DOLPHIN_PATH: Record<Level, string> = { campaign: "fb-campaigns", adset: "fb-adsets", ad: "fb-ads" };

type Writer =
  | { kind: "meta"; token: string; canWrite: boolean; currency: string }
  | { kind: "dolphin"; token: string }
  | { kind: "none"; why: string };

async function graph<T>(token: string, path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<T> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === "GET"
    ? await fetch(`${GRAPH}/${path}?${body}`, { signal: AbortSignal.timeout(30_000) })
    : await fetch(`${GRAPH}/${path}`, { method: "POST", body, signal: AbortSignal.timeout(30_000) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; error_user_msg?: string } };
  if (!res.ok || j.error) throw new Error(`Meta: ${j.error?.error_user_msg || j.error?.message || `HTTP ${res.status}`}`);
  return j;
}

async function dolphin<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${DOLPHIN}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000),
  });
  const j = (await res.json().catch(() => null)) as T & { errors?: { message?: string } } | null;
  if (!res.ok || !j) throw new Error(`Dolphin ответил HTTP ${res.status}${j?.errors?.message ? `: ${j.errors.message}` : ""}`);
  return j;
}

// Чем писать в этот кабинет: ключ Meta владельца, который его видит, или его Dolphin.
async function writerFor(accountId: string, ownerId: string): Promise<Writer> {
  const conn = await getConnection(ownerId).catch(() => null);
  if (conn?.spendSource === "dolphin" && conn.dolphinToken) return { kind: "dolphin", token: conn.dolphinToken };
  if (conn?.spendSource === "fbtool") return { kind: "none", why: "Кабинет через FB Tool — управлять из дашборда нельзя" };
  const keys = await metaTokensOf(ownerId);
  let last = "";
  for (const k of [...keys.filter((x) => x.canWrite), ...keys.filter((x) => !x.canWrite)]) {
    try {
      const a = await graph<{ currency?: string }>(k.token, `act_${accountId}`, { fields: "currency" });
      return { kind: "meta", token: k.token, canWrite: k.canWrite, currency: a.currency ?? "USD" };
    } catch (e) { last = e instanceof Error ? e.message : String(e); /* этот ключ кабинет не видит — следующий */ }
  }
  return { kind: "none", why: last ? `ключ владельца не читает кабинет — ${last}` : "у владельца нет ключа Meta" };
}

async function owners(accountIds: string[]): Promise<Map<string, string>> {
  const { data } = await warehouse().from("wh_account_owners").select("account_id, owner_user_id").in("account_id", accountIds);
  return new Map((data ?? []).filter((r) => r.owner_user_id).map((r) => [r.account_id as string, r.owner_user_id as string]));
}

const byAccount = (items: Item[]) => {
  const m = new Map<string, Item[]>();
  for (const it of items) m.set(it.accountId, [...(m.get(it.accountId) ?? []), it]);
  return m;
};
const may = (me: Profile, ownerId: string | undefined) => me.role === "main" || (ownerId !== undefined && ownerId === me.id);

interface RawMeta { id: string; status?: string; effective_status?: string; daily_budget?: string }
interface RawDolphin { id: number | string; campaign_id?: string; adset_id?: string; ad_id?: string; status?: string; effective_status?: string; daily_budget?: number | string | null }
const fbIdOf = (level: Level, r: RawDolphin) => String((level === "campaign" ? r.campaign_id : level === "adset" ? r.adset_id : r.ad_id) ?? "");

// Dolphin пишет по своим id, у нас — id Facebook: сопоставляем по списку уровня.
// ponytail: список уровня целиком на каждый вызов; кэш — если кабинетов станет много.
async function dolphinList(token: string, level: Level): Promise<RawDolphin[]> {
  const day = mskDay(), out: RawDolphin[] = [];
  for (let page = 1; page < 50; page++) {
    const b = await dolphin<{ data?: RawDolphin[]; meta?: { last_page?: number } }>(token,
      `/${DOLPHIN_PATH[level]}?from_date=${day}&to_date=${day}&currency=USD&with_trashed=0&perPage=100&page=${page}`);
    out.push(...(b.data ?? []));
    if (page >= (b.meta?.last_page ?? 1)) break;
  }
  return out;
}

// Статусы и бюджеты для строк отчёта.
export async function liveStates(me: Profile, items: Item[]): Promise<{ states: LiveState[]; errors: string[] }> {
  const own = await owners([...new Set(items.map((i) => i.accountId))]);
  const states: LiveState[] = [], errors: string[] = [];
  // Почему без статуса — одной строкой на причину, а не по строке на кабинет.
  const why = new Map<string, number>();
  const note = (reason: string) => why.set(reason, (why.get(reason) ?? 0) + 1);
  for (const [accountId, list] of byAccount(items)) {
    const ownerId = own.get(accountId);
    if (!ownerId) continue;
    try {
      const w = await writerFor(accountId, ownerId);
      if (w.kind === "none") { note(w.why); continue; }
      const editable = may(me, ownerId) && (w.kind === "dolphin" || w.canWrite);
      for (const level of ["campaign", "adset", "ad"] as Level[]) {
        const ids = list.filter((i) => i.level === level).map((i) => i.id);
        if (!ids.length) continue;
        if (w.kind === "meta") {
          const rate = await usdRate(w.currency, mskDay());
          for (let k = 0; k < ids.length; k += 50) {
            const fields = level === "ad" ? "id,status,effective_status" : "id,status,effective_status,daily_budget";
            const r = await graph<{ data: RawMeta[] }>(w.token, `act_${accountId}/${EDGE[level]}`, {
              fields, limit: "100", filtering: JSON.stringify([{ field: "id", operator: "IN", value: ids.slice(k, k + 50) }]),
            });
            for (const o of r.data) states.push({
              id: o.id, status: o.status ?? "", effective: o.effective_status ?? o.status ?? "",
              dailyBudget: o.daily_budget ? Math.round((Number(o.daily_budget) / 100) * rate * 100) / 100 : null, canEdit: editable,
            });
          }
        } else {
          const want = new Set(ids);
          for (const o of await dolphinList(w.token, level)) {
            const id = fbIdOf(level, o);
            if (!want.has(id)) continue;
            states.push({
              id, status: o.status ?? "", effective: o.effective_status ?? o.status ?? "",
              dailyBudget: level !== "ad" && o.daily_budget ? Number(o.daily_budget) : null, canEdit: editable,
            });
          }
        }
      }
    } catch (e) {
      note(e instanceof Error ? e.message : String(e));
    }
  }
  for (const [reason, count] of why) errors.push(`${reason} (кабинетов: ${count})`);
  return { states, errors };
}

// Охват и частота за период — живьём из Meta (Decision 089): дневные охваты склада в период
// не складываются. Только кабинеты на ключах Meta; Dolphin, FB Tool и TG Ads охвата не дают.
// Баер — только свои кабинеты, владелец и тимлид — все.
export async function liveReach(me: Profile, items: Item[], since: string, until: string): Promise<Record<string, { reach: number; frequency: number | null }>> {
  const own = await owners([...new Set(items.map((i) => i.accountId))]);
  const out: Record<string, { reach: number; frequency: number | null }> = {};
  const jobs = [...byAccount(items)].map(([accountId, list]) => async () => {
    const ownerId = own.get(accountId);
    if (!ownerId || (me.role === "buyer" && ownerId !== me.id)) return;
    const w = await writerFor(accountId, ownerId).catch(() => null);
    if (w?.kind !== "meta") return;
    await Promise.all((["campaign", "adset", "ad"] as Level[]).map(async (level) => {
      const ids = list.filter((i) => i.level === level).map((i) => i.id);
      for (let k = 0; k < ids.length; k += 50) {
        const r = await graph<{ data: Record<string, string>[] }>(w.token, `act_${accountId}/insights`, {
          level, fields: `${level}_id,reach,frequency`, time_range: JSON.stringify({ since, until }), limit: "500",
          filtering: JSON.stringify([{ field: `${level}.id`, operator: "IN", value: ids.slice(k, k + 50) }]),
        }).catch(() => ({ data: [] }));
        for (const x of r.data) {
          const id = x[`${level}_id`];
          if (id) out[id] = { reach: parseInt(x.reach ?? "0", 10) || 0, frequency: x.frequency ? Number(x.frequency) : null };
        }
      }
    }));
  });
  // По 6 кабинетов разом: лимит приложения общий (Decision 042), но и ждать полминуты нельзя.
  for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map((j) => j()));
  return out;
}

export type Action = { kind: "status"; active: boolean } | { kind: "budget"; usd: number };

// Применить к выбранным. Ответ — по строке: получилось или почему нет.
export async function applyLive(me: Profile, items: Item[], action: Action): Promise<{ id: string; ok: boolean; error?: string }[]> {
  if (action.kind === "budget" && !(action.usd > 0)) throw new Error("Бюджет должен быть больше нуля");
  const own = await owners([...new Set(items.map((i) => i.accountId))]);
  const out: { id: string; ok: boolean; error?: string }[] = [];
  for (const [accountId, list] of byAccount(items)) {
    const ownerId = own.get(accountId);
    const fail = (error: string) => list.forEach((i) => out.push({ id: i.id, ok: false, error }));
    if (!may(me, ownerId)) { fail("Менять можно только свои кабинеты"); continue; }
    const w = await writerFor(accountId, ownerId!).catch((e) => ({ kind: "none", why: String(e) }) as Writer);
    if (w.kind === "none") { fail(w.why); continue; }
    if (w.kind === "meta" && !w.canWrite) { fail("У ключа Meta нет права ads_management"); continue; }
    for (const it of list) {
      try {
        if (action.kind === "budget" && it.level === "ad") throw new Error("У объявления нет своего бюджета");
        if (w.kind === "meta") {
          const params: Record<string, string> = action.kind === "status"
            ? { status: action.active ? "ACTIVE" : "PAUSED" }
            : { daily_budget: String(Math.round((action.usd / (await usdRate(w.currency, mskDay()))) * 100)) };
          await graph(w.token, it.id, params, "POST");
        } else {
          const raw = (await dolphinList(w.token, it.level)).find((o) => fbIdOf(it.level, o) === it.id);
          if (!raw) throw new Error("Dolphin не нашёл объект — обнови Dolphin и повтори");
          const path = `/${DOLPHIN_PATH[it.level]}`;
          if (action.kind === "status") {
            const status = action.active ? "ACTIVE" : "PAUSED";
            await dolphin(w.token, path, "PATCH", it.level === "ad" ? { data: { [raw.id]: { status } } } : { status, ids: [raw.id] });
          } else {
            const key = it.level === "campaign" ? "campaigns" : "adsets";
            await dolphin(w.token, path, "PUT", { [key]: [{ id: raw.id, bid_amount: 0, bid_strategy: "LOWEST_COST_WITHOUT_CAP", daily_budget: action.usd, lifetime_budget: 0 }] });
          }
        }
        out.push({ id: it.id, ok: true });
      } catch (e) {
        out.push({ id: it.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return out;
}
