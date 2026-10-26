import { countriesFromNames, type DolphinAdDay, type DolphinAdStatus, type DolphinCabinet } from "@/lib/dolphin/api";
import { usdRate } from "@/lib/fx";

// FB Tool как источник расхода Facebook (Decision 071).
//
// Ходим только в API самого FB Tool (fbtool.pro/api). get-accounts отдаёт и токены
// аккаунтов Facebook — их с нашего сервера не трогаем никогда: у баеров под каждый
// аккаунт свой прокси, и запрос с чужого IP выбивает аккаунт.
//
// В отличие от Dolphin, FB Tool сам ничего не хранит: get-statistics идёт в
// Facebook вживую через аккаунт. Разлогиненный аккаунт — нет данных вовсе, пока
// баер не перелогинит его в FB Tool.
//
// Что выяснено на живых данных (24.10.2026, аккаунт YAN5 Андрея):
// - кабинет приходит целиком, без страниц (137 объявлений одним ответом);
// - запрос статистики за день — ~10 с на аккаунт, лимит API — 10 000 запросов в сутки;
// - таргета нет — страна из нейминга; причины отклонения нет — только статус;
// - кабинеты бывают в EUR — расход переводим в доллары по курсу своего дня.

const BASE = "https://fbtool.pro/api";

async function call<T>(key: string, method: string, params: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${method}?${new URLSearchParams({ key, ...params })}`, { signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    throw new Error(`FB Tool недоступен: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (await res.json().catch(() => null)) as (T & { success?: boolean; message?: string; error?: unknown }) | null;
  if (!res.ok || !body) throw new Error(`FB Tool ответил HTTP ${res.status}`);
  if (body.success === false || body.error) {
    const msg = body.message ?? (typeof body.error === "string" ? body.error : JSON.stringify(body.error));
    throw new Error(/key|ключ/i.test(msg ?? "") ? "FB Tool не принял ключ" : `FB Tool ${method}: ${msg}`);
  }
  return body;
}

export interface FbtoolAccount { id: string; name: string; ok: boolean; problem: string | null }

// Аккаунты ключа. status = "1" — живой; иначе FB Tool кладёт туда текст ошибки Facebook.
export async function fbtoolAccounts(key: string): Promise<FbtoolAccount[]> {
  const body = await call<Record<string, unknown>>(key, "get-accounts");
  return Object.values(body)
    .filter((a): a is { id: string; name?: string; status?: string } => Boolean(a) && typeof a === "object" && "id" in (a as object))
    .map((a) => {
      const ok = String(a.status) === "1";
      return { id: String(a.id), name: (a.name ?? "").trim() || String(a.id), ok, problem: ok ? null : String(a.status ?? "").trim() || "аккаунт недоступен" };
    });
}

interface RawCab { account_id?: string; id?: string; name?: string; currency?: string; account_status?: number; disable_reason?: number }

export async function fbtoolCabinets(key: string, account: string): Promise<DolphinCabinet[]> {
  const body = await call<{ data?: RawCab[] }>(key, "get-adaccounts", { account });
  return (body.data ?? []).map((c) => ({
    id: String(c.account_id ?? c.id ?? "").replace(/^act_/, ""),
    name: c.name ?? "",
    status: Number(c.account_status ?? 0),
    disableReason: c.disable_reason ? Number(c.disable_reason) : null,
    balance: null,
    currency: c.currency ?? "USD",
  })).filter((c) => c.id);
}

interface Action { action_type?: string; value?: string }
interface Row { date_start?: string; spend?: string; impressions?: string; clicks?: string; actions?: Action[] }
interface RawAd {
  id?: string; name?: string; effective_status?: string;
  adset?: { id?: string; name?: string }; campaign?: { id?: string; name?: string };
  insights?: { data?: Row[] };
}
interface StatsCab { account_id?: string; name?: string; currency?: string; ads?: { data?: RawAd[] } }

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const linkClicks = (r: Row) => n(r.actions?.find((a) => a.action_type === "link_click")?.value ?? r.clicks);

async function stats(key: string, account: string, since: string, until: string, status = "all") {
  return (await call<{ data?: StatsCab[] }>(key, "get-statistics", {
    account, mode: "ads", byDay: "1", status, dates: `${since} - ${until}`,
  })).data ?? [];
}

// Дневные бюджеты живых кампаний, в долларах. Режим «ads» бюджетов не отдаёт — только
// «campaigns» (daily_budget в центах валюты кабинета). Нужны чеку за сегодня, а не складу.
export async function fbtoolBudgets(key: string, account: string, day: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const cabs = (await call<{ data?: { currency?: string; campaigns?: { data?: { id?: string; daily_budget?: string; effective_status?: string }[] } }[] }>(
    key, "get-statistics", { account, mode: "campaigns", status: "all", dates: `${day} - ${day}` })).data ?? [];
  for (const cab of cabs) {
    const rate = await usdRate(cab.currency ?? "USD", day);
    for (const c of cab.campaigns?.data ?? []) {
      if (c.effective_status !== "ACTIVE" || !c.id || !(n(c.daily_budget) > 0)) continue;
      out.set(String(c.id), Math.round((n(c.daily_budget) / 100) * rate * 100) / 100);
    }
  }
  return out;
}

// Расход по объявлениям по дням — в форме Dolphin, деньги сразу в долларах.
// budgets — бюджеты кампаний (fbtoolBudgets) для живого чека; без них бюджет пустой.
export async function fbtoolAdDays(key: string, account: string, since: string, until: string, budgets?: Map<string, number>): Promise<DolphinAdDay[]> {
  const out: DolphinAdDay[] = [];
  for (const cab of await stats(key, account, since, until)) {
    const accountId = String(cab.account_id ?? "").replace(/^act_/, "");
    for (const a of cab.ads?.data ?? []) {
      for (const r of a.insights?.data ?? []) {
        const spend = n(r.spend), impressions = n(r.impressions);
        if (!r.date_start || (spend === 0 && impressions === 0)) continue;
        const rate = await usdRate(cab.currency ?? "USD", r.date_start);
        out.push({
          date: r.date_start,
          adId: String(a.id ?? ""), adName: a.name ?? "",
          adsetId: String(a.adset?.id ?? ""), adsetName: a.adset?.name ?? "",
          campaignId: String(a.campaign?.id ?? ""), campaignName: a.campaign?.name ?? "",
          accountId, accountName: cab.name ?? "",
          spend: Math.round(spend * rate * 100) / 100, clicks: linkClicks(r), impressions,
          campaignDailyBudget: budgets?.get(String(a.campaign?.id ?? "")) ?? null,
          countries: countriesFromNames(a.adset?.name ?? "", a.campaign?.name ?? ""),
        });
      }
    }
  }
  return out.filter((r) => r.adId && r.accountId);
}

// Отклонённые за день — для антиотклона. Причины FB Tool не отдаёт, только статус.
export async function fbtoolProblemAds(key: string, account: string, day: string): Promise<DolphinAdStatus[]> {
  const out: DolphinAdStatus[] = [];
  for (const cab of await stats(key, account, day, day, "disapproved")) {
    for (const a of cab.ads?.data ?? []) {
      if (a.effective_status !== "DISAPPROVED" && a.effective_status !== "WITH_ISSUES") continue;
      out.push({
        adId: String(a.id ?? ""), accountId: String(cab.account_id ?? "").replace(/^act_/, ""),
        name: a.name ?? "", campaignName: a.campaign?.name ?? "", adsetName: a.adset?.name ?? "",
        effectiveStatus: a.effective_status, feedback: null,
      });
    }
  }
  return out.filter((a) => a.adId && a.accountId);
}
