import type { FbtoolCampaign } from "./types";

// Accepts the raw parsed JSON object from a FBTool export.
// Expected shape:
//   { data: Array<{ name: string, campaigns: { data: Campaign[] } }> }
// Campaign: { id, name, status, effective_status, insights?: { data: Insight[] } }
// Insight:  { spend, clicks, impressions }
export function parseFbtoolReport(raw: unknown): FbtoolCampaign[] {
  const root = raw as Record<string, unknown>;
  const accounts = Array.isArray(root?.data) ? (root.data as unknown[]) : [];

  const results: FbtoolCampaign[] = [];

  for (const acc of accounts) {
    const account = acc as Record<string, unknown>;
    const accountName = String(account?.name ?? "");
    const campaigns = (account?.campaigns as Record<string, unknown>)?.data;
    if (!Array.isArray(campaigns)) continue;

    for (const c of campaigns) {
      const camp = c as Record<string, unknown>;
      const campaignId = String(camp?.id ?? "").trim();
      if (!campaignId) continue;

      const insights = ((camp?.insights as Record<string, unknown>)?.data ?? []) as unknown[];
      let spend = 0, clicks = 0, impressions = 0;
      for (const ins of insights) {
        const row = ins as Record<string, unknown>;
        spend       += parseFloat(String(row?.spend       ?? "0")) || 0;
        clicks      += parseInt(String(row?.clicks      ?? "0"), 10) || 0;
        impressions += parseInt(String(row?.impressions ?? "0"), 10) || 0;
      }

      results.push({
        campaignId,
        campaignName:   String(camp?.name ?? ""),
        accountName,
        spend,
        clicks,
        impressions,
        status:         String(camp?.status           ?? ""),
        effectiveStatus: String(camp?.effective_status ?? ""),
      });
    }
  }

  return results;
}
