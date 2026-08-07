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

// account_status: 1 = ACTIVE. Only pull from active accounts.
export async function fetchActiveAccounts(): Promise<AdAccount[]> {
  const accounts: AdAccount[] = [];
  let after: string | undefined;
  for (;;) {
    const json = await graphGet<{ data: AdAccount[]; paging?: { cursors?: { after?: string } } }>(
      "/me/adaccounts",
      { fields: "id,name,account_status", limit: "200", ...(after ? { after } : {}) }
    );
    accounts.push(...json.data.filter((a) => a.account_status === 1));
    after = json.paging?.cursors?.after;
    if (!after || json.data.length === 0) break;
  }
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
