import type { MetaCampaignRow, MetaAdRow } from "./types";

// Meta Marketing API client — direct Graph API, no third-party wrapper.
// Pulls period-scoped spend/clicks/impressions per campaign/ad via the insights
// edge (level + time_range + time_increment=all_days -> one aggregated row per entity).

const API_VERSION = "v26.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// Meta throttles by rolling call volume per app, not per account — firing 90+ accounts'
// worth of requests in one unbounded Promise.all reliably trips "(#4) Application request
// limit reached" and (since failures are caught per-account) silently drops data instead
// of erroring loudly. Capping concurrency spreads the same calls over more wall-clock time.
const CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Токен приходит параметром, а не из env: у каждого баера свой ключ, и общий
// ключ команды ему не достаётся ни в каком виде (Decision 035).
async function graphGet<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${BASE}${path}?${qs}`);
  const json = (await res.json()) as T & { error?: { message: string; code: number } };
  if (!res.ok || (json as { error?: unknown }).error) {
    const err = (json as { error?: { message: string; code: number } }).error;
    throw new Error(`Meta API ${path} failed: ${err?.message ?? res.statusText} (code ${err?.code ?? res.status})`);
  }
  return json;
}

interface AdAccount {
  id: string;
  name: string;
  account_status: number;
}

// Meta hands back an `after` cursor even on the final page — only `paging.next` says there
// really is one. Stopping on the cursor alone cost one extra empty round-trip per edge per
// account, which is pure waste against the app-wide call limit.
async function fetchEdgePaged<T>(token: string, parentId: string, edge: string, fields: string, limit = 200): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (;;) {
    const json = await graphGet<{ data: T[]; paging?: { next?: string; cursors?: { after?: string } } }>(
      token,
      `/${parentId}/${edge}`,
      { fields, limit: String(limit), ...(after ? { after } : {}) }
    );
    out.push(...json.data);
    if (!json.paging?.next) break;
    after = json.paging.cursors?.after;
    if (!after) break;
  }
  return out;
}

interface Business {
  id: string;
}

// Кэш по токену, а не один на всех. Общий кэш означал бы, что кабинеты одного
// баера отдаются другому — молча и правдоподобно.
const accountsCaches = new Map<string, { accounts: AdAccount[]; at: number }>();

// Кэша результата мало. В режиме «Объявления» три ветки — инсайты, статусы и мета
// кампаний — стартуют одновременно через Promise.all, и все три видят пустой кэш.
// Обнаружение кабинетов выполнялось трижды за один отчёт: при трёх бизнесах это
// два десятка лишних вызовов на каждый холодный отчёт, впустую против лимита.
// Держим сам промис: второй и третий дожидаются первого.
const accountsInFlight = new Map<string, Promise<AdAccount[]>>();
// Matches the route's report-level cache. The hour-long TTL was a workaround for sharing
// the app's rate limit with other buyers' tools on the old app — this app is dedicated to
// the dashboard now, so there's no need to hold discovery this stale.
const ACCOUNTS_CACHE_TTL_MS = 5 * 60_000;

// /me/adaccounts only lists accounts shared directly to this Facebook login — accounts
// shared as a partner to the app's Business Manager (not to this specific person) never
// show up there, even though the token can query them directly by ID. Business Manager
// discovery closes that gap: every account owned by, or shared as a client to, any
// Business this token belongs to. Merged + deduped with the direct list, active only.
export async function fetchActiveAccounts(token: string): Promise<AdAccount[]> {
  const accountsCache = accountsCaches.get(token);
  if (accountsCache && Date.now() - accountsCache.at < ACCOUNTS_CACHE_TTL_MS) {
    return accountsCache.accounts;
  }

  const running = accountsInFlight.get(token);
  if (running) return running;

  const started = discoverAccounts(token).finally(() => accountsInFlight.delete(token));
  accountsInFlight.set(token, started);
  return started;
}

async function discoverAccounts(token: string): Promise<AdAccount[]> {
  const accountsCache = accountsCaches.get(token);

  // Track discovery errors (bad/expired token, revoked permissions) instead of swallowing
  // them into an empty list — an empty list looks identical to "no ad accounts" and used to
  // render a report with zero spend and no indication anything was wrong.
  let discoveryError: Error | undefined;
  const [direct, businesses] = await Promise.all([
    fetchEdgePaged<AdAccount>(token, "me", "adaccounts", "id,name,account_status").catch((e) => {
      discoveryError = e;
      return [];
    }),
    fetchEdgePaged<Business>(token, "me", "businesses", "id").catch((e) => {
      discoveryError = e;
      return [];
    }),
  ]);

  const viaBusinesses = await mapWithConcurrency(businesses, CONCURRENCY, async (b) => {
    const [owned, client] = await Promise.all([
      fetchEdgePaged<AdAccount>(token, b.id, "owned_ad_accounts", "id,name,account_status").catch(() => []),
      fetchEdgePaged<AdAccount>(token, b.id, "client_ad_accounts", "id,name,account_status").catch(() => []),
    ]);
    return [...owned, ...client];
  });

  const byId = new Map<string, AdAccount>();
  for (const a of [...direct, ...viaBusinesses.flat()]) {
    if (a.account_status === 1) byId.set(a.id, a);
  }

  if (byId.size === 0 && discoveryError && !accountsCache) {
    throw new Error(`Meta account discovery failed: ${discoveryError.message}`);
  }

  // Stale cache beats an empty report if this pass itself got rate-limited.
  const accounts = byId.size > 0 ? [...byId.values()] : (accountsCache?.accounts ?? []);
  accountsCaches.set(token, { accounts, at: Date.now() });
  return accounts;
}

interface InsightRow {
  // Приходит только при time_increment: "1" — иначе строка агрегирована за весь
  // период и дня в ней нет.
  date_start?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  ad_id?: string;
  ad_name?: string;
  account_id: string;
  account_name: string;
  spend?: string;
  clicks?: string;
  impressions?: string;
}

// daily=true просит дневную разбивку: одна строка на сущность И день, но по-прежнему
// ОДИН запрос на кабинет за весь диапазон. Три недели дневных строк стоят столько
// же вызовов, сколько один агрегат, — растёт только число строк, то есть страниц.
//
// Склад хранит по дням, отчёт «за период» — агрегатом. Отсюда два режима.
async function fetchInsights(
  token: string,
  account: AdAccount,
  level: "campaign" | "ad",
  since: string,
  until: string,
  daily = false
): Promise<InsightRow[]> {
  const base = level === "campaign"
    ? "campaign_id,campaign_name,account_id,account_name,spend,clicks,impressions"
    : "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,account_id,account_name,spend,clicks,impressions";
  // Охватов здесь нет намеренно: reach не складывается по дням, а склад суммирует
  // дневные строки за период (Decision 039).
  const fields = base;
  const timeRange = JSON.stringify({ since, until });

  const out: InsightRow[] = [];
  let after: string | undefined;
  for (;;) {
    const json = await graphGet<{ data: InsightRow[]; paging?: { next?: string; cursors?: { after?: string } } }>(
      token,
      `/${account.id}/insights`,
      { level, fields, time_range: timeRange, time_increment: daily ? "1" : "all_days", limit: "500", ...(after ? { after } : {}) }
    );
    out.push(...json.data);
    if (!json.paging?.next) break;
    after = json.paging.cursors?.after;
    if (!after) break;
  }
  return out;
}

// Fetches per account with bounded concurrency; returns rows plus how many accounts
// failed (rate-limited or otherwise) so the caller can surface a "partial data" warning
// instead of quietly under-reporting spend.
async function fetchInsightsForAllAccounts(
  token: string,
  accounts: AdAccount[],
  level: "campaign" | "ad",
  since: string,
  until: string,
  daily = false
): Promise<{ rows: InsightRow[]; failedAccounts: number }> {
  let failedAccounts = 0;
  const perAccount = await mapWithConcurrency(accounts, CONCURRENCY, (a) =>
    fetchInsights(token, a, level, since, until, daily).catch(() => {
      failedAccounts++;
      return [];
    })
  );
  return { rows: perAccount.flat(), failedAccounts };
}

export async function fetchCampaignInsights(
  token: string,
  since: string,
  until: string
): Promise<{ items: MetaCampaignRow[]; failedAccounts: number }> {
  const accounts = await fetchActiveAccounts(token);
  const { rows, failedAccounts } = await fetchInsightsForAllAccounts(token, accounts, "campaign", since, until);
  const items = rows.map((r) => ({
    campaignId: r.campaign_id ?? "",
    campaignName: r.campaign_name ?? "",
    accountId: r.account_id,
    accountName: r.account_name,
    spend: parseFloat(r.spend ?? "0") || 0,
    clicks: parseInt(r.clicks ?? "0", 10) || 0,
    impressions: parseInt(r.impressions ?? "0", 10) || 0,
  }));
  return { items, failedAccounts };
}

export async function fetchAdInsights(
  token: string,
  since: string,
  until: string
): Promise<{ items: MetaAdRow[]; failedAccounts: number }> {
  const accounts = await fetchActiveAccounts(token);
  const { rows, failedAccounts } = await fetchInsightsForAllAccounts(token, accounts, "ad", since, until);
  const items = rows.map((r) => ({
    adId: r.ad_id ?? "",
    adName: r.ad_name ?? "",
    campaignId: r.campaign_id ?? "",
    campaignName: r.campaign_name ?? "",
    accountId: r.account_id,
    accountName: r.account_name,
    spend: parseFloat(r.spend ?? "0") || 0,
    clicks: parseInt(r.clicks ?? "0", 10) || 0,
    impressions: parseInt(r.impressions ?? "0", 10) || 0,
  }));
  return { items, failedAccounts };
}

// Current object status (ACTIVE/PAUSED/...) — insights doesn't carry this, it's a
// separate object-list lookup. id -> effective_status, across all active accounts.
async function fetchObjectStatuses(token: string, account: AdAccount, edge: "campaigns" | "ads"): Promise<[string, string][]> {
  const rows = await fetchEdgePaged<{ id: string; effective_status: string }>(
    token,
    account.id, edge, "id,effective_status", 500
  );
  return rows.map((d) => [d.id, d.effective_status] as [string, string]);
}

export async function fetchAdStatuses(token: string): Promise<Map<string, string>> {
  const accounts = await fetchActiveAccounts(token);
  const perAccount = await mapWithConcurrency(accounts, CONCURRENCY, (a) => fetchObjectStatuses(token, a, "ads").catch(() => []));
  return new Map(perAccount.flat());
}

// Daily budget of every currently-ACTIVE campaign, in account-currency major units
// (Meta returns daily_budget in minor units — cents for USD — hence the /100).
// Some campaigns set their own budget (CBO); others delegate it to their ad sets (ABO),
// in which case the campaign's own daily_budget is empty and we sum its active ad sets'
// budgets instead. The ad sets edge is only queried for accounts that actually have an
// ABO campaign, to avoid paying for it everywhere.
async function fetchCampaignMetaForAccount(token: string, account: AdAccount): Promise<{ statuses: [string, string][]; budgets: [string, number][] }> {
  const campaigns = await fetchEdgePaged<{ id: string; daily_budget?: string; effective_status: string }>(
    token,
    account.id, "campaigns", "id,daily_budget,effective_status", 500
  );
  const statuses = campaigns.map((c) => [c.id, c.effective_status] as [string, string]);
  const active = campaigns.filter((c) => c.effective_status === "ACTIVE");
  const needsAdSets = active.some((c) => !c.daily_budget);

  const adSetBudgetByCampaign = new Map<string, number>();
  if (needsAdSets) {
    const adSets = await fetchEdgePaged<{ campaign_id: string; daily_budget?: string; effective_status: string }>(
      token,
      account.id, "adsets", "campaign_id,daily_budget,effective_status", 500
    );
    for (const a of adSets) {
      if (a.effective_status !== "ACTIVE" || !a.daily_budget) continue;
      const cents = parseInt(a.daily_budget, 10) || 0;
      adSetBudgetByCampaign.set(a.campaign_id, (adSetBudgetByCampaign.get(a.campaign_id) ?? 0) + cents);
    }
  }

  const budgets: [string, number][] = [];
  for (const c of active) {
    const cents = c.daily_budget ? parseInt(c.daily_budget, 10) || 0 : adSetBudgetByCampaign.get(c.id);
    if (cents !== undefined && cents > 0) budgets.push([c.id, cents / 100]);
  }
  return { statuses, budgets };
}

export interface CampaignMeta {
  statuses: Map<string, string>;
  dailyBudgets: Map<string, number>;
}

// Status and daily budget both live on the campaigns edge, so they come back from one sweep.
// They used to be two independent full passes over the same edge across every account —
// double the calls against the very limit the concurrency cap exists to protect.
export async function fetchCampaignMeta(token: string): Promise<CampaignMeta> {
  const accounts = await fetchActiveAccounts(token);
  const perAccount = await mapWithConcurrency(accounts, CONCURRENCY, (a) =>
    fetchCampaignMetaForAccount(token, a).catch(() => ({ statuses: [] as [string, string][], budgets: [] as [string, number][] }))
  );
  return {
    statuses: new Map(perAccount.flatMap((r) => r.statuses)),
    dailyBudgets: new Map(perAccount.flatMap((r) => r.budgets)),
  };
}

// ─── Дневные строки для склада ───────────────────────────────────────────────
// Отдельные функции, а не флаг у существующих: склад и отчёт хотят разного.
// Отчёту нужен агрегат за период и статусы, складу — сырые дни без статусов,
// потому что статус это состояние «сейчас», а не история (Decision 041).

export interface MetaAdDay {
  date: string;
  adId: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  accountId: string;
  accountName: string;
  spend: number;
  clicks: number;
  impressions: number;
}

export interface MetaCampaignDay {
  date: string;
  campaignId: string;
  campaignName: string;
  accountId: string;
  spend: number;
  clicks: number;
  impressions: number;
}

export async function fetchAdDays(
  token: string, since: string, until: string
): Promise<{ items: MetaAdDay[]; failedAccounts: number }> {
  const accounts = await fetchActiveAccounts(token);
  const { rows, failedAccounts } = await fetchInsightsForAllAccounts(token, accounts, "ad", since, until, true);
  const items = rows
    // Строка без даты означает, что Meta проигнорировала дневную разбивку.
    // Класть её в склад нельзя: непонятно, за какой день эти деньги.
    .filter((r) => r.date_start)
    .map((r) => ({
      date: r.date_start as string,
      adId: r.ad_id ?? "",
      adName: r.ad_name ?? "",
      adsetId: r.adset_id ?? "",
      adsetName: r.adset_name ?? "",
      campaignId: r.campaign_id ?? "",
      campaignName: r.campaign_name ?? "",
      accountId: r.account_id,
      accountName: r.account_name,
      spend: parseFloat(r.spend ?? "0") || 0,
      clicks: parseInt(r.clicks ?? "0", 10) || 0,
      impressions: parseInt(r.impressions ?? "0", 10) || 0,
    }))
    .filter((r) => r.adId);
  return { items, failedAccounts };
}

export async function fetchCampaignDays(
  token: string, since: string, until: string
): Promise<{ items: MetaCampaignDay[]; failedAccounts: number }> {
  const accounts = await fetchActiveAccounts(token);
  const { rows, failedAccounts } = await fetchInsightsForAllAccounts(token, accounts, "campaign", since, until, true);
  const items = rows
    .filter((r) => r.date_start && r.campaign_id)
    .map((r) => ({
      date: r.date_start as string,
      campaignId: r.campaign_id as string,
      campaignName: r.campaign_name ?? "",
      accountId: r.account_id,
      spend: parseFloat(r.spend ?? "0") || 0,
      clicks: parseInt(r.clicks ?? "0", 10) || 0,
      impressions: parseInt(r.impressions ?? "0", 10) || 0,
    }));
  return { items, failedAccounts };
}

// ─── Таргет адсетов: страна как факт ─────────────────────────────────────────
// Гео берётся отсюда, а не из имени: имена пишет человек, и половина не по
// шаблону (замер 31.08.2026). Одна выборка на кабинет, не на адсет.

export interface AdSetTargeting {
  adsetId: string;
  adsetName: string;
  accountId: string;
  countries: string[];
}

export async function fetchAdSetTargeting(token: string): Promise<{ items: AdSetTargeting[]; failedAccounts: number }> {
  const accounts = await fetchActiveAccounts(token);
  let failedAccounts = 0;

  const perAccount = await mapWithConcurrency(accounts, CONCURRENCY, async (a) => {
    try {
      const rows = await fetchEdgePaged<{
        id: string;
        name?: string;
        targeting?: { geo_locations?: { countries?: string[] } };
      }>(token, a.id, "adsets", "id,name,targeting{geo_locations}");
      return rows.map((r) => ({
        adsetId: r.id,
        adsetName: r.name ?? "",
        accountId: a.id,
        countries: r.targeting?.geo_locations?.countries ?? [],
      }));
    } catch {
      failedAccounts++;
      return [];
    }
  });

  return { items: perAccount.flat(), failedAccounts };
}
