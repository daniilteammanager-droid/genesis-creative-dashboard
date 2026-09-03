import { warehouse, selectAll } from "./read";
import { resolveScope } from "./accounts";
import { reportConfigFor, type ReportConfig } from "@/lib/reports-live/config";
import { getConnection } from "@/lib/connections/store";
import { fetchCampaignInsights, fetchAdInsights, fetchCampaignMeta, fetchAdSetTargeting } from "@/lib/reports-live/metaApi";
import { listSheetTitles, fetchSheetValues } from "@/lib/general-report/googleSheets";
import { toPeriods } from "@/lib/reports-live/periods";
import { parseCrmSheet } from "./parseCrm";
import type { Profile } from "@/lib/auth/types";
import { mskDay, mskStamp } from "@/lib/day";

// Чек — то, что копируют и отправляют в телегу.
//
// Источник зависит от периода (Decision 040):
//   сегодня        — живая Meta, потому что чек за сегодня собирают «прямо
//                    сейчас», а склад отстаёт на четверть часа;
//   другой период  — склад, там цифры уже собраны и точны.
//
// Гео берётся из настроек таргета адсета, а не из имени (Decision 045).

export type CheckGroup = "campaign" | "creative" | "country";

export interface CheckRow {
  key: string;
  label: string;
  dailyBudget: number | null;   // только у живого чека по кампаниям
  spend: number;
  subscribers: number | null;
  dialogs: number | null;
  revenue: number | null;
  costPdp: number | null;
  costDia: number | null;
  romi: number | null;
}

export interface CheckResult {
  since: string;
  until: string;
  groupBy: CheckGroup;
  live: boolean;
  rows: CheckRow[];
  totalBudget: number | null;
  totals: { spend: number; revenue: number | null; romi: number | null };
  text: string;
  buyers: { id: string; label: string }[];
  // Чьими ключами добыты цифры. Без этой строки чек владельца выглядит как
  // «данные всей команды», хотя на деле это его собственные кабинеты.
  sources: string[];
  // Кого сервер реально посчитал. Интерфейс сравнивает это с выбранным и по
  // расхождению понимает, что ответ ещё в пути.
  buyer: string;
  isBuyer: boolean;
  warning?: string;
  generatedAt: string;
}

const num = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(x) ? x : 0;
};

function add(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

// Производные считаются из сумм, а не усреднением строк (Decision 024).
function derive(r: CheckRow): CheckRow {
  r.costPdp = r.subscribers && r.subscribers > 0 ? r.spend / r.subscribers : null;
  r.costDia = r.dialogs && r.dialogs > 0 ? r.spend / r.dialogs : null;
  r.romi = r.spend > 0 && r.revenue !== null ? ((r.revenue - r.spend) / r.spend) * 100 : null;
  return r;
}

// ─── Текст для телеги ────────────────────────────────────────────────────────
// Формат задан владельцем, менять его нельзя: он уходит в чат как есть.
//   Отчет по трафу / 30.08 - 13:53 / [700$]
//
//   29.08 T2A 79Genesis ES 1 - [350$]
//   125,30 / 10,44 / 25,06 / 0 / -100%
const nf = (v: number, d = 2) =>
  v.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });

// «Не знаем» и «ноль» — разные вещи, и в чате их путать нельзя. Строка вида
// «420,59 / 0 / 0 / 0 / —» читается как «подписчики бесплатные, дохода нет»,
// хотя на деле выгрузка за этот период просто не подошла.
const nfOr = (v: number | null, d = 2) => (v === null ? "—" : nf(v, d));

export function buildCheckText(rows: CheckRow[], totalBudget: number | null, now: Date): string {
  const head = `Отчет по трафу / ${mskStamp(now)}` + (totalBudget !== null ? ` / [${nf(totalBudget, 0)}$]` : "");

  const lines = [head, ""];
  for (const r of rows) {
    const budget = r.dailyBudget !== null ? ` - [${nf(r.dailyBudget, 0)}$]` : "";
    lines.push(`${r.label}${budget}`);
    lines.push(
      [nf(r.spend), nfOr(r.costPdp), nfOr(r.costDia), nfOr(r.revenue),
       r.romi === null ? "—" : `${r.romi.toFixed(0)}%`].join(" / ")
    );
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// ─── Выгрузки Torro за период ────────────────────────────────────────────────
type CrmTotals = { subscribers: number | null; dialogs: number | null; revenue: number | null };
type CrmForRange = { rows: Map<string, CrmTotals>; covered: boolean; nearest?: string };
const NO_CRM: CrmForRange = { rows: new Map(), covered: false };

// covered отвечает на вопрос «а была ли вообще выгрузка за этот период».
// Без него день без листа выглядел бы как день без единой заявки: расход есть,
// ПДП нули — и по такому чеку кампанию выключат ни за что. Так и было: командная
// выгрузка по объявлениям недельная, и чек по крео за сегодня показывал нули
// (замер 31.08.2026).
async function crmForRange(sheetId: string, since: string, until: string): Promise<CrmForRange> {
  const titles = await listSheetTitles(sheetId);
  const all = toPeriods(titles);
  const periods = all.filter((p) => p.since >= since && p.until <= until);
  if (periods.length === 0) {
    // Называем ближайший лист: «выгрузки нет» и «выгрузка недельная, а спросили
    // день» — разные беды, и чинятся они по-разному.
    const nearest = all.filter((p) => p.until >= since && p.since <= until).map((p) => p.key).sort()[0];
    return { ...NO_CRM, nearest };
  }

  const values = await fetchSheetValues(sheetId, periods.map((p) => p.key));
  const merged = new Map<string, { subscribers: number | null; dialogs: number | null; revenue: number | null }>();
  for (const p of periods) {
    for (const row of parseCrmSheet(values.get(p.key) ?? [])) {
      const cur = merged.get(row.key) ?? { subscribers: null, dialogs: null, revenue: null };
      cur.subscribers = add(cur.subscribers, row.subscribers);
      cur.dialogs = add(cur.dialogs, row.dialogs);
      cur.revenue = add(cur.revenue, add(row.depSum, row.redepSum));
      merged.set(row.key, cur);
    }
  }
  return { rows: merged, covered: true };
}

// Ключи, по которым собирается живой чек.
//
// Кабинеты у баеров разные, и одним ключом чужой расход не увидеть — поэтому
// живой чек ходит в Meta столько раз, сколько подключений попало в область
// видимости. Владелец пока льёт со своих кабинетов, а подключения у него нет:
// его ключи лежат в переменных окружения, и они добавляются к общей картине.
async function liveSources(me: Profile, scope: string[], buyerFilter?: string): Promise<ReportConfig[]> {
  const list: ReportConfig[] = [];
  for (const id of scope) {
    const c = await getConnection(id);
    if (!c?.metaToken) continue;
    list.push({
      cacheKey: id,
      metaToken: c.metaToken,
      accountScope: { includeBusinesses: false },
      campaignsSheetId: c.crmCampaignsSheetId ?? "",
      adsSheetId: c.crmAdsSheetId ?? "",
    });
  }

  if (me.role !== "buyer" && !buyerFilter) {
    const env = await reportConfigFor(me);
    if (!("missing" in env)) list.push(env);
  }

  // Один и тот же ключ дважды сложил бы расход сам с собой.
  return [...new Map(list.map((c) => [c.metaToken, c])).values()];
}

export async function loadCheck(
  me: Profile,
  since: string,
  until: string,
  groupBy: CheckGroup,
  buyerFilter?: string
): Promise<CheckResult> {
  const db = warehouse();
  const today = mskDay();
  // Живым считается чек, который целиком про сегодня. Всё прочее уже собрано.
  const live = since === until && since === today;

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

  const base: CheckResult = {
    since, until, groupBy, live, rows: [], totalBudget: null,
    totals: { spend: 0, revenue: null, romi: null }, text: "", buyers, sources: [],
    buyer: buyerFilter && buyers.some((b) => b.id === buyerFilter) ? buyerFilter : "all",
    isBuyer: me.role === "buyer", generatedAt: new Date().toISOString(),
  };
  // Пустая область видимости — приговор только для склада: он собирается по
  // подключениям, и без них там пусто. Живой чек владелец соберёт и на своих
  // ключах из переменных окружения, пока баеры ещё не подключились.
  if (!live && scope.length === 0) {
    return { ...base, text: "Подключений нет — складу не из чего собираться." };
  }

  const rows = new Map<string, CheckRow>();
  const blank = (key: string, label: string): CheckRow => ({
    key, label, dailyBudget: null, spend: 0,
    subscribers: null, dialogs: null, revenue: null,
    costPdp: null, costDia: null, romi: null,
  });

  let totalBudget: number | null = null;
  let warning: string | undefined;

  // Таргет — состояние «сейчас», а не история, поэтому за прошлые периоды он
  // берётся из склада: там его записал ночной прогон.
  const geoByAdset = new Map<string, string[]>();
  if (groupBy === "country") {
    const all = await selectAll<{ adset_id: string; countries: string[] }>((from, to) =>
      db.from("wh_adsets").select("adset_id, countries").order("adset_id").range(from, to)
    );
    for (const a of all) geoByAdset.set(a.adset_id, a.countries ?? []);
  }

  // Одна страна — доход адсета принадлежит ей. Несколько — делить нечем, и такие
  // сводятся в отдельную строку, а не размазываются (Decision 045).
  const countryKey = (adsetId: string): string => {
    const c = geoByAdset.get(adsetId) ?? [];
    if (c.length === 1) return c[0];
    if (c.length > 1) return "несколько стран";
    return "страна не определена";
  };

  const buyerLabel = new Map(buyers.map((b) => [b.id, b.label]));
  let sourceLabels: string[] = scope.map((id) => buyerLabel.get(id) ?? id);


  // Страна имени объявления, а не отдельного объявления.
  //
  // Выгрузка Torro агрегирована по имени: одна строка на имя, все адсеты вместе.
  // Если объявления с этим именем крутятся в адсетах на разные страны, разделить
  // доход между ними нечем — и раньше он целиком уезжал в страну того адсета,
  // который оказался последним в ответе Meta. Испания получала +200%, Италия
  // −100%, хотя привели обе.
  //
  // Поэтому такое имя целиком — и расход, и доход — уходит в строку «несколько
  // стран». Точно так же, как уже сделано для адсета, таргетящего несколько
  // стран: страновой разрез не имеет права угадывать.
  function countryByName(pairs: { name: string; adsetId: string }[]): Map<string, string> {
    const seen = new Map<string, Set<string>>();
    for (const { name, adsetId } of pairs) {
      if (!name) continue;
      const set = seen.get(name) ?? new Set<string>();
      set.add(countryKey(adsetId));
      seen.set(name, set);
    }
    return new Map([...seen].map(([name, set]) =>
      [name, set.size === 1 ? [...set][0] : "несколько стран"]
    ));
  }

  // Кабинеты, которые ещё никому не отдали, баер не видит. Пустой список — это
  // не «расхода нет», а «кабинеты не распределены», и говорить об этом надо вслух.
  if (accountIds !== null && accountIds.length === 0) {
    return { ...base, text: "Кабинеты ещё не распределены — попроси владельца назначить их на странице «Команда»." };
  }
  // Живая Мета отдаёт всё, что видит токен, поэтому фильтровать приходится и
  // здесь: иначе чек за сегодня противоречил бы отчётам за вчера.
  const ownAccount = (id: string | undefined) =>
    accountIds === null || (id !== undefined && accountIds.includes(id.replace(/^act_/, "")));

  if (live) {
    const sources = await liveSources(me, scope, buyerFilter);
    sourceLabels = sources.map((c) =>
      c.cacheKey === "team" ? "мои кабинеты (ключи из окружения)" : buyerLabel.get(c.cacheKey) ?? c.cacheKey
    );
    if (sources.length === 0) {
      const cfg = await reportConfigFor(me);
      return {
        ...base,
        text: "missing" in cfg
          ? `Не хватает: ${cfg.missing.join(", ")}`
          : "Ни у кого из выбранных нет подключённого ключа Meta.",
      };
    }
    let failedAccounts = 0;
    let uncovered = 0;
    let nearestSheet: string | undefined;

    // У живого чека таргет спрашивается прямо у Meta. Склад тут не помощник: он
    // собирается по подключениям баеров, а кабинеты владельца в него не попадают
    // вовсе — страновой чек за сегодня иначе состоял бы из одной строки
    // «страна не определена» (замер 31.08.2026).
    if (groupBy === "country") {
      const targeting = await Promise.all(sources.map((c) => fetchAdSetTargeting(c.metaToken, c.accountScope)));
      for (const t of targeting) {
        failedAccounts += t.failedAccounts;
        for (const a of t.items) geoByAdset.set(a.adsetId, a.countries);
      }
    }

    if (groupBy === "campaign") {
      const parts = await Promise.all(sources.map(async (config) => {
        const [meta, campaignMeta, crm] = await Promise.all([
          fetchCampaignInsights(config.metaToken, since, until, config.accountScope),
          fetchCampaignMeta(config.metaToken, config.accountScope),
          config.campaignsSheetId ? crmForRange(config.campaignsSheetId, since, until) : NO_CRM,
        ]);
        return { meta, campaignMeta, crm };
      }));

      for (const { meta, campaignMeta, crm } of parts) {
        failedAccounts += meta.failedAccounts;
        if (!crm.covered) { uncovered++; if (crm.nearest) nearestSheet = crm.nearest; }
        for (const c of meta.items) {
          if (!ownAccount(c.accountId)) continue;
          const row = rows.get(c.campaignId) ?? blank(c.campaignId, c.campaignName || c.campaignId);
          row.spend += c.spend;
          row.dailyBudget = campaignMeta.dailyBudgets.get(c.campaignId) ?? null;
          rows.set(c.campaignId, row);
        }
        // Кампании, которые есть только в выгрузке, в чек не попадают: имени у
        // них нет, а строка с голым id в телеге бесполезна.
        for (const [id, c] of crm.rows) {
          const row = rows.get(id);
          if (!row) continue;
          row.subscribers = add(row.subscribers, c.subscribers);
          row.dialogs = add(row.dialogs, c.dialogs);
          row.revenue = add(row.revenue, c.revenue);
        }
        const budget = [...new Set(meta.items.map((c) => c.campaignId))]
          .reduce((s, id) => s + (campaignMeta.dailyBudgets.get(id) ?? 0), 0);
        if (budget > 0) totalBudget = (totalBudget ?? 0) + budget;
      }
    } else {
      const parts = await Promise.all(sources.map(async (config) => {
        const [meta, crm] = await Promise.all([
          fetchAdInsights(config.metaToken, since, until, config.accountScope),
          config.adsSheetId ? crmForRange(config.adsSheetId, since, until) : NO_CRM,
        ]);
        return { meta, crm };
      }));

      for (const { meta, crm } of parts) {
        failedAccounts += meta.failedAccounts;
        if (!crm.covered) { uncovered++; if (crm.nearest) nearestSheet = crm.nearest; }

        // Расход и доход раскладываются по одному ключу — иначе строка страны
        // получила бы расход одного множества объявлений и доход другого.
        const country = countryByName(
          meta.items.filter((a) => ownAccount(a.accountId)).map((a) => ({ name: a.adName.trim(), adsetId: a.adsetId }))
        );

        for (const a of meta.items) {
          if (!ownAccount(a.accountId)) continue;
          const name = a.adName.trim();
          // Расход не теряем даже у безымянного объявления: в разрезе по крео
          // такому взяться неоткуда, а в разрезе по странам оно всё равно
          // относится к своему адсету.
          if (!name && groupBy === "creative") continue;
          const key = groupBy === "creative"
            ? name
            : country.get(name) ?? countryKey(a.adsetId);
          const row = rows.get(key) ?? blank(key, key);
          row.spend += a.spend;
          rows.set(key, row);
        }

        for (const [name, c] of crm.rows) {
          const key = groupBy === "creative" ? name : country.get(name);
          const row = key ? rows.get(key) : undefined;
          if (!row) continue;
          row.subscribers = add(row.subscribers, c.subscribers);
          row.dialogs = add(row.dialogs, c.dialogs);
          row.revenue = add(row.revenue, c.revenue);
        }
      }
    }

    const notes: string[] = [];
    if (failedAccounts > 0) notes.push(`не прочиталось кабинетов: ${failedAccounts}`);
    if (uncovered > 0) {
      const what = nearestSheet
        ? `ближайший лист выгрузки — ${nearestSheet}, под этот период он не подходит`
        : "выгрузка Torro за этот период не найдена";
      notes.push(uncovered === sources.length
        ? `${what} — показан только расход`
        : `у ${uncovered} из ${sources.length} подключений нет выгрузки за этот период`);
    }
    if (notes.length > 0) warning = `Цифры неполные: ${notes.join("; ")}.`;
  } else {
    // ─── Из склада ─────────────────────────────────────────────────────────
    //
    // Выгрузка попадает в расчёт, только если её период целиком внутри
    // запрошенного. Частично пересекающие строки разделить нечем: недельная
    // строка не делится на дни. Раньше они просто не выбирались из базы, и день
    // внутри недели показывал расход при нулевом доходе — без единого признака,
    // что доход есть, просто он недельный. Теперь такие строки видно, и о них
    // говорится вслух.
    let partial = 0;
    const inside = (from: string, to: string) => from >= since && to <= until;

    if (groupBy === "campaign") {
      const days = await selectAll<{ campaign_id: string; campaign_name: string | null; account_id: string | null; date: string; spend: number | string }>((from, to) => {
        const q = db.from("wh_campaign_days").select("campaign_id, campaign_name, account_id, date, spend")
          .gte("date", since).lte("date", until);
        return (accountIds ? q.in("account_id", accountIds) : q)
          .order("user_id").order("date").order("campaign_id")
          .range(from, to);
      });
      // Один день одной кампании мог прийти от двух токенов (Decision 052).
      const seenDay = new Set<string>();
      for (const d of days) {
        const dayKey = `${d.date}|${d.campaign_id}`;
        if (seenDay.has(dayKey)) continue;
        seenDay.add(dayKey);
        const row = rows.get(d.campaign_id) ?? blank(d.campaign_id, d.campaign_name || d.campaign_id);
        row.spend += num(d.spend);
        rows.set(d.campaign_id, row);
      }

      const crm = await selectAll<{ campaign_id: string; period_start: string; period_end: string; subscribers: number | null; dialogs: number | null; dep_sum: number | string | null; redep_sum: number | string | null }>((from, to) =>
        db.from("wh_crm_campaign_periods").select("campaign_id, period_start, period_end, subscribers, dialogs, dep_sum, redep_sum")
          .in("user_id", scope).lte("period_start", until).gte("period_end", since)
          .order("user_id").order("period_start").order("campaign_id")
          .range(from, to)
      );
      for (const c of crm) {
        if (!inside(c.period_start, c.period_end)) { partial++; continue; }
        const row = rows.get(c.campaign_id) ?? blank(c.campaign_id, c.campaign_id);
        row.subscribers = add(row.subscribers, c.subscribers);
        row.dialogs = add(row.dialogs, c.dialogs);
        row.revenue = add(row.revenue, add(
          c.dep_sum === null ? null : num(c.dep_sum),
          c.redep_sum === null ? null : num(c.redep_sum)
        ));
        rows.set(c.campaign_id, row);
      }
    } else {
      const daysRaw = await selectAll<{ ad_name: string; ad_id: string; adset_id: string | null; account_id: string | null; date: string; spend: number | string }>((from, to) => {
        const q = db.from("wh_ad_days").select("ad_name, ad_id, adset_id, account_id, date, spend")
          .gte("date", since).lte("date", until);
        return (accountIds ? q.in("account_id", accountIds) : q)
          .order("user_id").order("date").order("ad_id")
          .range(from, to);
      });
      // Один день одного объявления мог прийти от двух токенов (Decision 052).
      const seenDay = new Set<string>();
      const days = daysRaw.filter((d) => {
        const k = `${d.date}|${d.ad_id}`;
        if (seenDay.has(k)) return false;
        seenDay.add(k);
        return true;
      });

      const country = countryByName(days.map((d) => ({ name: (d.ad_name ?? "").trim(), adsetId: d.adset_id ?? "" })));

      for (const d of days) {
        const name = (d.ad_name ?? "").trim();
        if (!name && groupBy === "creative") continue;
        const key = groupBy === "creative"
          ? name
          : country.get(name) ?? countryKey(d.adset_id ?? "");
        const row = rows.get(key) ?? blank(key, key);
        row.spend += num(d.spend);
        rows.set(key, row);
      }

      const crm = await selectAll<{ ad_name: string; period_start: string; period_end: string; subscribers: number | null; dialogs: number | null; dep_sum: number | string | null; redep_sum: number | string | null }>((from, to) =>
        db.from("wh_crm_ad_periods").select("ad_name, period_start, period_end, subscribers, dialogs, dep_sum, redep_sum")
          .in("user_id", scope).lte("period_start", until).gte("period_end", since)
          .order("user_id").order("period_start").order("ad_name")
          .range(from, to)
      );
      for (const c of crm) {
        if (!inside(c.period_start, c.period_end)) { partial++; continue; }
        const name = (c.ad_name ?? "").trim();
        if (!name) continue;
        // По креативам строка выгрузки создаёт свою строку даже без расхода:
        // объявление могли выключить, а депозиты по нему ещё доходят.
        // По странам так нельзя — страну выключенного объявления взять неоткуда.
        const key = groupBy === "creative" ? name : country.get(name);
        if (!key) continue;
        const row = rows.get(key) ?? blank(key, key);
        row.subscribers = add(row.subscribers, c.subscribers);
        row.dialogs = add(row.dialogs, c.dialogs);
        row.revenue = add(row.revenue, add(
          c.dep_sum === null ? null : num(c.dep_sum),
          c.redep_sum === null ? null : num(c.redep_sum)
        ));
        rows.set(key, row);
      }
    }

    if (partial > 0) {
      warning = `Цифры неполные: ${partial} строк выгрузки шире запрошенного периода ` +
        `(например, недельная выгрузка на однодневном чеке). Разделить их по дням нечем, ` +
        `поэтому доход по ним не показан — возьми период целиком.`;
    }
  }

  const list = [...rows.values()].map(derive).sort((a, b) => b.spend - a.spend);
  const spend = list.reduce((s, r) => s + r.spend, 0);
  // Складываем только известное. Если дохода не знает ни одна строка — итог тоже
  // неизвестен: иначе карточка показывала бы «Доход $0.00» и «ROMI −100%» там,
  // где в таблице у всех строк честное «—», и по этому экрану выключили бы связку.
  const withRevenue = list.filter((r) => r.revenue !== null);
  const revenue = withRevenue.length ? withRevenue.reduce((s, r) => s + (r.revenue as number), 0) : null;

  return {
    ...base,
    sources: sourceLabels,
    rows: list,
    totalBudget,
    totals: {
      spend,
      revenue,
      romi: revenue !== null && spend > 0 ? ((revenue - spend) / spend) * 100 : null,
    },
    text: buildCheckText(list, totalBudget, new Date()),
    warning,
  };
}
