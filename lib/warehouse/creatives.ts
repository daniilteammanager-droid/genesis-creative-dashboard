import { warehouse, selectAll } from "./read";
import { parseCreativeCode, geoOf, approachOf, buyerOf } from "@/lib/creatives/code";
import type { Profile } from "@/lib/auth/types";

// Раздел «Креативы»: что крутилось за период и что оно принесло.
//
// Строки задают ПОДКЛЮЧЕНИЯ баера — его объявления из Meta и его выгрузки Torro
// (Decision 036). Файлы в R2 по владельцу не фильтруются: легаси-крео, которыми
// льют до сих пор, лежат в общих папках, и делить их не надо.

export interface CreativeRow {
  code: string;              // имя объявления, оно же код креатива
  scheme: "v2" | "legacy";
  medium?: string;
  approach: string;
  geo: string;
  language?: string;
  buyerFromCode?: string;    // bN из имени — для сверки, не для доступа
  owners: string[];          // чьи подключения дали эту строку

  spend: number;
  clicks: number;            // клик по объявлению, из Meta
  impressions: number;
  adCount: number;
  campaigns: number;

  // Из выгрузок Torro. null означает «колонки не было в выгрузке», а не ноль.
  crmClicks: number | null;  // клик на лендинге — другая величина, чем clicks
  subscribers: number | null;
  dialogs: number | null;
  registrations: number | null;
  depCount: number | null;
  depSum: number | null;
  redepCount: number | null;
  redepSum: number | null;
}

export interface CreativesResult {
  since: string;
  until: string;
  rows: CreativeRow[];
  buyers: { id: string; label: string }[];
  // Периоды выгрузок, попавшие в диапазон не целиком. По ним депозиты показать
  // нельзя: недельное число не делится по дням, а делить его пропорционально
  // значит придумать цифру.
  partialPeriods: { since: string; until: string }[];
  totals: { spend: number; clicks: number; impressions: number; depSum: number; depCount: number };
  generatedAt: string;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

// Складываем только то, что реально пришло: null плюс число даёт число, null
// плюс null остаётся null. Иначе «не выгружали» превратилось бы в ноль.
function addNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

export async function loadCreatives(
  me: Profile,
  since: string,
  until: string,
  buyerFilter?: string
): Promise<CreativesResult> {
  const db = warehouse();

  // ─── Кого показываем ─────────────────────────────────────────────────────
  // Баер видит только себя, что бы ни пришло в параметрах.
  const { data: buyerProfiles } = await db
    .from("profiles")
    .select("id, name, email, buyer_code")
    .eq("role", "buyer")
    .order("buyer_code", { ascending: true });

  const buyers = (buyerProfiles ?? []).map((b) => ({
    id: b.id as string,
    label: (b.name as string) || (b.buyer_code as string) || (b.email as string),
  }));

  const scope =
    me.role === "buyer"
      ? [me.id]
      : buyerFilter && buyers.some((b) => b.id === buyerFilter)
        ? [buyerFilter]
        : buyers.map((b) => b.id);

  const empty: CreativesResult = {
    since, until, rows: [], buyers, partialPeriods: [],
    totals: { spend: 0, clicks: 0, impressions: 0, depSum: 0, depCount: 0 },
    generatedAt: new Date().toISOString(),
  };
  if (scope.length === 0) return empty;

  // ─── Meta: дни объявлений ────────────────────────────────────────────────
  type AdDay = {
    user_id: string; ad_name: string; ad_id: string; campaign_id: string | null;
    spend: number | string; clicks: number; impressions: number;
  };
  const adDays = await selectAll<AdDay>((from, to) =>
    db.from("wh_ad_days")
      .select("user_id, ad_name, ad_id, campaign_id, spend, clicks, impressions")
      .in("user_id", scope).gte("date", since).lte("date", until).range(from, to)
  );

  // ─── Torro: периоды по имени объявления ──────────────────────────────────
  // Берём только периоды, целиком лежащие внутри запрошенного диапазона.
  // Задетый краем период дал бы цифры за дни вне диапазона.
  type CrmPeriod = {
    user_id: string; ad_name: string; period_start: string; period_end: string;
    clicks: number | null; subscribers: number | null; dialogs: number | null;
    registrations: number | null; dep_count: number | null; dep_sum: number | string | null;
    redep_count: number | null; redep_sum: number | string | null;
  };
  const crm = await selectAll<CrmPeriod>((from, to) =>
    db.from("wh_crm_ad_periods")
      .select("user_id, ad_name, period_start, period_end, clicks, subscribers, dialogs, registrations, dep_count, dep_sum, redep_count, redep_sum")
      .in("user_id", scope).gte("period_end", since).lte("period_start", until).range(from, to)
  );

  const inside = crm.filter((r) => r.period_start >= since && r.period_end <= until);
  const partialKeys = new Set<string>();
  for (const r of crm) {
    if (r.period_start < since || r.period_end > until) partialKeys.add(`${r.period_start}_${r.period_end}`);
  }

  // ─── Сборка по коду креатива ─────────────────────────────────────────────
  const rows = new Map<string, CreativeRow>();

  function blank(code: string): CreativeRow {
    const parsed = parseCreativeCode(code);
    return {
      code,
      scheme: parsed.scheme,
      medium: parsed.scheme === "v2" ? parsed.medium : undefined,
      approach: approachOf(code),
      geo: geoOf(code),
      language: parsed.scheme === "v2" ? parsed.language : undefined,
      buyerFromCode: buyerOf(code),
      owners: [],
      spend: 0, clicks: 0, impressions: 0, adCount: 0, campaigns: 0,
      crmClicks: null, subscribers: null, dialogs: null, registrations: null,
      depCount: null, depSum: null, redepCount: null, redepSum: null,
    };
  }

  const adIds = new Map<string, Set<string>>();
  const campaignIds = new Map<string, Set<string>>();

  for (const d of adDays) {
    const code = (d.ad_name ?? "").trim();
    if (!code) continue;
    const row = rows.get(code) ?? blank(code);
    row.spend += num(d.spend);
    row.clicks += num(d.clicks);
    row.impressions += num(d.impressions);
    if (!row.owners.includes(d.user_id)) row.owners.push(d.user_id);

    if (!adIds.has(code)) adIds.set(code, new Set());
    adIds.get(code)!.add(d.ad_id);
    if (d.campaign_id) {
      if (!campaignIds.has(code)) campaignIds.set(code, new Set());
      campaignIds.get(code)!.add(d.campaign_id);
    }
    rows.set(code, row);
  }

  for (const c of inside) {
    const code = (c.ad_name ?? "").trim();
    if (!code) continue;
    // Крео без расхода, но с деньгами — не мусор: депозит пишется в день, когда
    // он сделан, а крео могли выключить неделю назад. Такую строку показываем.
    const row = rows.get(code) ?? blank(code);
    row.crmClicks = addNullable(row.crmClicks, c.clicks);
    row.subscribers = addNullable(row.subscribers, c.subscribers);
    row.dialogs = addNullable(row.dialogs, c.dialogs);
    row.registrations = addNullable(row.registrations, c.registrations);
    row.depCount = addNullable(row.depCount, c.dep_count);
    row.depSum = addNullable(row.depSum, c.dep_sum === null ? null : num(c.dep_sum));
    row.redepCount = addNullable(row.redepCount, c.redep_count);
    row.redepSum = addNullable(row.redepSum, c.redep_sum === null ? null : num(c.redep_sum));
    if (!row.owners.includes(c.user_id)) row.owners.push(c.user_id);
    rows.set(code, row);
  }

  const list = [...rows.values()].map((r) => ({
    ...r,
    adCount: adIds.get(r.code)?.size ?? 0,
    campaigns: campaignIds.get(r.code)?.size ?? 0,
  }));

  list.sort((a, b) => b.spend - a.spend || a.code.localeCompare(b.code));

  return {
    since, until, rows: list, buyers,
    partialPeriods: [...partialKeys].map((k) => {
      const [s, u] = k.split("_");
      return { since: s, until: u };
    }),
    // Итоги считаются из сумм базовых чисел, а не усреднением строк — то же
    // правило, что и в General Report 3.0 (Decision 024).
    totals: {
      spend: list.reduce((s, r) => s + r.spend, 0),
      clicks: list.reduce((s, r) => s + r.clicks, 0),
      impressions: list.reduce((s, r) => s + r.impressions, 0),
      depSum: list.reduce((s, r) => s + (r.depSum ?? 0) + (r.redepSum ?? 0), 0),
      depCount: list.reduce((s, r) => s + (r.depCount ?? 0) + (r.redepCount ?? 0), 0),
    },
    generatedAt: new Date().toISOString(),
  };
}
