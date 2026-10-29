import { warehouse, selectAll } from "@/lib/warehouse/read";
import { NO_CABINETS, resolveScope } from "@/lib/warehouse/accounts";
import type { Profile } from "@/lib/auth/types";
import { buildReport, geoOf, totalOf, type Metrics, type ReportNode, type SpendRow, type Sums, type TorroRow } from "./build";

// Отчёт по трафику из склада (Decision 098). Баеру — свои подключения, владельцу и
// тимлиду — вся команда или один баер (resolveScope, как у Live Manager).

export interface TrafficReport {
  since: string;
  until: string;
  buyers: { id: string; label: string }[];
  isBuyer: boolean;
  nodes: ReportNode[];
  total: { sums: Sums; m: Metrics };
  notice?: string;
}

type Crm = { subscribers: number | null; dialogs: number | null; dep_count: number | null; dep_sum: number | string | null; redep_sum: number | string | null };
const torroOf = (r: Crm) => ({
  subs: r.subscribers ?? 0, dia: r.dialogs ?? 0, deps: r.dep_count ?? 0,
  rev: Number(r.dep_sum ?? 0) + Number(r.redep_sum ?? 0),
});

export async function loadTrafficReport(me: Profile, since: string, until: string, buyerFilter?: string): Promise<TrafficReport> {
  const db = warehouse();
  const { buyers, userIds, accountIds } = await resolveScope(db, me, buyerFilter);
  const empty: TrafficReport = { since, until, buyers, isBuyer: me.role === "buyer", nodes: [], total: totalOf([]) };
  if (accountIds !== null && accountIds.length === 0) return { ...empty, notice: NO_CABINETS };
  if (!userIds.length) return empty;
  const label = new Map(buyers.map((b) => [b.id, b.label]));
  const inScope = new Set(userIds);

  // Расход — баеру, за кем закреплён кабинет; без закрепления — кто записал строку.
  const { data: own } = await db.from("wh_account_owners").select("account_id, owner_user_id").in("owner_user_id", userIds);
  const owner = new Map((own ?? []).map((o) => [o.account_id as string, o.owner_user_id as string]));
  const days = await selectAll<{ user_id: string; account_id: string | null; ad_name: string; adset_id: string | null; campaign_name: string | null; spend: number | string; impressions: number; clicks: number }>((from, to) => {
    const q = db.from("wh_ad_days").select("user_id, account_id, ad_name, adset_id, campaign_name, spend, impressions, clicks")
      .gte("date", since).lte("date", until);
    return (accountIds ? q.in("account_id", accountIds) : q).order("date").order("ad_id").range(from, to);
  });
  const adsetIds = [...new Set(days.map((d) => d.adset_id).filter((a): a is string => Boolean(a)))];
  const countries = new Map<string, string[]>();
  for (let i = 0; i < adsetIds.length; i += 300) {
    const { data } = await db.from("wh_adsets").select("adset_id, countries").in("adset_id", adsetIds.slice(i, i + 300));
    for (const a of data ?? []) countries.set(a.adset_id as string, (a.countries as string[] | null) ?? []);
  }
  const spend: SpendRow[] = [];
  for (const d of days) {
    const who = owner.get(d.account_id ?? "") ?? d.user_id;
    if (!inScope.has(who)) continue;
    spend.push({
      buyer: label.get(who) ?? who, campaign: d.campaign_name ?? "", ad: d.ad_name ?? "",
      geo: geoOf(countries.get(d.adset_id ?? "") ?? [], d.campaign_name ?? ""),
      spend: Number(d.spend) || 0, impr: Number(d.impressions) || 0, clicks: Number(d.clicks) || 0,
    });
  }

  const torroRange = <T>(table: string, cols: string, order: string[]) => selectAll<T>((from, to) => {
    let q = db.from(table).select(cols).in("user_id", userIds).gte("period_start", since).lte("period_start", until);
    for (const o of order) q = q.order(o);
    return q.range(from, to);
  });
  const [pairs, campaigns] = await Promise.all([
    torroRange<Crm & { user_id: string; period_start: string; campaign_name: string; ad_name: string }>(
      "wh_crm_pairs", "user_id, period_start, campaign_name, ad_name, subscribers, dialogs, dep_count, dep_sum, redep_sum",
      ["user_id", "period_start", "campaign_name", "ad_name"]),
    torroRange<Crm & { user_id: string; period_start: string; period_end: string; campaign_name: string }>(
      "wh_crm_campaign_periods", "user_id, period_start, period_end, campaign_name, subscribers, dialogs, dep_count, dep_sum, redep_sum",
      ["user_id", "period_start", "campaign_name"]),
  ]);
  const torro: TorroRow[] = pairs.map((p) => ({ buyer: label.get(p.user_id) ?? p.user_id, campaign: p.campaign_name, ad: p.ad_name, ...torroOf(p) }));

  // Что Torro по кампаниям дал сверх связок за тот же день — «не разнесено» у баера.
  type T4 = ReturnType<typeof torroOf>;
  const byDay = new Map<string, { camp: T4; pair: T4 }>();
  const slot = (k: string) => byDay.get(k) ?? byDay.set(k, { camp: { subs: 0, dia: 0, deps: 0, rev: 0 }, pair: { subs: 0, dia: 0, deps: 0, rev: 0 } }).get(k)!;
  const plus = (a: T4, b: T4) => { a.subs += b.subs; a.dia += b.dia; a.deps += b.deps; a.rev += b.rev; };
  for (const c of campaigns) if (c.period_start === c.period_end) plus(slot(`${c.user_id}|${c.period_start}`).camp, torroOf(c));
  for (const p of pairs) plus(slot(`${p.user_id}|${p.period_start}`).pair, torroOf(p));
  const rest = new Map<string, T4>();
  for (const [k, { camp, pair }] of byDay) {
    const who = label.get(k.split("|")[0]) ?? k.split("|")[0];
    const r = rest.get(who) ?? rest.set(who, { subs: 0, dia: 0, deps: 0, rev: 0 }).get(who)!;
    r.subs += Math.max(0, camp.subs - pair.subs); r.dia += Math.max(0, camp.dia - pair.dia);
    r.deps += Math.max(0, camp.deps - pair.deps); r.rev += Math.max(0, camp.rev - pair.rev);
  }

  const nodes = buildReport(spend, torro, rest);
  return { ...empty, nodes, total: totalOf(nodes) };
}
