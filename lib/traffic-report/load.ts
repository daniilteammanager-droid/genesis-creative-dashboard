import { warehouse, selectAll } from "@/lib/warehouse/read";
import { NO_CABINETS, resolveScope } from "@/lib/warehouse/accounts";
import type { Profile } from "@/lib/auth/types";
import { faceInName } from "@/lib/warehouse/check";
import { buyerCodeIn, parseName, textNoOf } from "@/lib/creatives/code";
import { addCrm, cellsOf, countRejects, geoOf, noCrm, REST, splitCells, type Cell, type CellCrm, type Rejects, type Sums, type SpendRow, type TorroRow } from "./build";
import { merge, policiesOf, type CurrentRow, type EventRow } from "@/lib/mcp/rejects";
import { creativeOfTitle, geoOfTitle, regionOfCabinet } from "@/lib/tgads/names";

// Отчёт по трафику из склада (Decision 098). Баеру — свои подключения, владельцу и
// тимлиду — вся команда или один баер (resolveScope, как у Live Manager).

export interface TrafficReport {
  since: string;
  until: string;
  buyers: { id: string; label: string }[];
  isBuyer: boolean;
  // Ячейки баер × страна × лицо × воронка × площадка × крео: фильтры и дерево — на странице
  // (filterCells, treeOf), чтобы фильтр пересчитывал итоги без нового запроса.
  cells: Cell[];
  // Крео баера за всё время (все страны) и его последний статус — рядом с цифрами периода.
  // active: хоть одно объявление с этим именем сейчас крутится; null — объявлений в складе нет.
  creos: CreoAllTime[];
  // Только клики на ленде или квалы (splitCells) — по просьбе (withCrm), для get_stats AI-доступа.
  crmOnly?: Cell[];
  notice?: string;
}
// geos — то же всё время по странам (страна — как у цифр периода): по нему этап крео и «ROMI всё время» строки.
// rejects — отклонённые объявления Meta с этим крео у баера, всё время; нет — крео только в TG Ads (модерация своя).
export interface CreoAllTime { buyer: string; creo: string; sums: Sums; geos: Record<string, Sums>; rejects?: Rejects; active: boolean | null; first?: string }

type Crm = { subscribers: number | null; dialogs: number | null; dep_count: number | null; dep_sum: number | string | null; redep_sum: number | string | null;
  clicks?: number | null; qual_a?: number | null; qual_b?: number | null; qual_c?: number | null; qual_d?: number | null; qual_e?: number | null };
const crmOf = (r: Crm): CellCrm | undefined => {
  const q = [r.qual_a ?? 0, r.qual_b ?? 0, r.qual_c ?? 0, r.qual_d ?? 0, r.qual_e ?? 0], lp = r.clicks ?? 0;
  return lp || q.some(Boolean) ? { lp, q } : undefined;
};
const CRM_COLS = "clicks, qual_a, qual_b, qual_c, qual_d, qual_e";
const torroOf = (r: Crm) => ({
  subs: r.subscribers ?? 0, dia: r.dialogs ?? 0, deps: r.dep_count ?? 0,
  rev: Number(r.dep_sum ?? 0) + Number(r.redep_sum ?? 0),
});

// allTime: false — без «ROMI всё время» у крео (creos пустой): отчёту в Telegram он не нужен, а это лишний обход склада.
export async function loadTrafficReport(me: Profile, since: string, until: string, buyerFilter?: string, opts: { allTime?: boolean; withCrm?: boolean } = {}): Promise<TrafficReport> {
  const db = warehouse();
  const { buyers, userIds, accountIds } = await resolveScope(db, me, buyerFilter);
  const empty: TrafficReport = { since, until, buyers, isBuyer: me.role === "buyer", cells: [], creos: [] };
  if (accountIds !== null && accountIds.length === 0) return { ...empty, notice: NO_CABINETS };
  if (!userIds.length) return empty;
  const label = new Map(buyers.map((b) => [b.id, b.label]));

  // Расход — баеру, за кем закреплён кабинет; без закрепления — кто записал строку.
  const { data: own } = await db.from("wh_account_owners").select("account_id, owner_user_id").in("owner_user_id", userIds);
  const owner = new Map((own ?? []).map((o) => [o.account_id as string, o.owner_user_id as string]));
  const toRows = await spendRowsOf(db, userIds, owner, label);
  const torroRange = <T>(table: string, cols: string, order: string[]) => selectAll<T>((from, to) => {
    let q = db.from(table).select(cols).in("user_id", userIds).gte("period_start", since).lte("period_start", until);
    for (const o of order) q = q.order(o);
    return q.range(from, to);
  });
  const [pairs, campaigns] = await Promise.all([
    torroRange<Crm & { user_id: string; period_start: string; campaign_name: string; ad_name: string }>(
      "wh_crm_pairs", `user_id, period_start, campaign_name, ad_name, subscribers, dialogs, dep_count, dep_sum, redep_sum, ${CRM_COLS}`,
      ["user_id", "period_start", "campaign_name", "ad_name"]),
    torroRange<Crm & { user_id: string; period_start: string; period_end: string; campaign_name: string }>(
      "wh_crm_campaign_periods", `user_id, period_start, period_end, campaign_name, subscribers, dialogs, dep_count, dep_sum, redep_sum, ${CRM_COLS}`,
      ["user_id", "period_start", "campaign_name"]),
  ]);
  const torro: TorroRow[] = pairs.map((p) => ({ buyer: label.get(p.user_id) ?? p.user_id, campaign: p.campaign_name, ad: p.ad_name, ...torroOf(p), crm: crmOf(p) }));

  const days = await selectAll<Day>((from, to) => {
    const q = db.from("wh_ad_days").select(COLS).gte("date", since).lte("date", until);
    return (accountIds ? q.in("account_id", accountIds) : q).order("date").order("ad_id").range(from, to);
  });
  // Крео без спенда в периоде (деп со старого трафика): страну, лицо и воронку знает его
  // прошлый расход в кабинетах баера. В суммы эти строки не идут — только подсказка.
  const spent = new Set(days.map((d) => (d.ad_name ?? "").trim()));
  const orphans = [...new Set(pairs.map((p) => p.ad_name.trim()).filter((n) => n && !spent.has(n)))];
  const history: Day[] = [];
  for (let i = 0; i < orphans.length && owner.size; i += 200) {
    history.push(...await selectAll<Day>((from, to) => db.from("wh_ad_days").select(COLS)
      .in("ad_name", orphans.slice(i, i + 200)).in("account_id", [...owner.keys()]).lt("date", since)
      .order("date").order("ad_id").range(from, to)));
  }
  const spend = [...await toRows(days), ...await toRows(history, true)];

  // Что Torro по кампаниям дал сверх связок за тот же день — «не разнесено» у баера.
  type T4 = ReturnType<typeof torroOf>;
  const byDay = new Map<string, { camp: T4; pair: T4 }>();
  const slot = (k: string) => byDay.get(k) ?? byDay.set(k, { camp: { subs: 0, dia: 0, deps: 0, rev: 0 }, pair: { subs: 0, dia: 0, deps: 0, rev: 0 } }).get(k)!;
  const plus = (a: T4, b: T4) => { a.subs += b.subs; a.dia += b.dia; a.deps += b.deps; a.rev += b.rev; };
  for (const c of campaigns) if (c.period_start === c.period_end) plus(slot(`${c.user_id}|${c.period_start}`).camp, torroOf(c));
  for (const p of pairs) plus(slot(`${p.user_id}|${p.period_start}`).pair, torroOf(p));
  const crmDay = new Map<string, { camp: CellCrm; pair: CellCrm }>();
  const cslot = (k: string) => crmDay.get(k) ?? crmDay.set(k, { camp: noCrm(), pair: noCrm() }).get(k)!;
  for (const c of campaigns) { const x = c.period_start === c.period_end ? crmOf(c) : undefined; if (x) addCrm(cslot(`${c.user_id}|${c.period_start}`).camp, x); }
  for (const p of pairs) { const x = crmOf(p); if (x) addCrm(cslot(`${p.user_id}|${p.period_start}`).pair, x); }
  const rest = new Map<string, T4 & { crm?: CellCrm }>();
  for (const [k, { camp, pair }] of byDay) {
    const who = label.get(k.split("|")[0]) ?? k.split("|")[0];
    const r = rest.get(who) ?? rest.set(who, { subs: 0, dia: 0, deps: 0, rev: 0 }).get(who)!;
    r.subs += Math.max(0, camp.subs - pair.subs); r.dia += Math.max(0, camp.dia - pair.dia);
    r.deps += Math.max(0, camp.deps - pair.deps); r.rev += Math.max(0, camp.rev - pair.rev);
    const cc = crmDay.get(k);
    if (cc) addCrm(r.crm ??= noCrm(), { lp: Math.max(0, cc.camp.lp - cc.pair.lp), q: cc.camp.q.map((v, i) => Math.max(0, v - cc.pair.q[i])) });
  }

  const { cells, crmOnly } = splitCells(spend, torro, rest);
  return { ...empty, cells, crmOnly: opts.withCrm ? crmOnly : undefined, creos: opts.allTime === false ? [] : await allTimeOf(db, cells, userIds, owner, label, toRows) };
}

type Day = { user_id: string; account_id: string | null; ad_name: string; adset_id: string | null; campaign_name: string | null; source: string; spend: number | string; impressions: number; clicks: number; date?: string };
const COLS = "user_id, account_id, ad_name, adset_id, campaign_name, source, spend, impressions, clicks";
type ToRows = (days: Day[], hint?: boolean) => Promise<SpendRow[]>;

// Строки склада → строки расхода отчёта: баер — за кем кабинет, страна — таргет адсета (Decision 045), иначе имя
// кампании и код крео. Одна для периода и для всего времени крео — страна этапа та же, что у цифр.
// hint — только подсказка, где крео крутилось (страна, лицо, воронка): цифры нулями.
async function spendRowsOf(db: ReturnType<typeof warehouse>, userIds: string[], owner: Map<string, string>, label: Map<string, string>): Promise<ToRows> {
  const inScope = new Set(userIds);
  // Лицо TG Ads — из названия кабинета, как в чеке (в именах TG Ads лица нет). Регион кабинета — им делятся
  // каналы и «…-es-multi» (16.11.2026); гео TG считается здесь, а не берётся из склада, — так верна и вся история.
  const { data: tgKeys } = await db.from("tgads_keys").select("account_id, name, account_title").in("user_id", userIds);
  const tgFace = new Map((tgKeys ?? []).map((k) => [k.account_id as string, faceInName(k.name as string) ?? ""]));
  const tgRegion = new Map((tgKeys ?? []).map((k) => [k.account_id as string, regionOfCabinet(`${k.account_title ?? ""} ${k.name}`)]));
  const countries = new Map<string, string[]>();
  return async (days, hint = false) => {
    const adsetIds = [...new Set(days.map((d) => d.adset_id).filter((a): a is string => Boolean(a) && !countries.has(a!)))];
    for (let i = 0; i < adsetIds.length; i += 300) {
      const { data } = await db.from("wh_adsets").select("adset_id, countries").in("adset_id", adsetIds.slice(i, i + 300));
      for (const a of data ?? []) countries.set(a.adset_id as string, (a.countries as string[] | null) ?? []);
    }
    const out: SpendRow[] = [];
    for (const d of days) {
      const who = owner.get(d.account_id ?? "") ?? d.user_id;
      if (!inScope.has(who)) continue;
      const name = parseName(d.campaign_name ?? "");
      const tg = d.source === "tgads";
      out.push({
        buyer: label.get(who) ?? who, campaign: d.campaign_name ?? "", ad: d.ad_name ?? "",
        geo: (tg ? geoOfTitle(d.campaign_name ?? "", tgRegion.get(d.account_id ?? "") ?? null) : null)
          ?? geoOf(countries.get(d.adset_id ?? "") ?? [], d.campaign_name ?? "", d.ad_name ?? ""),
        face: (tg ? tgFace.get(d.account_id ?? "") : null) || name.face || "", funnel: name.funnel ?? (tg ? "TG" : ""), platform: tg ? "tg" : "fb",
        spend: hint ? 0 : Number(d.spend) || 0, impr: hint ? 0 : Number(d.impressions) || 0, clicks: hint ? 0 : Number(d.clicks) || 0,
      });
    }
    return out;
  };
}

// Новый текст или перемонтаж: текст «bN + tN» новый, если ни одна его версия не крутилась до `before`.
// Возвращает ключи «bN|tN», у которых расход до `before` был. Имена без кода текста — не сюда.
// ponytail: по запросу с limit 1 на текст, по 10 разом; текстов за неделю десятки.
export const textKey = (name: string) => {
  const b = buyerCodeIn(name), t = textNoOf(name);
  return b && t ? `${b}|${t}` : null;
};
export async function oldTextsOf(keys: string[], before: string): Promise<Set<string>> {
  const db = warehouse(), old = new Set<string>();
  for (let i = 0; i < keys.length; i += 10) {
    await Promise.all(keys.slice(i, i + 10).map(async (k) => {
      const [b, t] = k.split("|");
      const { data } = await db.from("wh_ad_days").select("ad_name").lt("date", before).gt("spend", 0)
        .or(`ad_name.ilike.*-${t}-v*-${b}-*,ad_name.ilike.*-${t}-v*-${b}`).limit(20);
      if ((data ?? []).some((r) => textKey(r.ad_name as string) === k)) old.add(k);
    }));
  }
  return old;
}

// Всё время крео: спенд по объявлениям с тем же именем в кабинетах баера, Torro — по связкам
// с тем же объявлением, статус — последнее состояние объявлений (wh_entities, раз в час).
// По странам — теми же cellsOf и toRows, что период: этап крео на странице (Daniil 17.11.2026).
// ponytail: читает все дни этих крео; станет медленно — копить итоги крео в отдельной таблице.
async function allTimeOf(db: ReturnType<typeof warehouse>, cells: Cell[], userIds: string[], owner: Map<string, string>, label: Map<string, string>, toRows: ToRows): Promise<CreoAllTime[]> {
  const names = [...new Set(cells.filter((c) => c.geo !== REST).map((c) => c.creo))];
  const accounts = [...owner.keys()];
  if (!names.length || !accounts.length) return [];
  const out = new Map<string, CreoAllTime>();
  const slot = (buyer: string, creo: string) => {
    const k = `${buyer}\u0000${creo}`;
    return out.get(k) ?? out.set(k, { buyer, creo, sums: { spend: 0, impr: 0, clicks: 0, subs: 0, dia: 0, deps: 0, rev: 0 }, geos: {}, active: null }).get(k)!;
  };
  const days: Day[] = [], torro: TorroRow[] = [];
  for (let i = 0; i < names.length; i += 200) {
    const part = names.slice(i, i + 200);
    const [d, pairs] = await Promise.all([
      selectAll<Day>((from, to) =>
        db.from("wh_ad_days").select(`${COLS}, date`).in("ad_name", part).in("account_id", accounts)
          .order("date").order("ad_id").range(from, to)),
      selectAll<{ user_id: string; campaign_name: string; ad_name: string } & Crm>((from, to) =>
        db.from("wh_crm_pairs").select("user_id, campaign_name, ad_name, subscribers, dialogs, dep_count, dep_sum, redep_sum").in("user_id", userIds).in("ad_name", part)
          .order("period_start").order("campaign_name").order("ad_name").range(from, to)),
    ]);
    days.push(...d);
    for (const p of pairs) torro.push({ buyer: label.get(p.user_id) ?? p.user_id, campaign: p.campaign_name, ad: p.ad_name, ...torroOf(p) });
  }
  const life = cellsOf(await toRows(days), torro);
  const meta = new Set<string>();   // «баер × крео», что крутились в Facebook: у них реджекты считаем, у TG Ads — нет
  for (const c of [...cells, ...life]) if (c.platform === "fb") meta.add(`${c.buyer}\u0000${c.creo}`);
  for (const c of life) {
    const x = slot(c.buyer, c.creo), g = (x.geos[c.geo] ??= { spend: 0, impr: 0, clicks: 0, subs: 0, dia: 0, deps: 0, rev: 0 });
    for (const k of Object.keys(x.sums) as (keyof Sums)[]) { x.sums[k] += c.sums[k]; g[k] += c.sums[k]; }
  }
  // Первый день с расходом за всё время — по нему штаб и MCP видят новые запуски.
  for (const d of days) {
    if ((Number(d.spend) || 0) <= 0 || !d.date) continue;
    const who = owner.get(d.account_id ?? "") ?? d.user_id, c = slot(label.get(who) ?? who, (d.ad_name ?? "").trim());
    if (!c.first || d.date < c.first) c.first = d.date;
  }
  // Реджекты: тот же разбор, что у get_rejects (Decision 123) — текущие отклонения + история, только Meta.
  // ponytail: вся история этих кабинетов (на 24.11 — ~1,3 тыс. объявлений на команду); вырастет — фильтр по именам в запрос.
  const [current, events, ents] = await Promise.all([
    selectAll<CurrentRow>((from, to) => db.from("wh_rejected_ads").select("ad_id, account_id, ad_name, campaign_name, adset_name, status, reason, first_seen_at")
      .in("account_id", accounts).order("ad_id").range(from, to)),
    selectAll<EventRow>((from, to) => db.from("antireject_events").select("created_at, kind, ad_id, account_id, ad_name, campaign_name, actor, text, ok, status")
      .in("account_id", accounts).order("created_at").order("id").range(from, to)),
    selectAll<{ account_id: string; name: string | null; effective_status: string | null; source: string; missing: boolean }>((from, to) =>
      db.from("wh_entities").select("account_id, name, effective_status, source, missing").eq("level", "ad").in("account_id", accounts)
        .order("entity_id").range(from, to)),
  ]);
  const rejects = countRejects(merge(current, events).map((a) => {
    const who = owner.get(a.accountId) ?? "";
    return { buyer: label.get(who) ?? who, creo: a.name, times: a.times.length, now: !!a.status, policies: policiesOf(a.reason) };
  }));
  // Статус: у Meta имя объявления — само крео, у TG Ads — заголовок, крео из него.
  const wanted = new Set(names);
  for (const e of ents) {
    const creo = e.source === "tgads" ? creativeOfTitle(e.name ?? "") : (e.name ?? "").trim();
    if (!wanted.has(creo)) continue;
    const who = owner.get(e.account_id) ?? "", c = slot(label.get(who) ?? who, creo);
    c.active = Boolean(c.active) || (!e.missing && (e.effective_status ?? "").toUpperCase() === "ACTIVE");
  }
  for (const c of out.values()) {
    const k = `${c.buyer}\u0000${c.creo}`;
    if (meta.has(k)) c.rejects = rejects.get(k) ?? { n: 0, ads: 0, now: 0, reasons: [] };
  }
  return [...out.values()];
}
