import { warehouse, selectAll } from "./read";
import { NO_CABINETS, resolveScope } from "./accounts";
import type { ReportConfig } from "@/lib/reports-live/config";
import { metaTokensOf } from "@/lib/connections/metaKeys";
import { dolphinAdDays, type DolphinAdDay } from "@/lib/dolphin/api";
import { tgadsAdDays } from "@/lib/tgads/api";
import { fbtoolAccounts, fbtoolAdDays, fbtoolBudgets } from "@/lib/fbtool/api";
import { tgadsKeysOf } from "@/lib/connections/tgadsKeys";
import type { MetaCampaignRow, MetaAdRow } from "@/lib/reports-live/types";
import type { CampaignMeta } from "@/lib/reports-live/metaApi";
import { getConnection } from "@/lib/connections/store";
import { fetchCampaignInsights, fetchAdInsights, fetchCampaignMeta, fetchAdSetTargeting } from "@/lib/reports-live/metaApi";
import type { Profile } from "@/lib/auth/types";
import { mskDay, mskStamp } from "@/lib/day";
import { fetchDay, toCrm } from "@/lib/torro/mcp";
import { uniqueIds } from "./torroIngest";
import { parseCreativeCode, parseName } from "@/lib/creatives/code";
import type { ArtemCampaign, ArtemTorro } from "./checkArtem";

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
//
// Над лицами — площадка (Decision 069): Facebook и Telegram Ads. Площадка в чеке
// есть, если у кого-то в области видимости она подключена; подключена, а расхода
// нет — так и пишем; не подключена — её в чеке нет вовсе.

export type CheckGroup = "campaign" | "creative" | "country";
export type Platform = "fb" | "tg";
export const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "fb", label: "📘 FACEBOOK" },
  { id: "tg", label: "✈️ TG ADS" },
];

export interface CheckRow {
  key: string;
  label: string;
  platform: Platform;
  face: string;                 // лицо из имени кампании, NO_FACE / MANY_FACES — не узнали
  dailyBudget: number | null;   // только у живого чека по кампаниям
  spend: number;
  subscribers: number | null;
  dialogs: number | null;
  revenue: number | null;
  costPdp: number | null;
  costDia: number | null;
  romi: number | null;
  accountId?: string;           // только в разрезе по кампаниям — для формата Артёма
  status?: string | null;       // фактический статус кампании (живой из Meta или последний из склада)
}

// Итог лица — та же строка, плюс сколько в нём строк (для «…и ещё N» в телеге).
export type FaceTotal = CheckRow & { count: number };

// Площадка в чеке: подключена ли у кого-то в области видимости и её итог.
// Итог null — подключена, а расхода нет.
export interface PlatformTotal { platform: Platform; label: string; total: CheckRow | null }

// Torro, которому не нашлось расхода: кампании из неподключённых кабинетов
// (Decision 070). В итог и ROMI не идёт — расхода по ним нет, — но и не теряется.
export interface Unmatched { subscribers: number; dialogs: number; revenue: number; names: number }

export function unmatchedLine(u: Unmatched | null | undefined): string {
  if (!u || (!u.revenue && !u.subscribers && !u.dialogs)) return "";
  return `\n\n⚠️ Нет в подключённых кабинетах: ${nf(u.revenue)}$ дохода · ${nf(u.subscribers, 0)} подп. · ${nf(u.dialogs, 0)} диал. (${u.names} шт.)`;
}

export const NO_FACE = "Без лица";
// Одно имя объявления в кампаниях разных лиц: доход Torro по имени не делится.
export const MANY_FACES = "Несколько лиц";

const faceOf = (campaignName: string | null | undefined) => parseName(campaignName ?? "").face ?? NO_FACE;
// В именах TG Ads лица нет — оно берётся из названия кабинета, которое дал баер.
// Подчёркивание — тоже граница: «…_MTG_ROMAN_6» (у \b подчёркивание — часть слова).
export const faceInName = (name: string) => /(?:^|[^A-Z0-9])(ROMAN|RICKY)(?=$|[^A-Z0-9])/i.exec(name)?.[1].toUpperCase() ?? null;

export interface CheckResult {
  since: string;
  until: string;
  groupBy: CheckGroup;
  live: boolean;
  rows: CheckRow[];              // сгруппированы по площадкам и лицам в порядке faces
  faces: FaceTotal[];            // по площадкам, внутри — по лицам
  regions: FaceTotal[];          // Facebook: Испания, Латам, весь FB
  // Вход для формата Артёма (Decision 090), только в разрезе по кампаниям: кампании Facebook и
  // TG Ads со статусом и баном, включая живые без расхода, и строки Torro без кампании.
  artem: { campaigns: ArtemCampaign[]; tg: ArtemCampaign[]; torro: ArtemTorro[] } | null;
  platforms: PlatformTotal[];    // только подключённые
  unmatched: Unmatched | null;
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
// Площадок больше одной — над лицами строка площадки с её итогом; подключена, а
// расхода нет — «расхода нет». Площадка одна — заголовка нет, как раньше.
// Под блоком Facebook — общие резы: Испания, Латам и весь FB (по просьбе владельца 26.10.2026).
export function buildCheckText(rows: CheckRow[], faces: FaceTotal[], totalBudget: number | null, now: Date, unit?: string, platforms: PlatformTotal[] = [], regions: FaceTotal[] = []): string {
  const head = `Отчет по трафу / ${mskStamp(now)}` + (totalBudget !== null ? ` / [${nf(totalBudget, 0)}$]` : "");

  const lines = [head, ""];
  const blocks = platforms.length > 1 ? platforms : [null];
  for (const p of blocks) {
    if (p) {
      lines.push(p.total ? `${p.label}${budgetOf(p.total)}` : p.label, p.total ? numbers(p.total) : "расхода нет", "");
      if (!p.total) continue;
    }
    for (const f of faces.filter((x) => !p || x.platform === p.platform)) {
      const shown = rows.filter((r) => r.platform === f.platform && r.face === f.face);
      if (!shown.length && !unit) continue;
      lines.push(`👤 ${f.label}${budgetOf(f)}`, numbers(f), "");
      for (const r of shown) lines.push(`${r.label}${budgetOf(r)}`, numbers(r), "");
      const hidden = f.count - shown.length;
      if (unit && hidden > 0) {
        const spend = f.spend - shown.reduce((x, r) => x + r.spend, 0);
        lines.push(`…и ещё ${hidden} ${unit} на ${nf(spend)}$`, "");
      }
    }
    if ((p?.platform ?? "fb") === "fb" && regions.length) {
      lines.push("📊 FB — общие резы", "");
      for (const r of regions) lines.push(`${r.label}${budgetOf(r)}`, numbers(r), "");
    }
  }
  return lines.join("\n").trimEnd();
}

// Регион строки Facebook — по стране разреза или по гео в имени кампании / креатива.
const LATAM = new Set(["AR", "MX", "CO", "CL", "PE", "PY", "UY", "EC", "PA", "BO", "VE", "CR", "GT", "DO", "HN", "SV", "NI", "LATAM"]);
export function regionOf(r: Pick<CheckRow, "label">, groupBy: CheckGroup): "es" | "latam" | null {
  let geo: string | undefined;
  if (groupBy === "country") geo = r.label.toUpperCase();
  else if (groupBy === "campaign") geo = parseName(r.label).geo;
  else {
    const c = parseCreativeCode(r.label);
    geo = c.scheme === "v2" ? c.geo.toUpperCase() : /-([a-z]{2})$/i.exec(r.label.trim())?.[1].toUpperCase() ?? parseName(r.label).geo;
  }
  if (geo === "ES") return "es";
  return geo && LATAM.has(geo) ? "latam" : null;
}

// Испания, Латам и весь Facebook. Строки без узнанного гео идут только во «весь FB».
export function regionTotals(rows: CheckRow[], groupBy: CheckGroup): FaceTotal[] {
  const fb = rows.filter((r) => r.platform === "fb");
  if (!fb.length) return [];
  const es = fb.filter((r) => regionOf(r, groupBy) === "es"), la = fb.filter((r) => regionOf(r, groupBy) === "latam");
  return [
    ...(es.length ? [sum(es, "es", "🇪🇸 Испания — общие резы", "fb", "")] : []),
    ...(la.length ? [sum(la, "latam", "🌎 Латам — общие резы", "fb", "")] : []),
    sum(fb, "fb", "Весь FB — общие резы", "fb", ""),
  ];
}

const sum = (rows: CheckRow[], key: string, label: string, platform: Platform, face: string): CheckRow & { count: number } => {
  const t = {
    key, label, platform, face, dailyBudget: null as number | null, spend: 0,
    subscribers: null as number | null, dialogs: null as number | null, revenue: null as number | null,
    costPdp: null, costDia: null, romi: null, count: 0,
  };
  for (const r of rows) {
    t.spend += r.spend;
    t.dailyBudget = add(t.dailyBudget, r.dailyBudget);
    t.subscribers = add(t.subscribers, r.subscribers);
    t.dialogs = add(t.dialogs, r.dialogs);
    t.revenue = add(t.revenue, r.revenue);
    t.count++;
  }
  return derive(t) as CheckRow & { count: number };
};

// Итоги по лицам внутри площадок. Производные — из сумм (Decision 024). Порядок —
// площадки как в PLATFORMS, внутри — лица по расходу, неузнанные в конце.
export function faceTotals(rows: CheckRow[]): FaceTotal[] {
  const by = new Map<string, CheckRow[]>();
  for (const r of rows) by.set(`${r.platform}|${r.face}`, [...(by.get(`${r.platform}|${r.face}`) ?? []), r]);
  const unknown = (f: FaceTotal) => (f.face === NO_FACE || f.face === MANY_FACES ? 1 : 0);
  const order = (p: Platform) => PLATFORMS.findIndex((x) => x.id === p);
  return [...by.values()].map((list) => sum(list, list[0].face, list[0].face, list[0].platform, list[0].face))
    .sort((a, b) => order(a.platform) - order(b.platform) || unknown(a) - unknown(b) || b.spend - a.spend);
}

// Подключённые площадки с итогами.
export function platformTotals(rows: CheckRow[], connected: Set<Platform>): PlatformTotal[] {
  return PLATFORMS.filter((p) => connected.has(p.id)).map((p) => {
    const mine = rows.filter((r) => r.platform === p.id);
    return { platform: p.id, label: p.label, total: mine.length ? sum(mine, p.id, p.label, p.id, "") : null };
  });
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

const NO_COUNTRY = "страна не определена";

// Страна и лицо имён Torro, у которых в периоде чека нет расхода (Decision 095). Депы
// доходят со старого трафика, и страновой чек их молча терял — у Артёма за неделю это был
// почти весь доход. Страна — из всей истории расхода имени (таргет адсетов, Decision 045),
// иначе — из имён кампаний Torro с этим объявлением (wh_crm_pairs), иначе «не определена».
// Ответ есть на каждое имя: в страновом чеке Torro не теряется.
async function placeOrphans(
  db: ReturnType<typeof warehouse>, userIds: string[], names: string[], platform: Platform,
  faceFor: (campaignName: string | null, accountId: string | null) => string,
): Promise<Map<string, { country: string; face: string }>> {
  const out = new Map<string, { country: string; face: string }>();
  if (!names.length) return out;
  // У TG Ads доход Torro — по кампании (= объявление со страной), у Facebook — по объявлению.
  const col = platform === "tg" ? "campaign_name" : "ad_name";
  const hist: { name: string; adset: string | null; campaign: string | null; account: string | null }[] = [];
  for (let i = 0; i < names.length; i += 200) {
    const part = names.slice(i, i + 200);
    const rows = await selectAll<Record<string, string | null>>((from, to) =>
      db.from("wh_ad_days").select(`${col}, adset_id, campaign_name, account_id`).in(col, part).order("date").order("ad_id").range(from, to));
    for (const r of rows) hist.push({ name: (r[col] ?? "").trim(), adset: r.adset_id, campaign: r.campaign_name, account: r.account_id });
  }
  const adsetIds = [...new Set(hist.map((h) => h.adset).filter((a): a is string => Boolean(a)))];
  const geo = new Map<string, string[]>();
  for (let i = 0; i < adsetIds.length; i += 200) {
    const { data } = await db.from("wh_adsets").select("adset_id, countries").in("adset_id", adsetIds.slice(i, i + 200));
    for (const a of data ?? []) geo.set(a.adset_id as string, (a.countries as string[] | null) ?? []);
  }
  const countryOf = (adset: string | null) => {
    const c = adset ? geo.get(adset) ?? [] : [];
    return c.length === 1 ? c[0] : c.length > 1 ? "несколько стран" : NO_COUNTRY;
  };
  const country = onePerName(hist.map((h) => ({ name: h.name, value: countryOf(h.adset) })), "несколько стран");
  const face = onePerName(hist.map((h) => ({ name: h.name, value: faceFor(h.campaign, h.account) })), MANY_FACES);

  // Расхода по имени не было никогда (кабинет не подключали) — гео и лицо из имён кампаний Torro.
  const rest = names.filter((n) => !country.has(n));
  const pairs: { name: string; campaign: string }[] = platform === "tg" ? rest.map((n) => ({ name: n, campaign: n })) : [];
  for (let i = 0; platform === "fb" && i < rest.length; i += 200) {
    const part = rest.slice(i, i + 200);
    const rows = await selectAll<{ ad_name: string; campaign_name: string }>((from, to) =>
      db.from("wh_crm_pairs").select("ad_name, campaign_name").in("user_id", userIds).in("ad_name", part)
        .order("period_start").order("campaign_name").order("ad_name").range(from, to));
    for (const r of rows) pairs.push({ name: r.ad_name.trim(), campaign: r.campaign_name });
  }
  const nameGeo = onePerName(pairs.flatMap((p) => { const g = parseName(p.campaign).geo; return g ? [{ name: p.name, value: g }] : []; }), "несколько стран");
  const nameFace = onePerName(pairs.map((p) => ({ name: p.name, value: faceOf(p.campaign) })), MANY_FACES);

  for (const n of names) {
    out.set(n, {
      country: country.get(n) ?? nameGeo.get(n) ?? NO_COUNTRY,
      face: face.get(n) ?? nameFace.get(n) ?? NO_FACE,
    });
  }
  return out;
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
// TG Ads (Decision 068) — тем же путём: готовые строки по дням от источника.
const dolphinDay = new Map<string, Promise<DolphinAdDay[]>>();
function dolphinRows(config: LiveSource, day: string) {
  const key = `${config.dolphin ?? (config.fbtool ? `fbt|${config.userId}` : `tg|${config.userId}`)}|${day}`;
  if (!dolphinDay.has(key)) {
    const fbtool = config.fbtool;
    const rows = config.tgads
      ? Promise.all(config.tgads.map((k) => tgadsAdDays(k, day, day))).then((x) => x.flat())
      : fbtool
        // FB Tool (Decision 071): по запросу на живой аккаунт, разлогиненные пропускаем.
        ? fbtoolAccounts(fbtool).then((acc) => Promise.all(acc.filter((a) => a.ok).map(async (a) =>
            fbtoolAdDays(fbtool, a.id, day, day, await fbtoolBudgets(fbtool, a.id, day).catch(() => undefined))))).then((x) => x.flat())
        : dolphinAdDays(config.dolphin!, day, day);
    dolphinDay.set(key, rows.finally(() => setTimeout(() => dolphinDay.delete(key), 60_000)));
  }
  return dolphinDay.get(key)!;
}

async function dolphinCampaigns(token: LiveSource, day: string) {
  const byId = new Map<string, MetaCampaignRow>();
  for (const r of await dolphinRows(token, day)) {
    const c = byId.get(r.campaignId) ?? { campaignId: r.campaignId, campaignName: r.campaignName, accountId: r.accountId, accountName: r.accountName, spend: 0, clicks: 0, impressions: 0 };
    c.spend += r.spend; c.clicks += r.clicks; c.impressions += r.impressions;
    byId.set(r.campaignId, c);
  }
  return { items: [...byId.values()], failedAccounts: 0 };
}

async function dolphinBudgets(token: LiveSource, day: string): Promise<CampaignMeta> {
  const dailyBudgets = new Map<string, number>();
  for (const r of await dolphinRows(token, day)) if (r.campaignDailyBudget) dailyBudgets.set(r.campaignId, r.campaignDailyBudget);
  return { statuses: new Map(), dailyBudgets };
}

async function dolphinAds(token: LiveSource, day: string, geo: Map<string, string[]>) {
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
  // Источник — FB Tool (Decision 071): ключ API FB Tool, metaToken пустой.
  fbtool?: string;
  // Источник — Telegram Ads (Decision 068): кабинеты баера, metaToken пустой.
  tgads?: Awaited<ReturnType<typeof tgadsKeysOf>>;
};

// Источник со своими строками по дням, а не Meta insights.
const own = (c: LiveSource) => Boolean(c.dolphin || c.tgads || c.fbtool);

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
    // TG Ads — параллельно Facebook (Decision 069). Torro — и тут: у TG Ads он
    // клеится к своим строкам (по кампании), к строкам Facebook не прилипнет.
    const tgads = await tgadsKeysOf(id);
    if (tgads.length) list.push({
      cacheKey: id, userId: id, metaToken: "", tgads,
      accountScope: {}, campaignsSheetId: "", adsSheetId: "", owned: ownedSet, torro,
    });
    // Источник Facebook у человека один: Dolphin — вместо ключей Meta, а не вместе с ними.
    if (c?.spendSource === "fbtool" && c.fbtoolKey) {
      list.push({
        cacheKey: id, userId: id, metaToken: "", fbtool: c.fbtoolKey,
        accountScope: {}, campaignsSheetId: "", adsSheetId: "", owned: ownedSet, torro,
      });
      continue;
    }
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
  return [...new Map(list.map((c) => [c.dolphin ?? (c.fbtool ? `fbt|${c.userId}` : c.tgads ? `tg|${c.userId}` : c.metaToken), c])).values()];
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
    faces: [], regions: [], artem: null, platforms: [], unmatched: null, totals: { spend: 0, revenue: null, romi: null }, text: "", buyers, sources: [],
    buyer: buyerFilter && buyers.some((b) => b.id === buyerFilter) ? buyerFilter : "all",
    isBuyer: me.role === "buyer", generatedAt: new Date().toISOString(),
  };
  // Пустая область видимости — приговор только для склада: он собирается по
  // подключениям, и без них там пусто. Живой чек владелец соберёт и на своих
  // ключах из переменных окружения, пока баеры ещё не подключились.
  if (!live && scope.length === 0) {
    return { ...base, text: "Подключений нет — складу не из чего собираться." };
  }

  // Какие площадки подключены у кого-то в области видимости и чьё лицо у кабинета TG Ads.
  const [{ data: tgKeyRows }, { data: metaKeyRows }, { data: fbConn }] = scope.length ? await Promise.all([
    db.from("tgads_keys").select("user_id, account_id, name").in("user_id", scope),
    db.from("meta_keys").select("user_id").in("user_id", scope).limit(1),
    db.from("buyer_connections").select("user_id").in("user_id", scope).not("spend_source", "is", null).limit(1),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];
  const platformsOn = new Set<Platform>();
  if ((metaKeyRows ?? []).length || (fbConn ?? []).length) platformsOn.add("fb");
  if ((tgKeyRows ?? []).length) platformsOn.add("tg");
  const tgFace = new Map((tgKeyRows ?? []).map((k) => [k.account_id as string, faceInName(k.name as string)]));
  // Лицо строки: у TG Ads — из названия кабинета, у Facebook — из имени кампании.
  const rowFace = (platform: Platform, campaignName: string | null | undefined, accountId: string | null | undefined) =>
    (platform === "tg" ? tgFace.get(accountId ?? "") : null) ?? faceOf(campaignName);
  const platformOfId = (id: string): Platform => (id.startsWith("tg:") ? "tg" : "fb");

  // Строки Torro по людям: что легло на расход и что нет. По людям — потому что
  // у человека с FB и TG Ads один Torro приходит в обе площадки, и имя другой
  // площадки в одной из них «не находится», хотя в другой легло. Только в разрезе
  // по кампаниям: там у обеих площадок одни и те же имена — имена кампаний.
  const crmSeen = new Map<string, Map<string, CrmTotals>>();
  const crmMatched = new Map<string, Set<string>>();
  const crmNote = (userId: string, name: string, c: CrmTotals, matched: boolean) => {
    if (matched) crmMatched.set(userId, (crmMatched.get(userId) ?? new Set()).add(name));
    else if (!crmSeen.get(userId)?.has(name)) crmSeen.set(userId, (crmSeen.get(userId) ?? new Map()).set(name, c));
  };

  const rows = new Map<string, CheckRow>();
  const blank = (key: string, label: string, face: string, platform: Platform = platformOfId(key)): CheckRow => ({
    key, label, platform, face, dailyBudget: null, spend: 0,
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
  function faceByName(pairs: { name: string; face: string }[]): Map<string, string> {
    return onePerName(pairs.map((p) => ({ name: p.name, value: p.face })), MANY_FACES);
  }
  // Строка разреза по объявлениям: ключ — площадка, лицо и креатив или страна.
  const adRow = (platform: Platform, face: string, label: string) => {
    const key = `${platform}|${face}|${label}`;
    const row = rows.get(key) ?? blank(key, label, face, platform);
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
      return { ...base, text: "Ни у кого из выбранных нет источника расхода — подключи Meta, Dolphin, FB Tool или Telegram Ads в Настройках → Интеграции." };
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
    // Один упавший источник не роняет чек целиком: его цифр нет, и об этом сказано
    // в предупреждении. Раньше FB Tool Андрея («reduce the amount of data») ронял
    // живой чек владельцу у всей команды (26.10.2026).
    const failedSources: string[] = [];
    const sourceGuard = <T,>(config: LiveSource, what: string, p: Promise<T>, empty: T): Promise<T> =>
      p.catch((e: unknown) => {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 160);
        failedSources.push(`${buyerLabel.get(config.userId) ?? config.userId} (${what}): ${msg}`);
        console.warn("check: источник не прочитался", config.userId, what, msg);
        return empty;
      });

    // У живого чека таргет спрашивается прямо у Meta. Склад тут не помощник: он
    // собирается по подключениям баеров, а кабинеты владельца в него не попадают
    // вовсе — страновой чек за сегодня иначе состоял бы из одной строки
    // «страна не определена» (замер 31.08.2026).
    if (groupBy === "country") {
      // Dolphin таргет не отдаёт — его страны приходят из нейминга вместе с расходом ниже.
      const targeting = await Promise.all(sources.filter((c) => !own(c)).map((c) =>
        sourceGuard(c, "таргет", fetchAdSetTargeting(c.metaToken, c.accountScope), { items: [], failedAccounts: 0 } as Awaited<ReturnType<typeof fetchAdSetTargeting>>)));
      for (const t of targeting) {
        failedAccounts += t.failedAccounts;
        for (const a of t.items) geoByAdset.set(a.adsetId, a.countries);
      }
    }

    if (groupBy === "campaign") {
      const parts = await Promise.all(sources.map(async (config) => {
        const [meta, campaignMeta, crm] = await Promise.all([
          sourceGuard(config, "расход", own(config) ? dolphinCampaigns(config, since) : fetchCampaignInsights(config.metaToken, since, until, config.accountScope), { items: [], failedAccounts: 0 }),
          sourceGuard(config, "бюджеты", own(config) ? dolphinBudgets(config, since) : fetchCampaignMeta(config.metaToken, config.accountScope), { statuses: new Map(), dailyBudgets: new Map() } as CampaignMeta),
          config.torro ? sourceGuard(config, "Torro", torroForDay(config.torro, since, "campaign_name"), NO_CRM) : NO_CRM,
        ]);
        return { meta, campaignMeta, crm };
      }));

      for (const [i, { meta, campaignMeta, crm }] of parts.entries()) {
        const config = sources[i];
        failedAccounts += meta.failedAccounts;
        const mine = meta.items.filter((c) => take(config, c.accountId));
        for (const c of mine) {
          const platform: Platform = config.tgads ? "tg" : "fb";
          const row = rows.get(c.campaignId) ?? blank(c.campaignId, c.campaignName || c.campaignId, rowFace(platform, c.campaignName, c.accountId), platform);
          row.spend += c.spend;
          row.dailyBudget = campaignMeta.dailyBudgets.get(c.campaignId) ?? null;
          row.accountId = c.accountId?.replace(/^act_/, "");
          row.status = campaignMeta.statuses.get(c.campaignId) ?? row.status ?? null;
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
          crmNote(config.userId, key, c, Boolean(row));
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
          sourceGuard(config, "расход", own(config) ? dolphinAds(config, since, geoByAdset) : fetchAdInsights(config.metaToken, since, until, config.accountScope), { items: [] as MetaAdRow[], failedAccounts: 0 }),
          // TG Ads: доход в Torro — по кампании, а кампания там и есть объявление со
          // страной («Static 2 Mexico»), как в боте-авточекере (Decision 068).
          config.torro ? sourceGuard(config, "Torro", torroForDay(config.torro, since, config.tgads ? "campaign_name" : "ad_name"), NO_CRM) : NO_CRM,
        ]);
        return { meta, crm };
      }));

      for (const [i, { meta, crm }] of parts.entries()) {
        const config = sources[i];
        failedAccounts += meta.failedAccounts;
        const mine = meta.items.filter((a) => take(config, a.accountId));
        // Имя, по которому клеится доход: у TG Ads — кампания (= объявление со страной).
        const nameOf = (a: MetaAdRow) => (config.tgads ? a.campaignName : a.adName).trim();
        const platform: Platform = config.tgads ? "tg" : "fb";

        // Расход и доход раскладываются по одному ключу — иначе строка страны
        // получила бы расход одного множества объявлений и доход другого.
        const country = countryByName(mine.map((a) => ({ name: nameOf(a), adsetId: a.adsetId })));
        const face = faceByName(mine.map((a) => ({ name: nameOf(a), face: rowFace(platform, a.campaignName, a.accountId) })));

        for (const a of mine) {
          const name = nameOf(a);
          // Расход не теряем даже у безымянного объявления: в разрезе по крео
          // такому взяться неоткуда, а в разрезе по странам оно всё равно
          // относится к своему адсету.
          if (!name && groupBy === "creative") continue;
          const label = groupBy === "creative" ? name : country.get(name) ?? countryKey(a.adsetId);
          adRow(platform, face.get(name) ?? rowFace(platform, a.campaignName, a.accountId), label).spend += a.spend;
        }

        // Имя без расхода сегодня — в страну из его прошлого расхода (Decision 095).
        const orphans = groupBy === "country"
          ? await placeOrphans(db, [config.userId], [...crm.rows.keys()].filter((n) => !country.has(n)), platform, (cn, acc) => rowFace(platform, cn, acc))
          : new Map<string, { country: string; face: string }>();
        for (const [name, c] of crm.rows) {
          const o = orphans.get(name);
          const label = groupBy === "creative" ? name : country.get(name) ?? o?.country;
          const row = !label ? undefined : o ? adRow(platform, o.face, label) : rows.get(`${platform}|${face.get(name)}|${label}`);
          if (!row) continue;
          row.subscribers = add(row.subscribers, c.subscribers);
          row.dialogs = add(row.dialogs, c.dialogs);
          row.revenue = add(row.revenue, c.revenue);
        }
      }
    }

    const notes: string[] = [];
    if (failedAccounts > 0) notes.push(`не прочиталось кабинетов: ${failedAccounts}`);
    if (failedSources.length) notes.push(`не прочитались — ${[...new Set(failedSources)].join("; ")}`);
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
        const row = rows.get(d.campaign_id) ?? blank(d.campaign_id, d.campaign_name || d.campaign_id, rowFace(platformOfId(d.campaign_id), d.campaign_name, d.account_id));
        row.spend += num(d.spend);
        row.accountId ??= d.account_id ?? undefined;
        rows.set(d.campaign_id, row);
      }

      // Кампании Torro — по имени (Decision 070): id есть не у всех, имя — у всех.
      const idByName = uniqueIds(days.map((d) => ({ id: d.campaign_id, name: d.campaign_name })));
      const crm = await selectAll<{ user_id: string; campaign_name: string; period_start: string; period_end: string; subscribers: number | null; dialogs: number | null; dep_sum: number | string | null; redep_sum: number | string | null }>((from, to) =>
        db.from("wh_crm_campaign_periods").select("user_id, campaign_name, period_start, period_end, subscribers, dialogs, dep_sum, redep_sum")
          .in("user_id", scope).lte("period_start", until).gte("period_end", since)
          .order("user_id").order("period_start").order("campaign_name")
          .range(from, to)
      );
      for (const c of crm) {
        if (!inside(c.period_start, c.period_end)) { partial++; continue; }
        const revenue = add(c.dep_sum === null ? null : num(c.dep_sum), c.redep_sum === null ? null : num(c.redep_sum));
        const id = idByName.get(c.campaign_name.trim());
        const row = id ? rows.get(id) : undefined;
        crmNote(`${c.user_id}|${c.period_start}`, c.campaign_name, { subscribers: c.subscribers, dialogs: c.dialogs, revenue }, Boolean(row));
        if (!row) continue;
        row.subscribers = add(row.subscribers, c.subscribers);
        row.dialogs = add(row.dialogs, c.dialogs);
        row.revenue = add(row.revenue, revenue);
      }
    } else {
      const daysRaw = await selectAll<{ ad_name: string; ad_id: string; adset_id: string | null; campaign_name: string | null; account_id: string | null; date: string; spend: number | string; source: string }>((from, to) => {
        const q = db.from("wh_ad_days").select("ad_name, ad_id, adset_id, campaign_name, account_id, date, spend, source")
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

      // У TG Ads доход клеится по кампании (= объявление со страной), см. живой чек.
      const nameOf = (d: (typeof days)[number]) => ((d.source === "tgads" ? d.campaign_name : d.ad_name) ?? "").trim();
      const country = countryByName(days.map((d) => ({ name: nameOf(d), adsetId: d.adset_id ?? "" })));
      const platformOf = (d: (typeof days)[number]): Platform => (d.source === "tgads" ? "tg" : "fb");
      const face = faceByName(days.map((d) => ({ name: nameOf(d), face: rowFace(platformOf(d), d.campaign_name, d.account_id) })));
      // Площадка имени — чтобы доход Torro лёг туда же, куда расход.
      const platformByName = new Map(days.map((d) => [nameOf(d), platformOf(d)]));

      for (const d of days) {
        const name = nameOf(d);
        if (!name && groupBy === "creative") continue;
        const label = groupBy === "creative" ? name : country.get(name) ?? countryKey(d.adset_id ?? "");
        adRow(platformOf(d), face.get(name) ?? rowFace(platformOf(d), d.campaign_name, d.account_id), label).spend += num(d.spend);
      }

      // TG Ads — у кого есть кабинеты TG и нет источника Facebook. spend_source = 'tgads' с
      // Decision 069 не пишется, и по нему Torro Павла не клеился вовсе (28.10.2026).
      // ponytail: у баера с FB и TG сразу Torro TG пойдёт по имени объявления — таких пока нет.
      const { data: fbRows } = scope.length
        ? await db.from("buyer_connections").select("user_id").not("spend_source", "is", null).in("user_id", scope)
        : { data: [] as { user_id: string }[] };
      const fbUsers = new Set((fbRows ?? []).map((r) => r.user_id as string));
      const tgUsers = [...new Set((tgKeyRows ?? []).map((k) => k.user_id as string))].filter((u) => !fbUsers.has(u));
      const adUsers = scope.filter((u) => !tgUsers.includes(u));
      type CrmRow = { platform?: Platform; user_id: string; ad_name: string; period_start: string; period_end: string; subscribers: number | null; dialogs: number | null; dep_sum: number | string | null; redep_sum: number | string | null };
      const crm: CrmRow[] = [
        ...(adUsers.length ? (await selectAll<CrmRow>((from, to) =>
          db.from("wh_crm_ad_periods").select("user_id, ad_name, period_start, period_end, subscribers, dialogs, dep_sum, redep_sum")
            .in("user_id", adUsers).lte("period_start", until).gte("period_end", since)
            .order("user_id").order("period_start").order("ad_name")
            .range(from, to)
        )).map((r) => ({ ...r, platform: "fb" as const })) : []),
        // TG Ads — кампании Torro под именем объявления: ad_name здесь — имя кампании.
        ...(tgUsers.length ? (await selectAll<CrmRow>((from, to) =>
          db.from("wh_crm_campaign_periods").select("user_id, ad_name:campaign_name, period_start, period_end, subscribers, dialogs, dep_sum, redep_sum")
            .in("user_id", tgUsers).lte("period_start", until).gte("period_end", since)
            .order("user_id").order("period_start").order("campaign_id")
            .range(from, to)
        )).map((r) => ({ ...r, platform: "tg" as const })) : []),
      ];
      // По креативам строка выгрузки создаёт свою строку даже без расхода: объявление
      // могли выключить, а депозиты по нему ещё доходят. По странам такое имя кладётся в
      // страну из его прошлого расхода или имён кампаний Torro (Decision 095).
      const orphanNames = (p: Platform) => [...new Set(crm.filter((c) => (c.platform ?? "fb") === p && inside(c.period_start, c.period_end))
        .map((c) => (c.ad_name ?? "").trim()).filter((n) => n && !country.has(n)))];
      const faceFor = (p: Platform) => (campaign: string | null, account: string | null) => rowFace(p, campaign, account);
      const orphans = groupBy === "country"
        ? new Map([...await placeOrphans(db, scope, orphanNames("fb"), "fb", faceFor("fb")), ...await placeOrphans(db, scope, orphanNames("tg"), "tg", faceFor("tg"))])
        : new Map<string, { country: string; face: string }>();
      for (const c of crm) {
        if (!inside(c.period_start, c.period_end)) { partial++; continue; }
        const name = (c.ad_name ?? "").trim();
        if (!name) continue;
        const orphan = country.has(name) ? undefined : orphans.get(name);
        const label = groupBy === "creative" ? name : country.get(name) ?? orphan?.country;
        if (!label) continue;
        const row = adRow(platformByName.get(name) ?? c.platform ?? "fb", face.get(name) ?? orphan?.face ?? NO_FACE, label);
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
  const platforms = platformTotals(bySpend, platformsOn);
  const regions = regionTotals(bySpend, groupBy);
  // Строки — блоками по площадкам и лицам, в порядке faces; внутри — по расходу.
  const order = new Map(faces.map((f, i) => [`${f.platform}|${f.face}`, i]));
  const list = [...bySpend].sort((a, b) => order.get(`${a.platform}|${a.face}`)! - order.get(`${b.platform}|${b.face}`)!);
  const spend = list.reduce((s, r) => s + r.spend, 0);
  // Складываем только известное. Если дохода не знает ни одна строка — итог тоже
  // неизвестен: иначе карточка показывала бы «Доход $0.00» и «ROMI −100%» там,
  // где в таблице у всех строк честное «—», и по этому экрану выключили бы связку.
  const withRevenue = list.filter((r) => r.revenue !== null);
  // Что из Torro не легло ни на одну строку расхода — у этого человека за этот день.
  let unmatched: Unmatched | null = null;
  for (const [who, names] of crmSeen) for (const [name, c] of names) {
    if (crmMatched.get(who)?.has(name)) continue;
    unmatched ??= { subscribers: 0, dialogs: 0, revenue: 0, names: 0 };
    unmatched.subscribers += c.subscribers ?? 0;
    unmatched.dialogs += c.dialogs ?? 0;
    unmatched.revenue += c.revenue ?? 0;
    unmatched.names++;
  }
  const revenue = withRevenue.length ? withRevenue.reduce((s, r) => s + (r.revenue as number), 0) : null;
  const artem = groupBy === "campaign" ? await artemInput(db, list, scope, until === today, crmSeen, crmMatched) : null;

  return {
    ...base,
    sources: sourceLabels,
    rows: list,
    faces,
    regions,
    artem,
    platforms,
    unmatched,
    totalBudget,
    totals: {
      spend,
      revenue,
      romi: revenue !== null && spend > 0 ? ((revenue - spend) / spend) * 100 : null,
    },
    text: buildCheckText(list, faces, totalBudget, new Date(), undefined, platforms, regions) + unmatchedLine(unmatched),
    warning,
  };
}

// Вход для формата Артёма (Decision 090). Статус — живой из Meta, а где его нет (Dolphin,
// FB Tool, прошлые дни) — последний известный из склада (wh_entities). Бан — по кабинету:
// всё, кроме ACTIVE и grace period, в том числе пропавший. Живые кампании без расхода — в
// чек за сегодня, как у Артёма: свежая кампания видна до первого цента.
async function artemInput(
  db: ReturnType<typeof warehouse>, rows: CheckRow[], scope: string[], today: boolean,
  crmSeen: Map<string, Map<string, CrmTotals>>, crmMatched: Map<string, Set<string>>,
): Promise<NonNullable<CheckResult["artem"]>> {
  const { data: owned } = scope.length ? await db.from("wh_account_owners").select("account_id").in("owner_user_id", scope) : { data: [] };
  const accounts = new Set([...(owned ?? []).map((o) => o.account_id as string), ...rows.map((r) => r.accountId).filter((a): a is string => Boolean(a))]);
  const ids = [...accounts];
  const [{ data: cabs }, { data: ents }] = ids.length ? await Promise.all([
    db.from("wh_cabinet_states").select("account_id, status").in("account_id", ids),
    db.from("wh_entities").select("entity_id, account_id, name, effective_status, daily_budget, source").eq("level", "campaign").in("account_id", ids),
  ]) : [{ data: [] }, { data: [] }];
  const cab = new Map((cabs ?? []).map((c) => [c.account_id as string, c.status as string]));
  const ent = new Map((ents ?? []).map((e) => [e.entity_id as string, e]));
  const banned = (acc?: string) => { const st = acc ? cab.get(acc) : undefined; return Boolean(st && !["ACTIVE", "IN_GRACE_PERIOD"].includes(st)); };

  const one = (r: CheckRow): ArtemCampaign => {
    const e = ent.get(r.key);
    const status = r.status ?? (e?.effective_status as string | undefined) ?? null;
    const budget = r.dailyBudget ?? (status === "ACTIVE" && e?.daily_budget != null ? Number(e.daily_budget) : null);
    return { name: r.label, spend: r.spend, budget, status, banned: banned(r.accountId ?? (e?.account_id as string | undefined)),
      subscribers: r.subscribers, dialogs: r.dialogs, revenue: r.revenue };
  };
  const campaigns = rows.filter((r) => r.platform === "fb").map(one);
  const tg = rows.filter((r) => r.platform === "tg").map(one);
  if (today) {
    const have = new Set(rows.map((r) => r.key));
    for (const e of ents ?? []) {
      if (have.has(e.entity_id as string) || e.effective_status !== "ACTIVE" || banned(e.account_id as string)) continue;
      const c: ArtemCampaign = { name: (e.name as string) || (e.entity_id as string), spend: 0, budget: e.daily_budget == null ? null : Number(e.daily_budget),
        status: "ACTIVE", banned: false, subscribers: null, dialogs: null, revenue: null };
      (e.source === "tgads" ? tg : campaigns).push(c);
    }
  }
  const torro: ArtemTorro[] = [];
  for (const [who, names] of crmSeen) for (const [name, c] of names) {
    if (crmMatched.get(who)?.has(name)) continue;
    torro.push({ name, subscribers: c.subscribers ?? 0, dialogs: c.dialogs ?? 0, revenue: c.revenue ?? 0 });
  }
  return { campaigns, tg, torro };
}
