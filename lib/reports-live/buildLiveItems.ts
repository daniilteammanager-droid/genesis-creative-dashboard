import type { MvpRow } from "@/lib/reports/types";
import type { MetaCampaignRow, MetaAdRow, CrmAdRow, CrmAdByNameRow, LiveCampaignItem, LiveCreativeItem, LiveStatus } from "./types";

function romi(revenue: number, spend: number): number | null {
  return spend > 0 ? (revenue - spend) / spend : null;
}

function costPer(spend: number, count: number): number | null {
  return count > 0 ? spend / count : null;
}

// CRM export is the source of truth for "which campaigns/ads to show" per period;
// rows with zero activity on both sides (common placeholder rows in the export) are noise.
function hasActivity(spend: number, pdp: number, dia: number, deposits: number, revenue: number, clicks: number): boolean {
  return spend > 0 || pdp > 0 || dia > 0 || deposits > 0 || revenue > 0 || clicks > 0;
}

// Sentinel id for the merged "Долёты" row — campaigns with no Meta match at all
// (no spend, no real name) get folded into one bucket instead of cluttering the table.
export const DOLETYI_ID = "__doletyi__";

export function buildLiveCampaignItems(
  crm: MvpRow[],
  meta: MetaCampaignRow[],
  statuses: Map<string, string>,
  campaignBudgets: Map<string, number>
): LiveCampaignItem[] {
  const metaById = new Map(meta.map((m) => [m.campaignId, m]));

  const items: LiveCampaignItem[] = [];
  let doletyi: LiveCampaignItem | null = null;

  for (const c of crm) {
    const m = metaById.get(c.campaignId);
    const spend = m?.spend ?? 0;
    const clicks = m?.clicks ?? 0;
    const impressions = m?.impressions ?? 0;
    if (!hasActivity(spend, c.pdp, c.dia, c.deposits, c.revenue, clicks)) continue;

    if (!m) {
      doletyi ??= {
        campaignId: DOLETYI_ID, campaignName: "Долёты", accountName: "—", status: "unknown", dailyBudget: null,
        spend: 0, clicks: 0, impressions: 0, pdp: 0, dia: 0, deposits: 0, revenue: 0,
        romi: null, costPdp: null, costDia: null,
      };
      doletyi.pdp += c.pdp;
      doletyi.dia += c.dia;
      doletyi.deposits += c.deposits;
      doletyi.revenue += c.revenue;
      continue;
    }

    const status: LiveStatus = statuses.get(c.campaignId) === "ACTIVE" ? "active" : statuses.has(c.campaignId) ? "paused" : "unknown";

    items.push({
      campaignId: c.campaignId,
      campaignName: m.campaignName,
      accountName: m.accountName,
      status,
      dailyBudget: status === "active" ? (campaignBudgets.get(c.campaignId) ?? null) : null,
      spend, clicks, impressions,
      pdp: c.pdp, dia: c.dia, deposits: c.deposits, revenue: c.revenue,
      romi: romi(c.revenue, spend),
      costPdp: costPer(spend, c.pdp),
      costDia: costPer(spend, c.dia),
    });
  }

  // Spend is primary. A campaign that really spent money but has no CRM row for the period
  // still belongs in the report with zeroed CRM metrics — the same rule the Check Module
  // follows. Dropping it silently under-reported total spend, while its daily budget still
  // counted toward the header total, so the header and the table disagreed by design.
  const crmIds = new Set(crm.map((c) => c.campaignId));
  for (const [campaignId, m] of metaById) {
    if (crmIds.has(campaignId)) continue;
    if (!hasActivity(m.spend, 0, 0, 0, 0, m.clicks)) continue;

    const status: LiveStatus = statuses.get(campaignId) === "ACTIVE" ? "active" : statuses.has(campaignId) ? "paused" : "unknown";

    items.push({
      campaignId,
      campaignName: m.campaignName,
      accountName: m.accountName,
      status,
      dailyBudget: status === "active" ? (campaignBudgets.get(campaignId) ?? null) : null,
      spend: m.spend, clicks: m.clicks, impressions: m.impressions,
      pdp: 0, dia: 0, deposits: 0, revenue: 0,
      romi: romi(0, m.spend),
      costPdp: null,
      costDia: null,
    });
  }

  if (doletyi) {
    doletyi.romi = romi(doletyi.revenue, doletyi.spend);
    doletyi.costPdp = costPer(doletyi.spend, doletyi.pdp);
    doletyi.costDia = costPer(doletyi.spend, doletyi.dia);
    items.push(doletyi);
  }

  return items;
}

// A creative IS its exact ad name — never transformed, never uppercased, never
// stripped of a country suffix. The naming convention is deliberately designed for
// scripted exact-matching; touching it breaks that on purpose-built infrastructure.
//
// The same ad name is routinely reused across many campaigns/ad accounts (that's the
// intended "same creative running everywhere" scaling pattern) — each is a distinct
// Meta Ad ID with its own real spend, so those are summed across every matching ad.
// The by-name CRM export, in contrast, is already a *pre-aggregated weekly total per
// name* — it must be added exactly once per group, not once per Ad ID sharing that name.
export function buildLiveCreativeItems(
  metaAds: MetaAdRow[],
  crmByName: CrmAdByNameRow[],
  crmById: CrmAdRow[],
  statuses: Map<string, string>,
  campaignBudgets: Map<string, number>
): LiveCreativeItem[] {
  const byName = new Map(crmByName.map((r) => [r.adName.trim(), r]));
  const byId = new Map(crmById.map((r) => [r.adId, r]));

  const groups = new Map<string, { adIds: string[]; campaignIds: Set<string>; spend: number; clicks: number; impressions: number }>();
  for (const ad of metaAds) {
    if (ad.spend <= 0 && ad.clicks <= 0 && ad.impressions <= 0) continue;
    const name = ad.adName.trim();
    const g = groups.get(name) ?? { adIds: [], campaignIds: new Set<string>(), spend: 0, clicks: 0, impressions: 0 };
    g.adIds.push(ad.adId);
    if (ad.campaignId) g.campaignIds.add(ad.campaignId);
    g.spend += ad.spend;
    g.clicks += ad.clicks;
    g.impressions += ad.impressions;
    groups.set(name, g);
  }

  // Union in CRM-only creatives too: real PDP/DIA/deposits/revenue with zero Meta spend
  // usually means missing ad-account access for that creative, not "nothing happened" —
  // worth surfacing (adCount: 0) rather than silently dropping.
  for (const row of crmByName) {
    const name = row.adName.trim();
    const hasCrm = row.pdp > 0 || row.dia > 0 || row.deposits > 0 || row.revenue > 0;
    if (hasCrm && !groups.has(name)) {
      groups.set(name, { adIds: [], campaignIds: new Set(), spend: 0, clicks: 0, impressions: 0 });
    }
  }

  return [...groups.entries()].map(([name, g]): LiveCreativeItem => {
    const byNameRow = byName.get(name);
    // Reserve path only when no name match exists — the by-id export IS per-Ad-ID,
    // so summing it across this name's ad ids is correct (unlike the by-name row above).
    const crm = byNameRow ?? g.adIds.reduce(
      (acc, id) => {
        const r = byId.get(id);
        return r ? { pdp: acc.pdp + r.pdp, dia: acc.dia + r.dia, deposits: acc.deposits + r.deposits, revenue: acc.revenue + r.revenue } : acc;
      },
      { pdp: 0, dia: 0, deposits: 0, revenue: 0 }
    );

    // Active if any ad currently carrying this exact name is active in Meta right now;
    // CRM-only rows (no ad ids at all) have no current Meta object to check — "unknown".
    const status: LiveStatus =
      g.adIds.length === 0 ? "unknown" : g.adIds.some((id) => statuses.get(id) === "ACTIVE") ? "active" : "paused";

    // Sum of the distinct active campaigns this creative runs in — a campaign running
    // several creatives contributes its budget to each of them (intentional, per request).
    let activeDailyBudget = 0;
    for (const campaignId of g.campaignIds) activeDailyBudget += campaignBudgets.get(campaignId) ?? 0;

    return {
      creativeCode: name,
      adCount: g.adIds.length,
      status,
      activeDailyBudget,
      spend: g.spend, clicks: g.clicks, impressions: g.impressions,
      pdp: crm.pdp, dia: crm.dia, deposits: crm.deposits, revenue: crm.revenue,
      romi: romi(crm.revenue, g.spend),
      costPdp: costPer(g.spend, crm.pdp),
      costDia: costPer(g.spend, crm.dia),
    };
  });
}
