// Reports "Live" — Meta Marketing API + CRM weekly exports, matched per period.
// Replaces FBTool inside Reports Auto mode. Two view modes: campaigns / ads.

export type LiveMode = "campaigns" | "ads";

// "unknown" = no current Meta object found at all (e.g. a CRM-only Ads-mode row).
export type LiveStatus = "active" | "paused" | "unknown";

export interface MetaCampaignRow {
  campaignId: string;
  campaignName: string;
  accountId: string;
  accountName: string;
  spend: number;
  clicks: number;
  impressions: number;
}

export interface MetaAdRow {
  adId: string;
  adName: string;
  campaignId: string;
  campaignName: string;
  accountId: string;
  accountName: string;
  spend: number;
  clicks: number;
  impressions: number;
}

// CRM ad-level export (one weekly sheet) — per Ad ID. Kept as a reserve match path;
// the primary export for Ads mode is the name-keyed one below.
export interface CrmAdRow {
  adId: string;
  pdp: number;
  dia: number;
  registrations: number;
  deposits: number;   // "Кол-во продаж" + "Кол-во повторных продаж"
  revenue: number;    // "Сумма продаж" + "Сумма повторных продаж"
  unsubscribes: number;
}

// CRM ad-level export keyed by ad NAME (primary source for Ads mode) — same shape,
// "Название" is the raw Meta ad name instead of the numeric ad id.
export interface CrmAdByNameRow {
  adName: string;
  pdp: number;
  dia: number;
  registrations: number;
  deposits: number;
  revenue: number;
  unsubscribes: number;
}

export interface LiveCampaignItem {
  campaignId: string;
  campaignName: string;
  accountName: string;
  status: LiveStatus;
  dailyBudget: number | null; // only set when status is "active"; CBO or summed active-adset (ABO)
  spend: number;
  clicks: number;
  impressions: number;
  pdp: number;
  dia: number;
  deposits: number;
  revenue: number;
  romi: number | null;    // (revenue - spend) / spend
  costPdp: number | null; // spend / pdp
  costDia: number | null; // spend / dia
}

// Ads mode is grouped by creative code, not by individual ad — one buyer runs the
// same creative naming across many campaigns/accounts, so results roll up across all of them.
export interface LiveCreativeItem {
  creativeCode: string; // the exact ad name, untouched — this IS the Creative Code convention
  adCount: number;      // distinct Meta ads rolled into this group, for context
  status: LiveStatus;   // "active" if any of its ads is currently ACTIVE in Meta
  // Sum of daily_budget across every distinct active campaign this creative appears in —
  // intentionally overlaps with other creatives sharing the same campaign, by design.
  activeDailyBudget: number;
  spend: number;
  clicks: number;
  impressions: number;
  pdp: number;
  dia: number;
  deposits: number;
  revenue: number;
  romi: number | null;
  costPdp: number | null;
  costDia: number | null;
}
