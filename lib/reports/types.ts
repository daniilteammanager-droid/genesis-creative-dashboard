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

export interface FbtoolApiError {
  statusCode: number;
  errorMessage: string;
  rawBody: string;
  // Request params sent to FBTool API — API key stripped before storing
  requestParams: Record<string, unknown>;
  accountId: string;
  dateRange: { from: string; to: string };
  timestamp: string;
}

// Diagnostics for MVP parsing / FBTool matching — populated for Auto Report only
export interface ReportDebugInfo {
  selectedSheet: string;
  mvpRawRowCount: number;
  mvpFirst5RawRows: unknown[][];
  mvpDetectedColumns: Record<string, string | null> | null;
  mvpParsedCampaignIds: string[]; // first 10
  mvpParsedCount: number;
  fbtoolCampaignCount: number;
  fbtoolFirst10CampaignIds: string[];
  matchedCount: number;
  warnings: string[];
}

export interface ReportData {
  rows: ReportRow[];
  summary: ReportSummary;
  generatedAt: string;
  dataFile: { mvp: string; fbtool: string };
  sheets: string[];
  selectedSheet: string;
  dateRange?: { from: string; to: string };
  fbtoolSource?: "api" | "local";
  apiErrors?: FbtoolApiError[];
  debug?: ReportDebugInfo;
}
