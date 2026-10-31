import { warehouse, selectAll } from "./read";
import { NO_CABINETS, resolveScope } from "./accounts";
import type { Profile } from "@/lib/auth/types";
import { buildDetail, type CreativeDetail, type SpendDay, type TorroDay } from "@/lib/creatives/detail";

// Модалка крео: все цифры одного крео за период и по неделям, со склада. Видимость —
// как у Отчётов и Live Manager (resolveScope): баеру — его кабинеты и его Torro,
// владельцу и тимлиду — вся команда. Крео — точное имя объявления, по всем странам.

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// since === null — «всё время»: с первого дня, когда крео тратило в доступных кабинетах.
export async function loadCreativeDetail(me: Profile, code: string, since: string | null, until: string): Promise<CreativeDetail> {
  const db = warehouse();
  const { userIds, accountIds } = await resolveScope(db, me);
  const empty = (notice?: string): CreativeDetail => ({
    code, since: since ?? until, until, sums: buildDetail(code, until, until, [], []).sums, weeks: [], countries: [], firstDay: null, notice,
  });
  if (accountIds !== null && accountIds.length === 0) return empty(NO_CABINETS);
  if (!userIds.length) return empty();

  const firstQ = db.from("wh_ad_days").select("date").eq("ad_name", code);
  const { data: first } = await (accountIds ? firstQ.in("account_id", accountIds) : firstQ).order("date").limit(1);
  const firstDay = (first?.[0]?.date as string | undefined) ?? null;
  const from = since ?? firstDay ?? until;

  type Day = { date: string; ad_id: string; adset_id: string | null; spend: number | string; impressions: number | string; clicks: number | string };
  const rows = await selectAll<Day>((f, t) => {
    const q = db.from("wh_ad_days").select("date, ad_id, adset_id, spend, impressions, clicks").eq("ad_name", code)
      .gte("date", from).lte("date", until);
    return (accountIds ? q.in("account_id", accountIds) : q).order("date").order("ad_id").range(f, t);
  });
  // Один день одного объявления могли записать ключи двух человек — цифры в них одинаковые.
  const seen = new Set<string>();
  const spend: SpendDay[] = [];
  for (const r of rows) {
    if (seen.has(`${r.date}|${r.ad_id}`)) continue;
    seen.add(`${r.date}|${r.ad_id}`);
    spend.push({ date: r.date, spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks) });
  }

  // Torro — связки «кампания × объявление» по дням, как в Отчётах: депы ложатся в свой день.
  type Pair = { period_start: string; subscribers: number | null; dialogs: number | null; dep_count: number | null; dep_sum: number | string | null; redep_sum: number | string | null };
  const pairs = await selectAll<Pair>((f, t) =>
    db.from("wh_crm_pairs").select("period_start, subscribers, dialogs, dep_count, dep_sum, redep_sum")
      .in("user_id", userIds).eq("ad_name", code).gte("period_start", from).lte("period_start", until)
      .order("period_start").order("campaign_name").range(f, t));
  const torro: TorroDay[] = pairs.map((p) => ({
    date: p.period_start, subs: p.subscribers ?? 0, dia: p.dialogs ?? 0, deps: p.dep_count ?? 0,
    rev: num(p.dep_sum) + num(p.redep_sum),
  }));

  const adsetIds = [...new Set(rows.map((r) => r.adset_id).filter((a): a is string => Boolean(a)))];
  const countries = new Set<string>();
  for (let i = 0; i < adsetIds.length; i += 300) {
    const { data } = await db.from("wh_adsets").select("countries").in("adset_id", adsetIds.slice(i, i + 300));
    for (const a of data ?? []) for (const c of (a.countries as string[] | null) ?? []) countries.add(c);
  }

  const built = buildDetail(code, from, until, spend, torro);
  return {
    ...built,
    countries: [...countries].sort(),
    firstDay,
    notice: !firstDay && !torro.length ? "На складе этого крео нет: по нему не было расхода в подключённых кабинетах." : undefined,
  };
}
