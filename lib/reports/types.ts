export type ReportScope      = "all" | "artem" | "matvey" | "andrey";
export type DatasetType      = "all_data" | "daily" | "weekly";
export type EntityType       = "campaign" | "creative";
export type TimeGrain        = "weekly" | "daily";
// Creative reports match by ad name, not campaign_id
export type CreativeMatchType = "campaign_id" | "ad_name";

export interface MvpRow {
  campaignId: string;
  pdp: number;
  dia: number;
  deposits: number;
  revenue: number;
}

export interface FbtoolCampaign {
  campaignId: string;
  campaignName: string;
  accountName: string;
  spend: number;
  clicks: number;
  impressions: number;
  status: string;          // campaign.status
  effectiveStatus: string; // campaign.effective_status
}

export type SourceStatus = "matched" | "mvp_only" | "fbtool_spend_only";

export interface ReportRow {
  campaignId: string;
  campaignName: string;
  accountName: string;
  spend: number;
  clicks: number;
  impressions: number;
  pdp: number;
  dia: number;
  deposits: number;
  revenue: number;
  costPdp: number | null;
  costDia: number | null;
  romi: number | null;
  sourceStatus: SourceStatus;
  status: string;          // campaign.status from FBTool; "" when no FB data
  effectiveStatus: string; // campaign.effective_status from FBTool; "" when no FB data
}

export interface ReportSummary {
  totalSpend: number;
  totalClicks: number;
  totalImpressions: number;
  totalPdp: number;
  totalDia: number;
  totalDeposits: number;
  totalRevenue: number;
  avgCostPdp: number | null;
  avgCostDia: number | null;
  romi: number | null;
  warningsCount: number;
}
