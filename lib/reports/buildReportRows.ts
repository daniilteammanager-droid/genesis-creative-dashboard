import type { MvpRow, FbtoolCampaign, ReportRow, ReportSummary } from "./types";

export function buildReportRows(
  mvpRows: MvpRow[],
  fbCampaigns: FbtoolCampaign[]
): { rows: ReportRow[]; summary: ReportSummary } {
  const mvpById = new Map<string, MvpRow>();
  for (const r of mvpRows) mvpById.set(r.campaignId, r);

  const fbById = new Map<string, FbtoolCampaign>();
  for (const c of fbCampaigns) fbById.set(c.campaignId, c);

  const allIds = new Set([...mvpById.keys(), ...fbById.keys()]);
  const rows: ReportRow[] = [];

  for (const id of allIds) {
    const mvp = mvpById.get(id);
    const fb  = fbById.get(id);

    const pdp      = mvp?.pdp      ?? 0;
    const dia      = mvp?.dia      ?? 0;
    const deposits = mvp?.deposits ?? 0;
    const revenue  = mvp?.revenue  ?? 0;
    const spend    = fb?.spend       ?? 0;
    const clicks   = fb?.clicks      ?? 0;
    const impressions = fb?.impressions ?? 0;

    // Inclusion rule: at least one metric must be non-zero
    if (!spend && !clicks && !pdp && !dia && !deposits && !revenue) continue;

    const sourceStatus =
      mvp && fb ? "matched"
      : mvp     ? "mvp_only"
      :           "fbtool_spend_only";

    rows.push({
      campaignId:      id,
      campaignName:    fb?.campaignName    ?? "",
      accountName:     fb?.accountName     ?? "",
      spend,
      clicks,
      impressions,
      pdp,
      dia,
      deposits,
      revenue,
      costPdp:         spend > 0 && pdp > 0 ? spend / pdp                      : null,
      costDia:         spend > 0 && dia > 0 ? spend / dia                      : null,
      romi:            spend > 0             ? (revenue - spend) / spend * 100  : null,
      sourceStatus,
      status:          fb?.status          ?? "",
      effectiveStatus: fb?.effectiveStatus ?? "",
    });
  }

  // Default sort: spend DESC
  rows.sort((a, b) => b.spend - a.spend);

  const summary = buildSummary(rows);
  return { rows, summary };
}

function buildSummary(rows: ReportRow[]): ReportSummary {
  let totalSpend = 0, totalClicks = 0, totalImpressions = 0;
  let totalPdp = 0, totalDia = 0, totalDeposits = 0, totalRevenue = 0;
  let warningsCount = 0;

  for (const r of rows) {
    totalSpend       += r.spend;
    totalClicks      += r.clicks;
    totalImpressions += r.impressions;
    totalPdp         += r.pdp;
    totalDia         += r.dia;
    totalDeposits    += r.deposits;
    totalRevenue     += r.revenue;
    if (r.sourceStatus === "fbtool_spend_only") warningsCount++;
  }

  return {
    totalSpend,
    totalClicks,
    totalImpressions,
    totalPdp,
    totalDia,
    totalDeposits,
    totalRevenue,
    avgCostPdp: totalSpend > 0 && totalPdp > 0 ? totalSpend / totalPdp : null,
    avgCostDia: totalSpend > 0 && totalDia > 0 ? totalSpend / totalDia : null,
    romi: totalSpend > 0 ? (totalRevenue - totalSpend) / totalSpend * 100 : null,
    warningsCount,
  };
}
