import type { MetaCampaignRow, MetaAdRow } from "./types";

// Meta Marketing API client — direct Graph API, no third-party wrapper.
// Pulls period-scoped spend/clicks/impressions per campaign/ad via the insights
// edge (level + time_range + time_increment=all_days -> one aggregated row per entity).

const API_VERSION = "v26.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

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
const ACCOUNTS_CACHE_TTL_MS = 5 * 60_000;

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

  const viaBusinesses = await Promise.all(
    businesses.flatMap((b) => [
      fetchEdgePaged<AdAccount>(b.id, "owned_ad_accounts", "id,name,account_status").catch(() => []),
      fetchEdgePaged<AdAccount>(b.id, "client_ad_accounts", "id,name,account_status").catch(() => []),
    ])
  );

  const byId = new Map<string, AdAccount>();
  for (const a of [...direct, ...viaBusinesses.flat()]) {
    if (a.account_status === 1) byId.set(a.id, a);
  }

  const accounts = [...byId.values()];
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

export async function fetchCampaignInsights(since: string, until: string): Promise<MetaCampaignRow[]> {
  const accounts = await fetchActiveAccounts();
  const perAccount = await Promise.all(accounts.map((a) => fetchInsights(a, "campaign", since, until).catch(() => [])));
  return perAccount.flat().map((r) => ({
    campaignId: r.campaign_id ?? "",
    campaignName: r.campaign_name ?? "",
    accountId: r.account_id,
    accountName: r.account_name,
    spend: parseFloat(r.spend ?? "0") || 0,
    clicks: parseInt(r.clicks ?? "0", 10) || 0,
    impressions: parseInt(r.impressions ?? "0", 10) || 0,
  }));
}

export async function fetchAdInsights(since: string, until: string): Promise<MetaAdRow[]> {
  const accounts = await fetchActiveAccounts();
  const perAccount = await Promise.all(accounts.map((a) => fetchInsights(a, "ad", since, until).catch(() => [])));
  return perAccount.flat().map((r) => ({
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

export async function fetchCampaignStatuses(): Promise<Map<string, string>> {
  const accounts = await fetchActiveAccounts();
  const perAccount = await Promise.all(accounts.map((a) => fetchObjectStatuses(a, "campaigns").catch(() => [])));
  return new Map(perAccount.flat());
}

export async function fetchAdStatuses(): Promise<Map<string, string>> {
  const accounts = await fetchActiveAccounts();
  const perAccount = await Promise.all(accounts.map((a) => fetchObjectStatuses(a, "ads").catch(() => [])));
  return new Map(perAccount.flat());
}
