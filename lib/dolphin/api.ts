import type { MetaAdDay } from "@/lib/reports-live/metaApi";
import { parseName } from "@/lib/creatives/code";

// Dolphin Cloud как источник расхода (Decision 063).
//
// Ходим только в API самого Dolphin. Токены соц. аккаунтов, которые он умеет
// отдавать, с нашего сервера не трогаем никогда: у баеров под каждый аккаунт
// свой прокси, и запрос с чужого IP выбивает аккаунт.
//
// Что выяснено на живых данных (24.10.2026, кабинеты Ильи):
// - без флагов архивных и удалённых объектов статистика по объявлениям молча
//   приходит нулями — ровно так, будто расхода не было;
// - расход объявлений за день сходится с итогом дня до цента ($110,76 за 22.10);
// - id объявлений, адсетов, кампаний и кабинетов — настоящие id Meta, поэтому
//   строки ложатся в тот же склад, что и от Meta, без дублей;
// - стран таргета Dolphin не отдаёт (поле пустое) — страна берётся из нейминга;
// - даты создания нет: у всех объявлений одна заглушка.

const BASE = "https://cloud.dolphin.tech/api/v1";
// Без них статистика — нули (см. выше).
const FLAGS = "showArchivedAds=1&with_trashed=1&showAccountArchivedAdAccount=0&showArchivedAdAccount=1&showArchivedAdsets=1";
// Только эти. С колонкой clicks Dolphin тоже молча обнуляет всю статистику
// (замер 24.10.2026: $0 против $71,34 на той же странице) — клики берём из link_click.
const COLUMNS = ["spend", "impressions", "link_click"].map((c) => `aggregateColumns[]=${c}`).join("&");

async function call<T>(token: string, path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new Error(`Dolphin недоступен: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Лимит — 180 запросов в минуту. Упёрлись — ждём, сколько просит, и повторяем.
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get("retry-after")) || 20;
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error("Dolphin не принял ключ");
    const body = (await res.json().catch(() => null)) as (T & { errors?: { message?: string } }) | null;
    if (!res.ok || !body) throw new Error(`Dolphin ответил HTTP ${res.status}${body?.errors?.message ? `: ${body.errors.message}` : ""}`);
    return body;
  }
}

interface Page<T> { data?: T[]; meta?: { last_page?: number } }

async function allPages<T>(token: string, path: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const body = await call<Page<T>>(token, `${path}&perPage=100&page=${page}`);
    out.push(...(body.data ?? []));
    if (page >= (body.meta?.last_page ?? 1)) return out;
  }
}

// Проверка при подключении: ключ принят, и чей это аккаунт.
export async function verifyDolphin(token: string): Promise<{ name: string } | string> {
  try {
    const p = await call<{ data?: { username?: string; display_name?: string } }>(token, "/auth/profile");
    return { name: p.data?.display_name || p.data?.username || "аккаунт Dolphin" };
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// status и disable_reason — коды Meta как есть; баланс уже в долларах, не в центах.
export interface DolphinCabinet { id: string; name: string; status: number; disableReason: number | null; balance: number | null; currency: string }

interface RawCab {
  id?: string; ad_account_id?: string; name?: string; account_status?: number; disable_reason?: number;
  balance?: number | string | null; currency?: string;
}

export async function dolphinCabinets(token: string, day: string): Promise<DolphinCabinet[]> {
  const rows = await allPages<RawCab>(token, `/fb-cabs?from_date=${day}&to_date=${day}&currency=USD&${FLAGS}`);
  return rows.map((c) => ({
    id: String(c.ad_account_id ?? c.id ?? "").replace(/^act_/, ""),
    name: c.name ?? "",
    status: Number(c.account_status ?? 0),
    disableReason: c.disable_reason ? Number(c.disable_reason) : null,
    balance: c.balance === null || c.balance === undefined || c.balance === "" ? null : n(c.balance),
    currency: c.currency ?? "USD",
  })).filter((c) => c.id);
}

interface RawAd {
  ad_id?: string; id?: string; name?: string;
  effective_status?: string;
  ad_review_feedback?: Record<string, string> | null;
  stats?: { spend?: number | string; impressions?: number | string; link_click?: number | string };
  adset?: {
    adset_id?: string; name?: string;
    campaign?: { campaign_id?: string; name?: string; daily_budget?: number; cab?: { ad_account_id?: string; id?: string; name?: string } };
  };
}

export interface DolphinAdDay extends MetaAdDay {
  campaignDailyBudget: number | null;   // в долларах, как отдаёт Dolphin
  countries: string[];                  // из нейминга адсета или РК
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Страна — из имени адсета, нет там — из имени РК. LATAM — регион, страны за ним нет.
export function countriesFromNames(adsetName: string, campaignName: string): string[] {
  const geo = parseName(adsetName).geo ?? parseName(campaignName).geo;
  return geo && geo !== "LATAM" ? [geo] : [];
}

// Расход по объявлениям по дням: по запросу на день (Dolphin отдаёт агрегат за
// диапазон, дневной разбивки у списка нет). Деньги сразу в долларах.
export async function dolphinAdDays(token: string, since: string, until: string): Promise<DolphinAdDay[]> {
  const out: DolphinAdDay[] = [];
  for (let d = new Date(`${since}T00:00:00Z`); d.toISOString().slice(0, 10) <= until; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const ads = await allPages<RawAd>(token, `/fb-ads?from_date=${day}&to_date=${day}&currency=USD&${COLUMNS}&${FLAGS}`);
    for (const a of ads) {
      const spend = n(a.stats?.spend), impressions = n(a.stats?.impressions);
      // Объявление без открута за день — не строка склада, а просто существующее объявление.
      if (spend === 0 && impressions === 0) continue;
      const adset = a.adset ?? {}, campaign = adset.campaign ?? {}, cab = campaign.cab ?? {};
      out.push({
        date: day,
        adId: String(a.ad_id ?? a.id ?? ""),
        adName: a.name ?? "",
        adsetId: String(adset.adset_id ?? ""),
        adsetName: adset.name ?? "",
        campaignId: String(campaign.campaign_id ?? ""),
        campaignName: campaign.name ?? "",
        accountId: String(cab.ad_account_id ?? cab.id ?? "").replace(/^act_/, ""),
        accountName: cab.name ?? "",
        spend,
        clicks: n(a.stats?.link_click),
        impressions,
        // Все клики Dolphin не отдаёт (с колонкой clicks обнуляет статистику) — есть только по ссылке.
        linkClicks: n(a.stats?.link_click), reach: null, results: null,
        campaignDailyBudget: campaign.daily_budget ? n(campaign.daily_budget) : null,
        countries: countriesFromNames(adset.name ?? "", campaign.name ?? ""),
      });
    }
  }
  return out.filter((r) => r.adId && r.accountId);
}

export interface DolphinAdStatus {
  adId: string; accountId: string; name: string; campaignName: string; adsetName: string;
  effectiveStatus: string;
  feedback: Record<string, string> | null;   // «правило → текст», плоско, без global
}

// Отклонённые и с замечаниями — для антиотклона. Фильтра по статусу у Dolphin нет,
// поэтому берём весь список без статистики и отбираем сами (у Ильи — 2 страницы).
// Свежесть — как у последней синхронизации Dolphin: сами его не пинаем.
export async function dolphinProblemAds(token: string, day: string): Promise<DolphinAdStatus[]> {
  const ads = await allPages<RawAd>(token, `/fb-ads?from_date=${day}&to_date=${day}&currency=USD`);
  return ads
    .filter((a) => a.effective_status === "DISAPPROVED" || a.effective_status === "WITH_ISSUES")
    .map((a) => {
      const adset = a.adset ?? {}, campaign = adset.campaign ?? {}, cab = campaign.cab ?? {};
      return {
        adId: String(a.ad_id ?? a.id ?? ""),
        accountId: String(cab.ad_account_id ?? cab.id ?? "").replace(/^act_/, ""),
        name: a.name ?? "", campaignName: campaign.name ?? "", adsetName: adset.name ?? "",
        effectiveStatus: a.effective_status ?? "",
        feedback: a.ad_review_feedback ?? null,
      };
    })
    .filter((a) => a.adId && a.accountId);
}
