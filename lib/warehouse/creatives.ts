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
  // Страны из настроек таргета адсетов, в которых крутилось объявление. Это
  // ФАКТ из Meta, а не разбор имени: имена пишет человек, шаблон соблюдён не у
  // всех, и старые имена никуда не денутся (Decision 045).
  countries: string[];
  // Гео, как его понимает код креатива. Держим отдельно и только ради сверки:
  // расхождение с таргетом означает, что крео улетело не туда, куда написано.
  geoFromCode: string;
  language?: string;
  buyerFromCode?: string;    // bN из имени — для сверки, не для доступа
  // Гео в имени не совпало ни с одной страной таргета. Не ошибка расчёта, а
  // повод посмотреть: спенд ушёл не в ту страну, что указана в коде.
  geoMismatch: boolean;
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
  // Все страны, встретившиеся за период, — для фильтра. Считаются до фильтрации,
  // иначе выбранная страна осталась бы в списке одна.
  countries: string[];
  // Роль едет в ответе: страница Reports клиентская и сама её не знает.
  isBuyer: boolean;
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
  buyerFilter?: string,
  countryFilter?: string
): Promise<CreativesResult> {
  const db = warehouse();

  // ─── Кого показываем ─────────────────────────────────────────────────────
  // Список строится по тем, у кого ЕСТЬ подключения, а не по роли «баер».
  // Иначе владелец, подключивший свой ключ для проверки, не увидел бы
  // собственные данные: они лежали бы в складе и не попадали в выборку.
  const { data: connected } = await db.from("buyer_connections").select("user_id");
  const ids = [...new Set((connected ?? []).map((c) => c.user_id as string))];

  const { data: profiles } = ids.length
    ? await db.from("profiles").select("id, name, email, buyer_code, role").in("id", ids)
    : { data: [] as { id: string; name: string | null; email: string; buyer_code: string | null; role: string }[] };

  const buyers = (profiles ?? [])
    .map((b) => ({
      id: b.id as string,
      label: (b.name as string) || (b.buyer_code as string) || (b.email as string),
      sort: (b.buyer_code as string) ?? "\uffff",
    }))
    .sort((a, b) => a.sort.localeCompare(b.sort, "ru", { numeric: true }))
    .map(({ id, label }) => ({ id, label }));

  const scope =
    me.role === "buyer"
      ? [me.id]
      : buyerFilter && buyers.some((b) => b.id === buyerFilter)
        ? [buyerFilter]
        : buyers.map((b) => b.id);

  const empty: CreativesResult = {
    since, until, rows: [], buyers, countries: [], isBuyer: me.role === "buyer", partialPeriods: [],
    totals: { spend: 0, clicks: 0, impressions: 0, depSum: 0, depCount: 0 },
    generatedAt: new Date().toISOString(),
  };
  if (scope.length === 0) return empty;

  // ─── Meta: дни объявлений ────────────────────────────────────────────────
  type AdDay = {
    user_id: string; ad_name: string; ad_id: string; campaign_id: string | null;
    adset_id: string | null;
    spend: number | string; clicks: number; impressions: number;
  };
  const adDays = await selectAll<AdDay>((from, to) =>
    db.from("wh_ad_days")
      .select("user_id, ad_name, ad_id, campaign_id, adset_id, spend, clicks, impressions")
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
      countries: [],
      geoFromCode: geoOf(code),
      geoMismatch: false,
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
  const adsetIds = new Map<string, Set<string>>();

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
    if (d.adset_id) {
      if (!adsetIds.has(code)) adsetIds.set(code, new Set());
      adsetIds.get(code)!.add(d.adset_id);
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

  // ─── Страны из таргета адсетов ───────────────────────────────────────────
  const allAdsets = [...new Set([...adsetIds.values()].flatMap((s) => [...s]))];
  const geoByAdset = new Map<string, string[]>();
  for (let i = 0; i < allAdsets.length; i += 300) {
    const { data } = await db.from("wh_adsets").select("adset_id, countries").in("adset_id", allAdsets.slice(i, i + 300));
    for (const a of data ?? []) geoByAdset.set(a.adset_id as string, (a.countries as string[]) ?? []);
  }

  const list = [...rows.values()].map((r) => {
    const countries = [...new Set([...(adsetIds.get(r.code) ?? [])].flatMap((id) => geoByAdset.get(id) ?? []))].sort();
    return {
      ...r,
      countries,
      // Сверять есть смысл только когда обе стороны известны: у старых имён
      // гео не разбирается вовсе, и молчание тут не расхождение.
      geoMismatch:
        countries.length > 0 && r.geoFromCode !== "unknown"
          ? !countries.some((c) => c.toLowerCase() === r.geoFromCode.toLowerCase())
          : false,
      adCount: adIds.get(r.code)?.size ?? 0,
      campaigns: campaignIds.get(r.code)?.size ?? 0,
    };
  });

  const filtered = countryFilter ? list.filter((r) => r.countries.includes(countryFilter)) : list;
  filtered.sort((a, b) => b.spend - a.spend || a.code.localeCompare(b.code));

  return {
    since, until, rows: filtered, buyers, isBuyer: me.role === "buyer",
    countries: [...new Set(list.flatMap((r) => r.countries))].sort(),
    partialPeriods: [...partialKeys].map((k) => {
      const [s, u] = k.split("_");
      return { since: s, until: u };
    }),
    // Итоги считаются из сумм базовых чисел, а не усреднением строк — то же
    // правило, что и в General Report 3.0 (Decision 024).
    totals: {
      spend: filtered.reduce((s, r) => s + r.spend, 0),
      clicks: filtered.reduce((s, r) => s + r.clicks, 0),
      impressions: filtered.reduce((s, r) => s + r.impressions, 0),
      depSum: filtered.reduce((s, r) => s + (r.depSum ?? 0) + (r.redepSum ?? 0), 0),
      depCount: filtered.reduce((s, r) => s + (r.depCount ?? 0) + (r.redepCount ?? 0), 0),
    },
    generatedAt: new Date().toISOString(),
  };
}
