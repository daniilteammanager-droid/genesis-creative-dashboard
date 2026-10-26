import { warehouse, selectAll } from "./read";
import { NO_CABINETS, resolveScope } from "./accounts";
import type { Profile } from "@/lib/auth/types";
import { faceInName } from "./check";
import { parseName } from "@/lib/creatives/code";

// Reports как аналог FB Tool: кампании, внутри адсеты, внутри объявления.
//
// Расход — из ОДНОГО набора дневных строк уровня объявления: адсеты и кампании —
// это group by, а не отдельные запросы.
//
// Torro (Decision 070) id не отдаёт, только имена:
//   кампания   — срез Torro по имени кампании: точная цифра, даже если объявления
//                кампании между собой не делятся;
//   объявление — связка «кампания × объявление» (wh_crm_pairs). Одно имя дважды в
//                одной кампании (в двух адсетах) делить нечем — тогда только на кампании.
//                День, который связки ещё не разложили, — по выгрузке по id объявления;
//   кампании только из Torro (их кабинет не подключён) — в конце дерева, без расхода,
//                и в итог с ROMI не идут.

export type Quals = [number, number, number, number, number];   // A–E

export interface TreeNode {
  id: string;
  name: string;
  level: "campaign" | "adset" | "ad";
  spend: number;
  clicks: number;
  impressions: number;
  lpClicks: number | null;      // клики на ленде — из Torro
  subscribers: number | null;
  dialogs: number | null;
  depCount: number | null;
  depSum: number | null;
  quals: Quals | null;
  outside?: boolean;            // только в Torro: кабинет не подключён
  // Для Live Manager: кабинет (куда писать паузу и бюджет), страны таргета и лицо
  // из имени кампании — для фильтров GEO и «лицо».
  accountId?: string;
  countries?: string[];
  face?: string | null;
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
  // Кампании только из Torro: сколько и что принесли.
  outside: { campaigns: number; subscribers: number; depSum: number } | null;
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

type Crm = Pick<TreeNode, "lpClicks" | "subscribers" | "dialogs" | "depCount" | "depSum" | "quals">;
const NO_CRM = (): Crm => ({ lpClicks: null, subscribers: null, dialogs: null, depCount: null, depSum: null, quals: null });

function addQuals(a: Quals | null, b: Quals | null): Quals | null {
  if (!a) return b ? [...b] as Quals : null;
  if (!b) return a;
  return a.map((v, i) => v + b[i]) as Quals;
}
function addCrm(to: Crm, c: Crm): void {
  to.lpClicks = add(to.lpClicks, c.lpClicks);
  to.subscribers = add(to.subscribers, c.subscribers);
  to.dialogs = add(to.dialogs, c.dialogs);
  to.depCount = add(to.depCount, c.depCount);
  to.depSum = add(to.depSum, c.depSum);
  to.quals = addQuals(to.quals, c.quals);
}

type CrmRow = {
  clicks?: number | null; subscribers: number | null; dialogs: number | null;
  dep_count: number | null; dep_sum: number | string | null; redep_count: number | null; redep_sum: number | string | null;
  qual_a?: number | null; qual_b?: number | null; qual_c?: number | null; qual_d?: number | null; qual_e?: number | null;
};
const toCrm = (c: CrmRow): Crm => ({
  lpClicks: c.clicks ?? null,
  subscribers: c.subscribers, dialogs: c.dialogs,
  depCount: add(c.dep_count, c.redep_count),
  depSum: add(c.dep_sum === null ? null : num(c.dep_sum), c.redep_sum === null ? null : num(c.redep_sum)),
  quals: c.qual_a === undefined || c.qual_a === null ? null
    : [c.qual_a ?? 0, c.qual_b ?? 0, c.qual_c ?? 0, c.qual_d ?? 0, c.qual_e ?? 0],
});
const METRICS = "clicks, subscribers, dialogs, dep_count, dep_sum, redep_count, redep_sum";
const QUAL_COLS = "qual_a, qual_b, qual_c, qual_d, qual_e";

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

  const empty: ReportTreeResult = {
    since, until, nodes: [], buyers, isBuyer: me.role === "buyer",
    totals: { spend: 0, clicks: 0, impressions: 0, depSum: 0 }, outside: null,
    generatedAt: new Date().toISOString(),
  };
  if (accountIds !== null && accountIds.length === 0) return { ...empty, notice: NO_CABINETS };
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

  // Torro — только дневные строки внутри диапазона (у API каждый день — свой период).
  const range = <T>(table: string, cols: string, order: string) => selectAll<T>((from, to) =>
    db.from(table).select(cols).in("user_id", scope).gte("period_start", since).lte("period_start", until)
      .order("user_id").order("period_start").order(order).range(from, to));
  const [campaignCrm, pairs, adIdCrm] = await Promise.all([
    range<CrmRow & { user_id: string; period_start: string; campaign_name: string }>("wh_crm_campaign_periods", `user_id, period_start, campaign_name, ${METRICS}, ${QUAL_COLS}`, "campaign_name"),
    range<CrmRow & { user_id: string; period_start: string; campaign_name: string; ad_name: string }>("wh_crm_pairs", `user_id, period_start, campaign_name, ad_name, ${METRICS}, ${QUAL_COLS}`, "campaign_name"),
    range<CrmRow & { user_id: string; period_start: string; ad_id: string }>("wh_crm_ad_id_periods", `user_id, period_start, ad_id, ${METRICS}`, "ad_id"),
  ]);

  // ─── Объявления ──────────────────────────────────────────────────────────
  type AdNode = TreeNode & { adsetId: string; campaignId: string; adsetName: string; campaignName: string };
  const accountOf = new Map<string, string>();   // кампания / адсет → кабинет
  const ads = new Map<string, AdNode>();
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
      spend: 0, clicks: 0, impressions: 0, ...NO_CRM(),
      adsetId: d.adset_id || "—", adsetName: d.adset_name || "Без адсета",
      campaignId: d.campaign_id || "—", campaignName: d.campaign_name || "Без кампании",
      accountId: d.account_id ?? undefined,
    };
    if (d.account_id) {
      if (d.campaign_id) accountOf.set(d.campaign_id, d.account_id);
      if (d.adset_id) accountOf.set(d.adset_id, d.account_id);
    }
    node.spend += num(d.spend);
    node.clicks += num(d.clicks);
    node.impressions += num(d.impressions);
    ads.set(key, node);
  }

  // Связки: «кампания × объявление» → узел объявления, если он один такой.
  const byPair = new Map<string, AdNode[]>();
  for (const a of ads.values()) {
    const k = `${a.campaignName.trim()}|${a.name.trim()}`;
    byPair.set(k, [...(byPair.get(k) ?? []), a]);
  }
  const campaignNames = new Set([...ads.values()].map((a) => a.campaignName.trim()));
  const paired = new Set(pairs.map((p) => `${p.user_id}|${p.period_start}`));
  const outsideAds = new Map<string, Map<string, Crm>>();   // кампания → объявление → цифры
  for (const p of pairs) {
    const nodes = byPair.get(`${p.campaign_name.trim()}|${p.ad_name.trim()}`);
    if (nodes?.length === 1) addCrm(nodes[0], toCrm(p));
    else if (!campaignNames.has(p.campaign_name.trim())) {
      const m = outsideAds.get(p.campaign_name) ?? new Map<string, Crm>();
      const c = m.get(p.ad_name) ?? NO_CRM();
      addCrm(c, toCrm(p));
      m.set(p.ad_name, c);
      outsideAds.set(p.campaign_name, m);
    }
  }
  // Дни, которые связки ещё не разложили, — по выгрузке по id объявления.
  for (const c of adIdCrm) {
    if (paired.has(`${c.user_id}|${c.period_start}`)) continue;
    const node = ads.get(c.ad_id);
    if (node) addCrm(node, toCrm(c));
  }

  // Кампания — срезом Torro по её имени: он точен, даже когда объявления не делятся.
  const crmByCampaign = new Map<string, Crm>();
  for (const c of campaignCrm) {
    const cur = crmByCampaign.get(c.campaign_name.trim()) ?? NO_CRM();
    addCrm(cur, toCrm(c));
    crmByCampaign.set(c.campaign_name.trim(), cur);
  }

  // ─── Адсеты и кампании — сворачиваем вверх ───────────────────────────────
  function fold(nodes: TreeNode[], id: string, name: string, level: TreeNode["level"], crm?: Crm): TreeNode {
    const sum = NO_CRM();
    for (const n of nodes) addCrm(sum, n);
    return {
      id, name, level,
      spend: nodes.reduce((s, n) => s + n.spend, 0),
      clicks: nodes.reduce((s, n) => s + n.clicks, 0),
      impressions: nodes.reduce((s, n) => s + n.impressions, 0),
      ...(crm ?? sum),
      children: nodes.sort((a, b) => b.spend - a.spend),
    };
  }

  const byCampaign = new Map<string, Map<string, TreeNode[]>>();
  const nameOfCampaign = new Map<string, string>();
  const adsetNames = new Map<string, string>();

  for (const node of ads.values()) {
    nameOfCampaign.set(node.campaignId, node.campaignName);
    adsetNames.set(node.adsetId, node.adsetName);
    if (!byCampaign.has(node.campaignId)) byCampaign.set(node.campaignId, new Map());
    const sets = byCampaign.get(node.campaignId)!;
    if (!sets.has(node.adsetId)) sets.set(node.adsetId, []);
    sets.get(node.adsetId)!.push(node);
  }

  // Одно имя у двух кампаний (в разных кабинетах) — срез по имени делить нечем,
  // тогда у каждой — сумма её объявлений.
  const nameCount = new Map<string, number>();
  for (const name of nameOfCampaign.values()) nameCount.set(name.trim(), (nameCount.get(name.trim()) ?? 0) + 1);

  // Страны — из таргета адсета (Decision 045), как в Креативах.
  const adsetIds = [...adsetNames.keys()].filter((id) => id !== "—");
  const geoOf = new Map<string, string[]>();
  for (let i = 0; i < adsetIds.length; i += 300) {
    const { data } = await db.from("wh_adsets").select("adset_id, countries").in("adset_id", adsetIds.slice(i, i + 300));
    for (const a of data ?? []) geoOf.set(a.adset_id as string, (a.countries as string[]) ?? []);
  }

  const nodes: TreeNode[] = [];
  for (const [campaignId, sets] of byCampaign) {
    const adsetNodes = [...sets.entries()].map(([adsetId, adNodes]) => ({
      ...fold(adNodes, adsetId, adsetNames.get(adsetId) ?? adsetId, "adset"),
      accountId: accountOf.get(adsetId), countries: geoOf.get(adsetId) ?? [],
    }));
    const name = nameOfCampaign.get(campaignId) ?? campaignId;
    const exact = nameCount.get(name.trim()) === 1 ? crmByCampaign.get(name.trim()) : undefined;
    nodes.push({
      ...fold(adsetNodes, campaignId, name, "campaign", exact),
      accountId: accountOf.get(campaignId), face: parseName(name).face ?? faceInName(name),
      countries: [...new Set(adsetNodes.flatMap((a) => a.countries))].sort(),
    });
  }
  nodes.sort((a, b) => b.spend - a.spend);

  // ─── Кампании только из Torro ────────────────────────────────────────────
  const outsideNodes: TreeNode[] = [];
  for (const [name, crm] of crmByCampaign) {
    if (campaignNames.has(name)) continue;
    const children = [...(outsideAds.get(name) ?? new Map<string, Crm>())].map(([ad, c]): TreeNode => ({
      id: `torro|${name}|${ad}`, name: ad, level: "ad", spend: 0, clicks: 0, impressions: 0, ...c, outside: true,
    })).sort((a, b) => (b.depSum ?? 0) - (a.depSum ?? 0) || (b.subscribers ?? 0) - (a.subscribers ?? 0));
    outsideNodes.push({
      id: `torro|${name}`, name, level: "campaign", spend: 0, clicks: 0, impressions: 0, ...crm,
      outside: true, children: children.length ? children : undefined,
    });
  }
  outsideNodes.sort((a, b) => (b.depSum ?? 0) - (a.depSum ?? 0) || (b.subscribers ?? 0) - (a.subscribers ?? 0));

  return {
    since, until, nodes: [...nodes, ...outsideNodes], buyers, isBuyer: me.role === "buyer",
    totals: {
      spend: nodes.reduce((s, n) => s + n.spend, 0),
      clicks: nodes.reduce((s, n) => s + n.clicks, 0),
      impressions: nodes.reduce((s, n) => s + n.impressions, 0),
      depSum: nodes.reduce((s, n) => s + (n.depSum ?? 0), 0),
    },
    outside: outsideNodes.length ? {
      campaigns: outsideNodes.length,
      subscribers: outsideNodes.reduce((s, n) => s + (n.subscribers ?? 0), 0),
      depSum: outsideNodes.reduce((s, n) => s + (n.depSum ?? 0), 0),
    } : null,
    generatedAt: new Date().toISOString(),
  };
}
