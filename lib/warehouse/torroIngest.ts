import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDay, toCrm, type TorroRow } from "@/lib/torro/mcp";
import { selectAll } from "./read";

// Torro по API в склад: каждый день отдельным периодом (period_start = period_end).
//
// Ложится в те же три таблицы, что и выгрузки, — читатели склада не знают, откуда
// пришли цифры, и знать не должны.
//
// Но у API нет id: Torro группирует по имени кампании и имени объявления. id
// берём из расхода этого же баера — только когда имя однозначно. Два
// объявления с одним именем делить нечем, и такое имя в by-id не пишется вовсе:
// угадать, чьи это депозиты, значит показать правдоподобную неверную цифру.
//
// Кампании пишутся по имени всегда, даже без id (Decision 070): кампания из
// неподключённого кабинета — это всё равно доход баера, терять его нельзя.

type Db = SupabaseClient;

export interface TorroIngestResult {
  crmRows: number;
  unmatchedCampaigns: number;   // имена кампаний без единственного id в расходе — записаны по имени
  unmatchedAds: number;         // то же для объявлений, в by-id не попали
}

// Имя → id, если имя встречается ровно у одного id. Неоднозначные и незнакомые
// имена не попадают в ответ.
export function uniqueIds(pairs: { id: string; name: string | null }[]): Map<string, string> {
  const seen = new Map<string, Set<string>>();
  for (const p of pairs) {
    const name = (p.name ?? "").trim();
    if (!name || !p.id) continue;
    const ids = seen.get(name) ?? new Set<string>();
    ids.add(p.id);
    seen.set(name, ids);
  }
  const out = new Map<string, string>();
  for (const [name, ids] of seen) if (ids.size === 1) out.set(name, [...ids][0]);
  return out;
}

function days(since: string, until: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${since}T00:00:00Z`); d.toISOString().slice(0, 10) <= until; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function namesToIds(db: Db, userId: string, table: "wh_ad_days" | "wh_campaign_days", names: string[]) {
  const idCol = table === "wh_ad_days" ? "ad_id" : "campaign_id";
  const nameCol = table === "wh_ad_days" ? "ad_name" : "campaign_name";
  const pairs: { id: string; name: string | null }[] = [];
  for (let i = 0; i < names.length; i += 200) {
    const chunk = names.slice(i, i + 200);
    const rows = await selectAll<Record<string, string | null>>((from, to) =>
      db.from(table).select(`${idCol}, ${nameCol}`)
        .eq("user_id", userId).in(nameCol, chunk)
        .order("date").order(idCol)
        .range(from, to)
    );
    for (const r of rows) pairs.push({ id: r[idCol] as string, name: r[nameCol] });
  }
  return uniqueIds(pairs);
}

// Записать день и убрать строки, которых в Torro за этот день больше нет: имя
// объявления поправили — старое не должно висеть рядом с новым и удваивать цифры.
async function replaceDay(db: Db, table: string, keyCol: string, userId: string, day: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict: `user_id,period_start,${keyCol}` });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  const fresh = new Set(rows.map((r) => r[keyCol] as string));
  const { data, error } = await db.from(table).select(keyCol)
    .eq("user_id", userId).eq("period_start", day).eq("period_end", day);
  if (error) throw new Error(`${table}: ${error.message}`);
  const stale = ((data ?? []) as unknown as Record<string, string>[]).map((r) => r[keyCol]).filter((k) => !fresh.has(k));
  for (let i = 0; i < stale.length; i += 200) {
    const { error: e } = await db.from(table).delete()
      .eq("user_id", userId).eq("period_start", day).eq("period_end", day)
      .in(keyCol, stale.slice(i, i + 200));
    if (e) throw new Error(`${table}: ${e.message}`);
  }
}

// Старое и новое имя переименованного объявления ведут к одному id. Две строки
// с одним ключом в одной пачке upsert не примет — складываем их заранее.
export function mergeByKey(rows: Record<string, unknown>[], keyCol: string): Record<string, unknown>[] {
  const out = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const k = r[keyCol] as string;
    const cur = out.get(k);
    if (!cur) { out.set(k, { ...r }); continue; }
    for (const [col, v] of Object.entries(r)) {
      if (typeof v === "number" && typeof cur[col] === "number") cur[col] = (cur[col] as number) + v;
    }
  }
  return [...out.values()];
}

// Квалификация A–E — сегменты CRM (seg_a_count…), как в General 4.0.
const n = (v: unknown) => (typeof v === "number" ? v : 0);
export const quals = (r: TorroRow) => ({
  qual_a: n(r.seg_a_count), qual_b: n(r.seg_b_count), qual_c: n(r.seg_c_count), qual_d: n(r.seg_d_count), qual_e: n(r.seg_e_count),
});

export function crmColumns(r: TorroRow, withUnsub: boolean) {
  const c = toCrm(r);
  return {
    clicks: c.clicks, subscribers: c.subscribers, dialogs: c.dialogs, registrations: c.registrations,
    dep_count: c.depCount, dep_sum: c.depSum, redep_count: c.redepCount, redep_sum: c.redepSum,
    ...(withUnsub ? { unsubscribes: c.unsubscribes } : {}),
  };
}

// Расход Meta за эти дни должен лежать в складе ДО вызова: id берутся из него.
export async function ingestTorro(
  db: Db, userId: string, token: string, buyerId: number, since: string, until: string
): Promise<TorroIngestResult> {
  const result: TorroIngestResult = { crmRows: 0, unmatchedCampaigns: 0, unmatchedAds: 0 };
  const base = { token, buyerId };

  for (const day of days(since, until)) {
    const [ads, campaigns] = await Promise.all([
      fetchDay({ ...base, day }, "ad_name"),
      fetchDay({ ...base, day }, "campaign_name"),
    ]);
    const now = new Date().toISOString();
    const period = { user_id: userId, period_start: day, period_end: day, updated_at: now };
    const named = (rows: TorroRow[]) => rows.filter((r) => r.group.trim());

    const adRows = named(ads);
    // trim может склеить «x» и «x » в одно имя — тоже складываем.
    const nameRows = mergeByKey(adRows.map((r) => ({ ...period, ad_name: r.group.trim(), ...crmColumns(r, true), ...quals(r) })), "ad_name");
    await replaceDay(db, "wh_crm_ad_periods", "ad_name", userId, day, nameRows);

    const adIds = await namesToIds(db, userId, "wh_ad_days", adRows.map((r) => r.group.trim()));
    const byId = adRows.filter((r) => adIds.has(r.group.trim()));
    result.unmatchedAds += adRows.length - byId.length;
    const idRows = mergeByKey(byId.map((r) => ({ ...period, ad_id: adIds.get(r.group.trim()), ...crmColumns(r, false) })), "ad_id");
    await replaceDay(db, "wh_crm_ad_id_periods", "ad_id", userId, day, idRows);

    const campaignRows = named(campaigns);
    const campaignIds = await namesToIds(db, userId, "wh_campaign_days", campaignRows.map((r) => r.group.trim()));
    result.unmatchedCampaigns += campaignRows.filter((r) => !campaignIds.has(r.group.trim())).length;
    const campaignOut = mergeByKey(campaignRows.map((r) => ({
      ...period, campaign_id: campaignIds.get(r.group.trim()) ?? null, campaign_name: r.group.trim(), ...crmColumns(r, false), ...quals(r),
    })), "campaign_name");
    await replaceDay(db, "wh_crm_campaign_periods", "campaign_name", userId, day, campaignOut);

    result.crmRows += nameRows.length + idRows.length + campaignOut.length;
  }
  return result;
}
