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

function token(): string {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new Error("Missing META_ACCESS_TOKEN env var");
  return t;
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token() });
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

async function fetchEdgePaged<T>(parentId: string, edge: string, fields: string): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (;;) {
    const json = await graphGet<{ data: T[]; paging?: { cursors?: { after?: string } } }>(
      `/${parentId}/${edge}`,
      { fields, limit: "200", ...(after ? { after } : {}) }
    );
    out.push(...json.data);
    after = json.paging?.cursors?.after;
    if (!after || json.data.length === 0) break;
  }
  return out;
}

interface Business {
  id: string;
}

let accountsCache: { accounts: AdAccount[]; at: number } | null = null;
// Business/account structure changes slowly (Daniil: "~10 accounts a week") — cache far
// longer than the 5-min report cache to keep this discovery pass off the rate-limit budget.
const ACCOUNTS_CACHE_TTL_MS = 60 * 60_000;

// /me/adaccounts only lists accounts shared directly to this Facebook login — accounts
// shared as a partner to the app's Business Manager (not to this specific person) never
// show up there, even though the token can query them directly by ID. Business Manager
// discovery closes that gap: every account owned by, or shared as a client to, any
// Business this token belongs to. Merged + deduped with the direct list, active only.
export async function fetchActiveAccounts(): Promise<AdAccount[]> {
  if (accountsCache && Date.now() - accountsCache.at < ACCOUNTS_CACHE_TTL_MS) {
    return accountsCache.accounts;
  }

  const [direct, businesses] = await Promise.all([
    fetchEdgePaged<AdAccount>("me", "adaccounts", "id,name,account_status").catch(() => []),
    fetchEdgePaged<Business>("me", "businesses", "id").catch(() => []),
  ]);

  const viaBusinesses = await mapWithConcurrency(businesses, CONCURRENCY, async (b) => {
    const [owned, client] = await Promise.all([
      fetchEdgePaged<AdAccount>(b.id, "owned_ad_accounts", "id,name,account_status").catch(() => []),
      fetchEdgePaged<AdAccount>(b.id, "client_ad_accounts", "id,name,account_status").catch(() => []),
    ]);
    return [...owned, ...client];
  });

  const byId = new Map<string, AdAccount>();
  for (const a of [...direct, ...viaBusinesses.flat()]) {
    if (a.account_status === 1) byId.set(a.id, a);
  }

  // Stale cache beats an empty report if this pass itself got rate-limited.
  const accounts = byId.size > 0 ? [...byId.values()] : (accountsCache?.accounts ?? []);
  accountsCache = { accounts, at: Date.now() };
  return accounts;
}

interface InsightRow {
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

async function fetchInsights(account: AdAccount, level: "campaign" | "ad", since: string, until: string): Promise<InsightRow[]> {
  const fields =
    level === "campaign"
      ? "campaign_id,campaign_name,account_id,account_name,spend,clicks,impressions"
      : "ad_id,ad_name,campaign_id,campaign_name,account_id,account_name,spend,clicks,impressions";
  const timeRange = JSON.stringify({ since, until });

  const out: InsightRow[] = [];
  let after: string | undefined;
  for (;;) {
    const json = await graphGet<{ data: InsightRow[]; paging?: { cursors?: { after?: string } } }>(
      `/${account.id}/insights`,
      { level, fields, time_range: timeRange, time_increment: "all_days", limit: "500", ...(after ? { after } : {}) }
    );
    out.push(...json.data);
    after = json.paging?.cursors?.after;
    if (!after || json.data.length === 0) break;
  }
  return out;
}

// Fetches per account with bounded concurrency; returns rows plus how many accounts
// failed (rate-limited or otherwise) so the caller can surface a "partial data" warning
// instead of quietly under-reporting spend.
async function fetchInsightsForAllAccounts(
  accounts: AdAccount[],
  level: "campaign" | "ad",
  since: string,
  until: string
): Promise<{ rows: InsightRow[]; failedAccounts: number }> {
  let failedAccounts = 0;
  const perAccount = await mapWithConcurrency(accounts, CONCURRENCY, (a) =>
    fetchInsights(a, level, since, until).catch(() => {
      failedAccounts++;
      return [];
    })
  );
  return { rows: perAccount.flat(), failedAccounts };
}

export async function fetchCampaignInsights(
  since: string,
  until: string
): Promise<{ items: MetaCampaignRow[]; failedAccounts: number }> {
  const accounts = await fetchActiveAccounts();
  const { rows, failedAccounts } = await fetchInsightsForAllAccounts(accounts, "campaign", since, until);
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
  since: string,
  until: string
): Promise<{ items: MetaAdRow[]; failedAccounts: number }> {
  const accounts = await fetchActiveAccounts();
  const { rows, failedAccounts } = await fetchInsightsForAllAccounts(accounts, "ad", since, until);
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
async function fetchObjectStatuses(account: AdAccount, edge: "campaigns" | "ads"): Promise<[string, string][]> {
  const out: [string, string][] = [];
  let after: string | undefined;
  for (;;) {
    const json = await graphGet<{ data: { id: string; effective_status: string }[]; paging?: { cursors?: { after?: string } } }>(
      `/${account.id}/${edge}`,
      { fields: "id,effective_status", limit: "500", ...(after ? { after } : {}) }
    );
    out.push(...json.data.map((d) => [d.id, d.effective_status] as [string, string]));
    after = json.paging?.cursors?.after;
    if (!after || json.data.length === 0) break;
  }
  return out;
}

async function fetchStatusesForAllAccounts(accounts: AdAccount[], edge: "campaigns" | "ads"): Promise<Map<string, string>> {
  const perAccount = await mapWithConcurrency(accounts, CONCURRENCY, (a) => fetchObjectStatuses(a, edge).catch(() => []));
  return new Map(perAccount.flat());
}

export async function fetchCampaignStatuses(): Promise<Map<string, string>> {
  const accounts = await fetchActiveAccounts();
  return fetchStatusesForAllAccounts(accounts, "campaigns");
}

export async function fetchAdStatuses(): Promise<Map<string, string>> {
  const accounts = await fetchActiveAccounts();
  return fetchStatusesForAllAccounts(accounts, "ads");
}

// Daily budget of every currently-ACTIVE campaign, in account-currency major units
// (Meta returns daily_budget in minor units — cents for USD — hence the /100).
// Some campaigns set their own budget (CBO); others delegate it to their ad sets (ABO),
// in which case the campaign's own daily_budget is empty and we sum its active ad sets'
// budgets instead. The ad sets edge is only queried for accounts that actually have an
// ABO campaign, to avoid paying for it everywhere.
async function fetchCampaignBudgetsForAccount(account: AdAccount): Promise<[string, number][]> {
  const campaigns = await fetchEdgePaged<{ id: string; daily_budget?: string; effective_status: string }>(
    account.id, "campaigns", "id,daily_budget,effective_status"
  );
  const active = campaigns.filter((c) => c.effective_status === "ACTIVE");
  const needsAdSets = active.some((c) => !c.daily_budget);

  const adSetBudgetByCampaign = new Map<string, number>();
  if (needsAdSets) {
    const adSets = await fetchEdgePaged<{ campaign_id: string; daily_budget?: string; effective_status: string }>(
      account.id, "adsets", "campaign_id,daily_budget,effective_status"
    );
    for (const a of adSets) {
      if (a.effective_status !== "ACTIVE" || !a.daily_budget) continue;
      const cents = parseInt(a.daily_budget, 10) || 0;
      adSetBudgetByCampaign.set(a.campaign_id, (adSetBudgetByCampaign.get(a.campaign_id) ?? 0) + cents);
    }
  }

  const out: [string, number][] = [];
  for (const c of active) {
    const cents = c.daily_budget ? parseInt(c.daily_budget, 10) || 0 : adSetBudgetByCampaign.get(c.id);
    if (cents !== undefined && cents > 0) out.push([c.id, cents / 100]);
  }
  return out;
}

export async function fetchCampaignDailyBudgets(): Promise<Map<string, number>> {
  const accounts = await fetchActiveAccounts();
  const perAccount = await mapWithConcurrency(accounts, CONCURRENCY, (a) => fetchCampaignBudgetsForAccount(a).catch(() => []));
  return new Map(perAccount.flat());
}
