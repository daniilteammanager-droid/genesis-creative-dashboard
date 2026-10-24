import { warehouse, selectAll } from "./read";
import { NO_CABINETS, resolveScope } from "./accounts";
import type { ReportConfig } from "@/lib/reports-live/config";
import { metaTokensOf } from "@/lib/connections/metaKeys";
import { dolphinAdDays, type DolphinAdDay } from "@/lib/dolphin/api";
import type { MetaCampaignRow, MetaAdRow } from "@/lib/reports-live/types";
import type { CampaignMeta } from "@/lib/reports-live/metaApi";
import { getConnection } from "@/lib/connections/store";
import { fetchCampaignInsights, fetchAdInsights, fetchCampaignMeta, fetchAdSetTargeting } from "@/lib/reports-live/metaApi";
import type { Profile } from "@/lib/auth/types";
import { mskDay, mskStamp } from "@/lib/day";
import { fetchDay, toCrm } from "@/lib/torro/mcp";
import { uniqueIds } from "./torroIngest";
import { parseName } from "@/lib/creatives/code";

// Чек — то, что копируют и отправляют в телегу.
//
// Источник зависит от периода (Decision 040):
//   сегодня        — живая Meta, потому что чек за сегодня собирают «прямо
//                    сейчас», а склад отстаёт на четверть часа;
//   другой период  — склад, там цифры уже собраны и точны.
//
// Гео берётся из настроек таргета адсета, а не из имени (Decision 045).
//
// Чек всегда делится по лицам (Decision 065): лицо — из имени кампании, внутри
// лица — кампании, креативы или страны.

export type CheckGroup = "campaign" | "creative" | "country";

export interface CheckRow {
  key: string;
  label: string;
  face: string;                 // лицо из имени кампании, NO_FACE / MANY_FACES — не узнали
  dailyBudget: number | null;   // только у живого чека по кампаниям
  spend: number;
  subscribers: number | null;
  dialogs: number | null;
  revenue: number | null;
  costPdp: number | null;
  costDia: number | null;
  romi: number | null;
}

// Итог лица — та же строка, плюс сколько в нём строк (для «…и ещё N» в телеге).
export type FaceTotal = CheckRow & { count: number };

export const NO_FACE = "Без лица";
// Одно имя объявления в кампаниях разных лиц: доход Torro по имени не делится.
export const MANY_FACES = "Несколько лиц";

const faceOf = (campaignName: string | null | undefined) => parseName(campaignName ?? "").face ?? NO_FACE;

export interface CheckResult {
  since: string;
  until: string;
  groupBy: CheckGroup;
  live: boolean;
  rows: CheckRow[];              // сгруппированы по лицам в порядке faces
  faces: FaceTotal[];
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

const numbers = (r: CheckRow) =>
  [nf(r.spend), nfOr(r.costPdp), nfOr(r.costDia), nfOr(r.revenue), r.romi === null ? "—" : `${r.romi.toFixed(0)}%`].join(" / ");
const budgetOf = (r: CheckRow) => (r.dailyBudget !== null ? ` - [${nf(r.dailyBudget, 0)}$]` : "");

// Блок на лицо: строка лица с его итогом, под ней строки. rows может быть частью
// строк лица (авточек шлёт верх) — тогда с unit остаток лица печатается одной строкой.
export function buildCheckText(rows: CheckRow[], faces: FaceTotal[], totalBudget: number | null, now: Date, unit?: string): string {
  const head = `Отчет по трафу / ${mskStamp(now)}` + (totalBudget !== null ? ` / [${nf(totalBudget, 0)}$]` : "");

  const lines = [head, ""];
  for (const f of faces) {
    const shown = rows.filter((r) => r.face === f.face);
    if (!shown.length && !unit) continue;
    lines.push(`👤 ${f.label}${budgetOf(f)}`, numbers(f), "");
    for (const r of shown) lines.push(`${r.label}${budgetOf(r)}`, numbers(r), "");
    const hidden = f.count - shown.length;
    if (unit && hidden > 0) {
      const spend = f.spend - shown.reduce((x, r) => x + r.spend, 0);
      lines.push(`…и ещё ${hidden} ${unit} на ${nf(spend)}$`, "");
    }
  }
  return lines.join("\n").trimEnd();
}

// Итоги по лицам из строк чека. Производные — из сумм (Decision 024). Порядок —
// по расходу, неузнанные лица в конце.
export function faceTotals(rows: CheckRow[]): FaceTotal[] {
  const by = new Map<string, FaceTotal>();
  for (const r of rows) {
    const f = by.get(r.face) ?? {
      key: r.face, label: r.face, face: r.face, dailyBudget: null, spend: 0,
      subscribers: null, dialogs: null, revenue: null, costPdp: null, costDia: null, romi: null, count: 0,
    };
    f.spend += r.spend;
    f.dailyBudget = add(f.dailyBudget, r.dailyBudget);
    f.subscribers = add(f.subscribers, r.subscribers);
    f.dialogs = add(f.dialogs, r.dialogs);
    f.revenue = add(f.revenue, r.revenue);
    f.count++;
    by.set(r.face, f);
  }
  const unknown = (f: FaceTotal) => (f.face === NO_FACE || f.face === MANY_FACES ? 1 : 0);
  return [...by.values()].map((f) => derive(f) as FaceTotal)
    .sort((a, b) => unknown(a) - unknown(b) || b.spend - a.spend);
}

// Одно значение на имя объявления; у имени их несколько — many. Так делятся и
// страны, и лица: доход Torro приходит по имени и между значениями не делится.
function onePerName(pairs: { name: string; value: string }[], many: string): Map<string, string> {
  const seen = new Map<string, Set<string>>();
  for (const { name, value } of pairs) {
    if (!name) continue;
    seen.set(name, (seen.get(name) ?? new Set<string>()).add(value));
  }
  return new Map([...seen].map(([name, set]) => [name, set.size === 1 ? [...set][0] : many]));
}

// ─── Выгрузки Torro за период ────────────────────────────────────────────────
type CrmTotals = { subscribers: number | null; dialogs: number | null; revenue: number | null };
// byName — ключи строк это имена кампаний, а не id (Torro по API id не знает).
type CrmForRange = { rows: Map<string, CrmTotals>; covered: boolean; byName?: boolean };
const NO_CRM: CrmForRange = { rows: new Map(), covered: false };

// Torro по API за один день — для живого чека (он всегда про сегодня).
// Тот же клиент и тот же обход потолка в 100 строк, что и у склада (Decision 055).
async function torroForDay(
  torro: { token: string; buyerId: number }, day: string, groupBy: "campaign_name" | "ad_name"
): Promise<CrmForRange> {
  const rows = new Map<string, CrmTotals>();
  for (const r of await fetchDay({ token: torro.token, buyerId: torro.buyerId, day }, groupBy)) {
    const name = r.group.trim();
    if (!name) continue;
    const c = toCrm(r);
    const cur = rows.get(name) ?? { subscribers: null, dialogs: null, revenue: null };
    cur.subscribers = add(cur.subscribers, c.subscribers);
    cur.dialogs = add(cur.dialogs, c.dialogs);
    cur.revenue = add(cur.revenue, add(c.depSum, c.redepSum));
    rows.set(name, cur);
  }
  return { rows, covered: true, byName: groupBy === "campaign_name" };
}

// ─── Dolphin в форме Meta (Decision 063) ────────────────────────────────────
// Живой чек всегда за один день. Dolphin отдаёт объявления с кампаниями и
// бюджетами одним списком — один запрос на день, а не три, кэш на вызов чека.
const dolphinDay = new Map<string, Promise<DolphinAdDay[]>>();
function dolphinRows(token: string, day: string) {
  const key = `${token}|${day}`;
  if (!dolphinDay.has(key)) {
    dolphinDay.set(key, dolphinAdDays(token, day, day).finally(() => setTimeout(() => dolphinDay.delete(key), 60_000)));
  }
  return dolphinDay.get(key)!;
}

async function dolphinCampaigns(token: string, day: string) {
  const byId = new Map<string, MetaCampaignRow>();
  for (const r of await dolphinRows(token, day)) {
    const c = byId.get(r.campaignId) ?? { campaignId: r.campaignId, campaignName: r.campaignName, accountId: r.accountId, accountName: r.accountName, spend: 0, clicks: 0, impressions: 0 };
    c.spend += r.spend; c.clicks += r.clicks; c.impressions += r.impressions;
    byId.set(r.campaignId, c);
  }
  return { items: [...byId.values()], failedAccounts: 0 };
}

async function dolphinBudgets(token: string, day: string): Promise<CampaignMeta> {
  const dailyBudgets = new Map<string, number>();
  for (const r of await dolphinRows(token, day)) if (r.campaignDailyBudget) dailyBudgets.set(r.campaignId, r.campaignDailyBudget);
  return { statuses: new Map(), dailyBudgets };
}

async function dolphinAds(token: string, day: string, geo: Map<string, string[]>) {
  const rows = await dolphinRows(token, day);
  for (const r of rows) if (r.adsetId && r.countries.length) geo.set(r.adsetId, r.countries);
  return { items: rows as MetaAdRow[], failedAccounts: 0 };
}

// Ключи, по которым собирается живой чек (Decision 061).
//
// По источнику на каждый ключ Meta каждого человека в области видимости. Кабинет
// считается через ключ того, за кем он закреплён, и только один раз — даже если
// его видят два ключа. Torro — один раз на человека, на первом его ключе: иначе
// подписки сложились бы столько раз, сколько у него ключей.
//
// Командного ключа из окружения здесь больше нет: сводная владельца — это сумма
// интеграций всех, а не отдельный ключ, который видит то же самое ещё раз.
type LiveSource = ReportConfig & {
  userId: string; owned: Set<string>; torro?: { token: string; buyerId: number };
  // Источник — Dolphin (Decision 063): metaToken тогда пустой, ходим в Dolphin.
  dolphin?: string;
};

async function liveSources(scope: string[]): Promise<LiveSource[]> {
  const db = warehouse();
  const list: LiveSource[] = [];
  for (const id of scope) {
    const [keys, c, { data: owned }] = await Promise.all([
      metaTokensOf(id),
      getConnection(id),
      db.from("wh_account_owners").select("account_id").eq("owner_user_id", id),
    ]);
    const ownedSet = new Set((owned ?? []).map((o) => o.account_id as string));
    const torro = c?.torroToken && c.torroBuyerId ? { token: c.torroToken, buyerId: c.torroBuyerId } : undefined;
    // Источник у человека один: Dolphin — вместо ключей Meta, а не вместе с ними.
    if (c?.spendSource === "dolphin" && c.dolphinToken) {
      list.push({
        cacheKey: id, userId: id, metaToken: "", dolphin: c.dolphinToken,
        accountScope: {}, campaignsSheetId: "", adsSheetId: "", owned: ownedSet, torro,
      });
      continue;
    }
    keys.forEach((k, i) => list.push({
      cacheKey: id, userId: id, metaToken: k.token,
      // Как в складе: напрямую и через БМ, в любом статусе (Decision 062).
      accountScope: { includeBusinesses: true, anyStatus: true },
      campaignsSheetId: "", adsSheetId: "", owned: ownedSet,
      torro: i === 0 ? torro : undefined,
    }));
  }
  // Один и тот же ключ дважды сложил бы расход сам с собой.
  return [...new Map(list.map((c) => [c.dolphin ?? c.metaToken, c])).values()];
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
    faces: [], totals: { spend: 0, revenue: null, romi: null }, text: "", buyers, sources: [],
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
  const blank = (key: string, label: string, face: string): CheckRow => ({
    key, label, face, dailyBudget: null, spend: 0,
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
    return onePerName(pairs.map((p) => ({ name: p.name, value: countryKey(p.adsetId) })), "несколько стран");
  }

  // Лицо имени объявления — по тем же причинам, что и страна: доход Torro по имени.
  function faceByName(pairs: { name: string; campaignName: string | null | undefined }[]): Map<string, string> {
    return onePerName(pairs.map((p) => ({ name: p.name, value: faceOf(p.campaignName) })), MANY_FACES);
  }
  // Строка разреза по объявлениям: ключ — лицо плюс креатив или страна.
  const adRow = (face: string, label: string) => {
    const key = `${face}|${label}`;
    const row = rows.get(key) ?? blank(key, label, face);
    rows.set(key, row);
    return row;
  };

  // Кабинеты, которые ещё никому не отдали, баер не видит. Пустой список — это
  // не «расхода нет», а «кабинеты ещё не закреплены», и говорить об этом надо вслух.
  if (accountIds !== null && accountIds.length === 0) {
    return { ...base, text: NO_CABINETS };
  }
  if (live) {
    const sources = await liveSources(scope);
    sourceLabels = [...new Set(sources.map((c) => buyerLabel.get(c.userId) ?? c.userId))];
    if (sources.length === 0) {
      return { ...base, text: "Ни у кого из выбранных нет источника расхода — подключи Meta или Dolphin в Настройках → Интеграции." };
    }
    // Кабинет — через ключ своего владельца и один раз на весь чек.
    const takenBy = new Map<string, LiveSource>();
    const take = (config: LiveSource, raw: string | undefined) => {
      if (!raw) return false;
      const id = raw.replace(/^act_/, "");
      if (!config.owned.has(id)) return false;
      const t = takenBy.get(id);
      if (t && t !== config) return false;
      takenBy.set(id, config);
      return true;
    };
    let failedAccounts = 0;

    // У живого чека таргет спрашивается прямо у Meta. Склад тут не помощник: он
    // собирается по подключениям баеров, а кабинеты владельца в него не попадают
    // вовсе — страновой чек за сегодня иначе состоял бы из одной строки
    // «страна не определена» (замер 31.08.2026).
    if (groupBy === "country") {
      // Dolphin таргет не отдаёт — его страны приходят из нейминга вместе с расходом ниже.
      const targeting = await Promise.all(sources.filter((c) => !c.dolphin).map((c) => fetchAdSetTargeting(c.metaToken, c.accountScope)));
      for (const t of targeting) {
        failedAccounts += t.failedAccounts;
        for (const a of t.items) geoByAdset.set(a.adsetId, a.countries);
      }
    }

    if (groupBy === "campaign") {
      const parts = await Promise.all(sources.map(async (config) => {
        const [meta, campaignMeta, crm] = await Promise.all([
          config.dolphin ? dolphinCampaigns(config.dolphin, since) : fetchCampaignInsights(config.metaToken, since, until, config.accountScope),
          config.dolphin ? dolphinBudgets(config.dolphin, since) : fetchCampaignMeta(config.metaToken, config.accountScope),
          config.torro ? torroForDay(config.torro, since, "campaign_name") : NO_CRM,
        ]);
        return { meta, campaignMeta, crm };
      }));

      for (const [i, { meta, campaignMeta, crm }] of parts.entries()) {
        const config = sources[i];
        failedAccounts += meta.failedAccounts;
        const mine = meta.items.filter((c) => take(config, c.accountId));
        for (const c of mine) {
          const row = rows.get(c.campaignId) ?? blank(c.campaignId, c.campaignName || c.campaignId, faceOf(c.campaignName));
          row.spend += c.spend;
          row.dailyBudget = campaignMeta.dailyBudgets.get(c.campaignId) ?? null;
          rows.set(c.campaignId, row);
        }
        // Кампании, которые есть только в выгрузке, в чек не попадают: имени у
        // них нет, а строка с голым id в телеге бесполезна.
        // Torro отдаёт имена — id берём из расхода, и только у однозначного имени.
        const idOf = crm.byName
          ? uniqueIds(mine.map((c) => ({ id: c.campaignId, name: c.campaignName })))
          : null;
        for (const [key, c] of crm.rows) {
          const id = idOf ? idOf.get(key) : key;
          const row = id ? rows.get(id) : undefined;
          if (!row) continue;
          row.subscribers = add(row.subscribers, c.subscribers);
          row.dialogs = add(row.dialogs, c.dialogs);
          row.revenue = add(row.revenue, c.revenue);
        }
        const budget = [...new Set(mine.map((c) => c.campaignId))]
          .reduce((s, id) => s + (campaignMeta.dailyBudgets.get(id) ?? 0), 0);
        if (budget > 0) totalBudget = (totalBudget ?? 0) + budget;
      }
    } else {
      const parts = await Promise.all(sources.map(async (config) => {
        const [meta, crm] = await Promise.all([
          config.dolphin ? dolphinAds(config.dolphin, since, geoByAdset) : fetchAdInsights(config.metaToken, since, until, config.accountScope),
          config.torro ? torroForDay(config.torro, since, "ad_name") : NO_CRM,
        ]);
        return { meta, crm };
      }));

      for (const [i, { meta, crm }] of parts.entries()) {
        const config = sources[i];
        failedAccounts += meta.failedAccounts;
        const mine = meta.items.filter((a) => take(config, a.accountId));

        // Расход и доход раскладываются по одному ключу — иначе строка страны
        // получила бы расход одного множества объявлений и доход другого.
        const country = countryByName(mine.map((a) => ({ name: a.adName.trim(), adsetId: a.adsetId })));
        const face = faceByName(mine.map((a) => ({ name: a.adName.trim(), campaignName: a.campaignName })));

        for (const a of mine) {
          const name = a.adName.trim();
          // Расход не теряем даже у безымянного объявления: в разрезе по крео
          // такому взяться неоткуда, а в разрезе по странам оно всё равно
          // относится к своему адсету.
          if (!name && groupBy === "creative") continue;
          const label = groupBy === "creative" ? name : country.get(name) ?? countryKey(a.adsetId);
          adRow(face.get(name) ?? faceOf(a.campaignName), label).spend += a.spend;
        }

        for (const [name, c] of crm.rows) {
          const label = groupBy === "creative" ? name : country.get(name);
          const row = label ? rows.get(`${face.get(name)}|${label}`) : undefined;
          if (!row) continue;
          row.subscribers = add(row.subscribers, c.subscribers);
          row.dialogs = add(row.dialogs, c.dialogs);
          row.revenue = add(row.revenue, c.revenue);
        }
      }
    }

    const notes: string[] = [];
    if (failedAccounts > 0) notes.push(`не прочиталось кабинетов: ${failedAccounts}`);
    // Torro — один на человека, поэтому и считаем людей, а не ключи.
    const noTorro = [...new Set(sources.map((c) => c.userId))].filter((u) => !sources.some((c) => c.userId === u && c.torro));
    if (noTorro.length > 0) {
      notes.push(noTorro.length === new Set(sources.map((c) => c.userId)).size
        ? "Torro не подключён — показан только расход"
        : `Torro не подключён у: ${noTorro.map((u) => buyerLabel.get(u) ?? u).join(", ")}`);
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
        const row = rows.get(d.campaign_id) ?? blank(d.campaign_id, d.campaign_name || d.campaign_id, faceOf(d.campaign_name));
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
        const row = rows.get(c.campaign_id) ?? blank(c.campaign_id, c.campaign_id, NO_FACE);
        row.subscribers = add(row.subscribers, c.subscribers);
        row.dialogs = add(row.dialogs, c.dialogs);
        row.revenue = add(row.revenue, add(
          c.dep_sum === null ? null : num(c.dep_sum),
          c.redep_sum === null ? null : num(c.redep_sum)
        ));
        rows.set(c.campaign_id, row);
      }
    } else {
      const daysRaw = await selectAll<{ ad_name: string; ad_id: string; adset_id: string | null; campaign_name: string | null; account_id: string | null; date: string; spend: number | string }>((from, to) => {
        const q = db.from("wh_ad_days").select("ad_name, ad_id, adset_id, campaign_name, account_id, date, spend")
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
      const face = faceByName(days.map((d) => ({ name: (d.ad_name ?? "").trim(), campaignName: d.campaign_name })));

      for (const d of days) {
        const name = (d.ad_name ?? "").trim();
        if (!name && groupBy === "creative") continue;
        const label = groupBy === "creative" ? name : country.get(name) ?? countryKey(d.adset_id ?? "");
        adRow(face.get(name) ?? faceOf(d.campaign_name), label).spend += num(d.spend);
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
        // Лица у такого имени тоже взять неоткуда, кроме расхода за период.
        const label = groupBy === "creative" ? name : country.get(name);
        if (!label) continue;
        const row = adRow(face.get(name) ?? NO_FACE, label);
        row.subscribers = add(row.subscribers, c.subscribers);
        row.dialogs = add(row.dialogs, c.dialogs);
        row.revenue = add(row.revenue, add(
          c.dep_sum === null ? null : num(c.dep_sum),
          c.redep_sum === null ? null : num(c.redep_sum)
        ));
      }
    }

    if (partial > 0) {
      warning = `Цифры неполные: ${partial} строк выгрузки шире запрошенного периода ` +
        `(например, недельная выгрузка на однодневном чеке). Разделить их по дням нечем, ` +
        `поэтому доход по ним не показан — возьми период целиком.`;
    }
  }

  const bySpend = [...rows.values()].map(derive).sort((a, b) => b.spend - a.spend);
  const faces = faceTotals(bySpend);
  // Строки — блоками по лицам, в порядке лиц; внутри лица — по расходу.
  const order = new Map(faces.map((f, i) => [f.face, i]));
  const list = [...bySpend].sort((a, b) => order.get(a.face)! - order.get(b.face)!);
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
    faces,
    totalBudget,
    totals: {
      spend,
      revenue,
      romi: revenue !== null && spend > 0 ? ((revenue - spend) / spend) * 100 : null,
    },
    text: buildCheckText(list, faces, totalBudget, new Date()),
    warning,
  };
}
