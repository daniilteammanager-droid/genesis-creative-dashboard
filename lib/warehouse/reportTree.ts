import { warehouse, selectAll } from "./read";
import { resolveScope } from "./accounts";
import type { Profile } from "@/lib/auth/types";

// Reports как аналог FB Tool: кампании, внутри адсеты, внутри объявления.
//
// Всё считается из ОДНОГО набора дневных строк уровня объявления — адсеты и
// кампании это group by, а не отдельные запросы. adset_id приходит в строках
// уровня ad бесплатно (замерено 31.08.2026: в 100% строк).
//
// Депозиты на объявлении и на адсете берутся из выгрузки по id объявления.
// Из выгрузки по названию их взять нельзя: она предагрегирована по имени и
// между объявлениями не делится.

export interface TreeNode {
  id: string;
  name: string;
  level: "campaign" | "adset" | "ad";
  spend: number;
  clicks: number;
  impressions: number;
  subscribers: number | null;
  dialogs: number | null;
  depCount: number | null;
  depSum: number | null;
  children?: TreeNode[];
}

export interface ReportTreeResult {
  since: string;
  until: string;
  nodes: TreeNode[];
  buyers: { id: string; label: string }[];
  // Страница Reports клиентская и роль сама не знает. Отдаём её здесь, чтобы
  // переключатель баеров не показывался тому, кому он ничего не даёт.
  isBuyer: boolean;
  totals: { spend: number; clicks: number; impressions: number; depSum: number };
  // Почему пусто. Пустая таблица без объяснения читается как поломка.
  notice?: string;
  generatedAt: string;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
};

// null плюс число даёт число, null плюс null остаётся null: «не выгружали» не
// должно превращаться в ноль.
function add(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

export async function loadReportTree(
  me: Profile,
  since: string,
  until: string,
  buyerFilter?: string
): Promise<ReportTreeResult> {
  const db = warehouse();

  const { data: connected } = await db.from("buyer_connections").select("user_id");
  const ids = [...new Set((connected ?? []).map((c) => c.user_id as string))];
  const { data: profiles } = ids.length
    ? await db.from("profiles").select("id, name, email, buyer_code").in("id", ids)
    : { data: [] as { id: string; name: string | null; email: string; buyer_code: string | null }[] };

  const buyers = (profiles ?? []).map((b) => ({
    id: b.id as string,
    label: (b.name as string) || (b.buyer_code as string) || (b.email as string),
  }));

  const { userIds: scope, accountIds } = await resolveScope(db, me, buyerFilter);

  if (accountIds !== null && accountIds.length === 0) {
    return {
      since, until, nodes: [], buyers, isBuyer: me.role === "buyer",
      totals: { spend: 0, clicks: 0, impressions: 0, depSum: 0 },
      notice: "Кабинеты ещё не распределены — попроси владельца назначить их на странице «Команда».",
      generatedAt: new Date().toISOString(),
    };
  }

  const empty: ReportTreeResult = {
    since, until, nodes: [], buyers, isBuyer: me.role === "buyer",
    totals: { spend: 0, clicks: 0, impressions: 0, depSum: 0 },
    generatedAt: new Date().toISOString(),
  };
  if (scope.length === 0) return empty;

  type AdDay = {
    ad_id: string; ad_name: string;
    adset_id: string | null; adset_name: string | null;
    campaign_id: string | null; campaign_name: string | null;
    account_id: string | null; date: string;
    spend: number | string; clicks: number; impressions: number;
  };
  const days = await selectAll<AdDay>((from, to) => {
    const q = db.from("wh_ad_days")
      .select("ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, account_id, date, spend, clicks, impressions")
      .gte("date", since).lte("date", until);
    return (accountIds ? q.in("account_id", accountIds) : q)
      .order("user_id").order("date").order("ad_id")
      .range(from, to);
  });

  type CrmAd = {
    ad_id: string; period_start: string; period_end: string;
    subscribers: number | null; dialogs: number | null;
    dep_count: number | null; dep_sum: number | string | null;
    redep_count: number | null; redep_sum: number | string | null;
  };
  const crmRaw = await selectAll<CrmAd>((from, to) =>
    db.from("wh_crm_ad_id_periods")
      .select("ad_id, period_start, period_end, subscribers, dialogs, dep_count, dep_sum, redep_count, redep_sum")
      .in("user_id", scope).gte("period_end", since).lte("period_start", until)
      .order("user_id").order("period_start").order("ad_id")
      .range(from, to)
  );
  // Только периоды, целиком лежащие внутри диапазона: задетый краем принёс бы
  // цифры за дни снаружи.
  const crmByAd = new Map<string, { subscribers: number | null; dialogs: number | null; depCount: number | null; depSum: number | null }>();
  for (const c of crmRaw) {
    if (c.period_start < since || c.period_end > until) continue;
    const cur = crmByAd.get(c.ad_id) ?? { subscribers: null, dialogs: null, depCount: null, depSum: null };
    cur.subscribers = add(cur.subscribers, c.subscribers);
    cur.dialogs = add(cur.dialogs, c.dialogs);
    cur.depCount = add(cur.depCount, add(c.dep_count, c.redep_count));
    cur.depSum = add(cur.depSum, add(
      c.dep_sum === null ? null : num(c.dep_sum),
      c.redep_sum === null ? null : num(c.redep_sum)
    ));
    crmByAd.set(c.ad_id, cur);
  }

  // ─── Объявления ──────────────────────────────────────────────────────────
  const ads = new Map<string, TreeNode & { adsetId: string; campaignId: string; adsetName: string; campaignName: string }>();
  // Один и тот же день одного объявления мог прийти от двух токенов сразу —
  // считаем один раз (Decision 052).
  const seenAdDay = new Set<string>();

  for (const d of days) {
    const dayKey = `${d.date}|${d.ad_id}`;
    if (seenAdDay.has(dayKey)) continue;
    seenAdDay.add(dayKey);
    const key = d.ad_id;
    const node = ads.get(key) ?? {
      id: key, name: d.ad_name || key, level: "ad" as const,
      spend: 0, clicks: 0, impressions: 0,
      subscribers: null, dialogs: null, depCount: null, depSum: null,
      adsetId: d.adset_id || "—", adsetName: d.adset_name || "Без адсета",
      campaignId: d.campaign_id || "—", campaignName: d.campaign_name || "Без кампании",
    };
    node.spend += num(d.spend);
    node.clicks += num(d.clicks);
    node.impressions += num(d.impressions);
    ads.set(key, node);
  }
  for (const [adId, node] of ads) {
    const c = crmByAd.get(adId);
    if (c) Object.assign(node, c);
  }

  // ─── Адсеты и кампании — сворачиваем вверх ───────────────────────────────
  function fold(nodes: TreeNode[], id: string, name: string, level: TreeNode["level"]): TreeNode {
    return {
      id, name, level,
      spend: nodes.reduce((s, n) => s + n.spend, 0),
      clicks: nodes.reduce((s, n) => s + n.clicks, 0),
      impressions: nodes.reduce((s, n) => s + n.impressions, 0),
      subscribers: nodes.reduce<number | null>((s, n) => add(s, n.subscribers), null),
      dialogs: nodes.reduce<number | null>((s, n) => add(s, n.dialogs), null),
      depCount: nodes.reduce<number | null>((s, n) => add(s, n.depCount), null),
      depSum: nodes.reduce<number | null>((s, n) => add(s, n.depSum), null),
      children: nodes.sort((a, b) => b.spend - a.spend),
    };
  }

  const byCampaign = new Map<string, Map<string, TreeNode[]>>();
  const campaignNames = new Map<string, string>();
  const adsetNames = new Map<string, string>();

  for (const node of ads.values()) {
    campaignNames.set(node.campaignId, node.campaignName);
    adsetNames.set(node.adsetId, node.adsetName);
    if (!byCampaign.has(node.campaignId)) byCampaign.set(node.campaignId, new Map());
    const sets = byCampaign.get(node.campaignId)!;
    if (!sets.has(node.adsetId)) sets.set(node.adsetId, []);
    sets.get(node.adsetId)!.push(node);
  }

  const nodes: TreeNode[] = [];
  for (const [campaignId, sets] of byCampaign) {
    const adsetNodes = [...sets.entries()].map(([adsetId, adNodes]) =>
      fold(adNodes, adsetId, adsetNames.get(adsetId) ?? adsetId, "adset")
    );
    nodes.push(fold(adsetNodes, campaignId, campaignNames.get(campaignId) ?? campaignId, "campaign"));
  }
  nodes.sort((a, b) => b.spend - a.spend);

  return {
    since, until, nodes, buyers, isBuyer: me.role === "buyer",
    totals: {
      spend: nodes.reduce((s, n) => s + n.spend, 0),
      clicks: nodes.reduce((s, n) => s + n.clicks, 0),
      impressions: nodes.reduce((s, n) => s + n.impressions, 0),
      depSum: nodes.reduce((s, n) => s + (n.depSum ?? 0), 0),
    },
    generatedAt: new Date().toISOString(),
  };
}
