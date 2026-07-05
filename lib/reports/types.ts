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

export interface ReportData {
  rows: ReportRow[];
  summary: ReportSummary;
  generatedAt: string;
  dataFile: {
    mvp: string;
    fbtool: string;
  };
  // Populated when real FBTool API is connected and one or more account requests fail
  apiErrors?: FbtoolApiError[];
}
