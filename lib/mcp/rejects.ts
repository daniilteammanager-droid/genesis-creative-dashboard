import { selectAll, warehouse } from "@/lib/warehouse/read";
import { resolveScope } from "@/lib/warehouse/accounts";
import { textKey } from "@/lib/traffic-report/load";
import { parseCreativeCode, parseName } from "@/lib/creatives/code";
import { mskDay, mskTime } from "@/lib/day";
import type { Profile } from "@/lib/auth/types";
import { accountMatches, pickBuyer } from "./scope";
import { ToolError, type ToolDef } from "./protocol";

// Отклонённые объявления Meta через AI: какие крео реджектят чаще и за что — чтобы сравнить с теми, что проходят
// модерацию. Только чтение. Права как у остальных инструментов (resolveScope): баер — свои кабинеты, владелец и
// тимлид — вся команда или один баер; кабинет Facebook — чей по wh_account_owners.
// Два источника: wh_rejected_ads — что отклонено сейчас (одобрили — строка удаляется, lib/alerts/rejected.ts),
// antireject_events — история отклонений и действий антиотклона (с 28.10.2026). TG Ads не берём — решение Даниила.

interface Ctx { me: Profile; tokenId?: string }
type Tool = ToolDef<Ctx>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const HISTORY = "История неполная. Что отклонено сейчас — известно с 24.10.2026: первый прогон в тот день запомнил всё, что уже было отклонено, и время у таких — 24.10, а не день отклонения. "
  + "Одобренные и удалённые объявления остаются только в истории событий, она ведётся с 28.10.2026: отклонённое и одобренное до 28.10 не сохранилось. "
  + "Время — когда дашборд заметил отклонение (проверка раз в 15 минут, только живые кабинеты), а не когда Meta отклонила. Повторное отклонение после одобрения — ещё один момент в rejected. "
  + "now_rejected=false — одобрили, удалили или поправили антиотклоном. У части объявлений причины нет — Meta или FB Tool её не вернули («Причины нет»). "
  + "Домена ленда в истории нет — только код ленда из имени кампании (land). TG Ads не входят.";

// ── Чистая часть (самопроверка — rejects.test.ts) ────────────────────────────

export interface CurrentRow { ad_id: string; account_id: string; ad_name: string | null; campaign_name: string | null; adset_name: string | null; status: string; reason: string | null; first_seen_at: string }
export interface EventRow { created_at: string; kind: "rejected" | "action"; ad_id: string; account_id: string | null; ad_name: string | null; campaign_name: string | null; actor: string | null; text: string | null; ok: boolean | null; status: string | null }

export interface Ad {
  adId: string; accountId: string; name: string; campaign: string | null; adset: string | null;
  status: string | null;   // отклонено сейчас — статус Meta; null — сейчас не в отклонённых
  reason: string | null;   // последняя известная причина
  times: string[];         // когда дашборд заметил отклонение (ISO), по порядку
  actions: EventRow[];
}

// Только Meta: у TG Ads id «tg:…» (tgId в lib/tgads/api.ts), служебные отметки — «__initialized__», «__initialized__:<id>».
export const isMeta = (adId: string) => !adId.startsWith("tg:") && !adId.startsWith("__");
// Событие отклонения без причины хранит вместо неё статус.
const bare = (t: string | null) => (!t?.trim() || /^(DISAPPROVED|WITH_ISSUES|declined)$/i.test(t.trim()) ? null : t.trim());
const ms = (iso: string) => Date.parse(iso);

// Текущие отклонения + история → одно объявление со всеми моментами отклонения и действиями антиотклона.
export function merge(current: CurrentRow[], events: EventRow[]): Ad[] {
  const by = new Map<string, Ad>();
  const get = (id: string, r: { account_id: string | null; ad_name: string | null; campaign_name: string | null }) =>
    by.get(id) ?? by.set(id, { adId: id, accountId: r.account_id ?? "", name: (r.ad_name ?? "").trim(), campaign: r.campaign_name, adset: null, status: null, reason: null, times: [], actions: [] }).get(id)!;
  for (const e of [...events].sort((x, y) => ms(x.created_at) - ms(y.created_at))) {
    if (!isMeta(e.ad_id)) continue;
    const ad = get(e.ad_id, e);
    if (e.kind === "rejected") { ad.times.push(e.created_at); ad.reason = bare(e.text) ?? ad.reason; }
    else ad.actions.push(e);
  }
  for (const r of current) {
    if (!isMeta(r.ad_id) || r.status === "declined") continue;
    const ad = get(r.ad_id, r);
    Object.assign(ad, { name: r.ad_name?.trim() || ad.name, campaign: r.campaign_name ?? ad.campaign, adset: r.adset_name, status: r.status, reason: r.reason ?? ad.reason });
    // Событие текущего отклонения пишется следом за строкой. Нет его — отклонение тихое (первый прогон, до 28.10).
    if (!ad.times.some((t) => ms(t) >= ms(r.first_seen_at) - 60_000)) ad.times = [...ad.times, r.first_seen_at].sort((x, y) => ms(x) - ms(y));
  }
  // ponytail: объявление с действием, но без момента отклонения (тихое, строку убрал антиотклон) — не показываем; пока таких нет.
  return [...by.values()].filter((a) => a.times.length);
}

// Политика Meta — то, что до «:» в строке причины (у placement_specific — после площадки). Кабинеты на русском и
// английском называют одну политику по-разному — сводим к одному имени, иначе сводка дробится.
const POLICIES: [RegExp, string][] = [
  [/^spam$|^спам$/i, "Спам"],
  [/unacceptable business|недопустимые бизнес/i, "Недопустимые бизнес-модели"],
  [/gambling|азартн/i, "Азартные игры"],
  [/fraud|scam|deceptive|мошенничеств/i, "Мошенничество и обман"],
  [/discriminat|дискриминац/i, "Дискриминация"],
  [/crypto|криптовалют/i, "Криптовалюта"],
  [/financial|финансов/i, "Финансовые услуги"],
  [/advertiser|идентификацион/i, "Нет подтверждённого рекламодателя"],
];
export const NO_REASON = "Причины нет";
export function policiesOf(reason: string | null): string[] {
  const out = (reason ?? "").split("\n").map((line) => {
    const head = (line.includes(":") ? line.slice(0, line.indexOf(":")) : line).split(" · ").pop()!.trim();
    return POLICIES.find(([re]) => re.test(head))?.[1] ?? head.slice(0, 80);
  }).filter(Boolean);
  return out.length ? [...new Set(out)] : [NO_REASON];
}

export interface Query { since: string | null; until: string | null; accounts: string[] | null; account: string; search: string }
export interface Hit { ad: Ad; times: string[] }

// Объявления, замеченные отклонёнными в периоде (день — по Москве), с моментами внутри периода; новые первыми.
// accounts — область видимости из resolveScope: null — все кабинеты, [] — ничего.
export function pickAds(ads: Ad[], f: Query): Hit[] {
  const scope = f.accounts && new Set(f.accounts);
  const q = f.search.toLowerCase();
  const out: Hit[] = [];
  for (const ad of ads) {
    if (scope && !scope.has(ad.accountId)) continue;
    if (!accountMatches(ad.accountId, f.account)) continue;
    if (q && !ad.name.toLowerCase().includes(q) && !(ad.campaign ?? "").toLowerCase().includes(q)) continue;
    const times = ad.times.filter((t) => { const d = mskDay(new Date(t)); return (!f.since || d >= f.since) && (!f.until || d <= f.until); });
    if (times.length) out.push({ ad, times });
  }
  return out.sort((x, y) => ms(y.times.at(-1)!) - ms(x.times.at(-1)!));
}

// Что видно из имён: текст «bN · tN» (как textKey у get_stats), лицо, ленд и воронка — из имени кампании, гео — из
// кампании, иначе из кода крео.
export function factsOf(ad: Ad) {
  const n = parseName(ad.campaign ?? ""), c = parseCreativeCode(ad.name);
  return {
    text: textKey(ad.name)?.replace("|", " · ") ?? null, face: n.face ?? null, land: n.land ?? null, funnel: n.funnel ?? null,
    geo: n.geo ?? (c.scheme === "v2" ? c.geo.toUpperCase() : null), policies: policiesOf(ad.reason),
  };
}

export const GROUPS = ["creative", "text", "reason", "buyer", "account", "face", "land", "geo"] as const;
export type Group = (typeof GROUPS)[number];
export type Who = (accountId: string) => { buyer: string; account: string };

function keysOf(ad: Ad, g: Group, who: Who): string[] {
  const f = factsOf(ad);
  switch (g) {
    case "creative": return [ad.name || "без имени"];
    case "text": return [f.text ?? "без кода текста"];
    case "reason": return f.policies;
    case "buyer": return [who(ad.accountId).buyer];
    case "account": return [who(ad.accountId).account];
    default: return [f[g] ?? "—"];
  }
}

// Сводка: сколько объявлений и моментов отклонения, сколько отклонено сейчас. У объявления с двумя политиками — в обеих.
export interface Bucket { name: string; ads: number; rejections: number; now_rejected: number }
export function summarize(hits: Hit[], g: Group, who: Who): Bucket[] {
  const by = new Map<string, Bucket>();
  for (const { ad, times } of hits) for (const k of keysOf(ad, g, who)) {
    const b = by.get(k) ?? by.set(k, { name: k, ads: 0, rejections: 0, now_rejected: 0 }).get(k)!;
    b.ads++; b.rejections += times.length; if (ad.status) b.now_rejected++;
  }
  return [...by.values()].sort((x, y) => y.ads - x.ads || y.rejections - x.rejections || x.name.localeCompare(y.name));
}

const at = (iso: string) => `${mskDay(new Date(iso))} ${mskTime(new Date(iso))}`;

export function rowOf({ ad, times }: Hit, who: Who, showBuyer: boolean) {
  const f = factsOf(ad), w = who(ad.accountId);
  return {
    ad_id: ad.adId, creative: ad.name, text: f.text ?? undefined, buyer: showBuyer ? w.buyer : undefined,
    account_id: ad.accountId, account: w.account, campaign: ad.campaign ?? undefined, adset: ad.adset ?? undefined,
    face: f.face ?? undefined, land: f.land ?? undefined, funnel: f.funnel ?? undefined, geo: f.geo ?? undefined,
    rejected: times.map(at), now_rejected: !!ad.status, status: ad.status ?? undefined,
    policies: f.policies, reason: ad.reason ? ad.reason.slice(0, 300) : undefined,
    actions: ad.actions.length ? ad.actions.map((e) => ({ at: at(e.created_at), by: e.actor ?? undefined, what: e.text ?? undefined, ok: e.ok, status: e.status ?? undefined })) : undefined,
  };
}

// ── Инструмент ───────────────────────────────────────────────────────────────

// ponytail: вся история целиком (на 17.11 — ~1,1 тыс. строк, +30 в день), отбор в памяти. Вырастет за 20 тыс. — период и кабинеты в запрос к базе.
async function loadAds(): Promise<Ad[]> {
  const db = warehouse();
  const [current, events] = await Promise.all([
    selectAll<CurrentRow>((from, to) => db.from("wh_rejected_ads")
      .select("ad_id, account_id, ad_name, campaign_name, adset_name, status, reason, first_seen_at").order("ad_id").range(from, to)),
    selectAll<EventRow>((from, to) => db.from("antireject_events")
      .select("created_at, kind, ad_id, account_id, ad_name, campaign_name, actor, text, ok, status").order("created_at").order("id").range(from, to)),
  ]);
  return merge(current, events);
}

const intOf = (v: unknown, def: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(Number(v)) ? Math.floor(Number(v)) : def));

const getRejects: Tool = {
  name: "get_rejects",
  title: "Отклонённые объявления",
  description: "Отклонённые модерацией объявления Meta (Facebook) — чтобы разобрать, какие крео реджектят чаще и за что. В строке: крео (имя объявления — то же имя, что у get_creative и get_transcript), текст «bN · tN», баер, кабинет, кампания, адсет, лицо, ленд, воронка, гео, когда замечено отклонённым, отклонено ли сейчас, политики и причина Meta, действия антиотклона по объявлению (ok — приняла ли Meta). Сводка — сколько объявлений и отклонений по крео, тексту, политике, баеру, кабинету, лицу, ленду, гео. Крео, которые проходят модерацию и крутятся, — get_stats с group_by=creative. TG Ads не входят. Баер видит свои кабинеты, владелец и тимлид — команду. Ограничения истории — в поле history ответа.",
  inputSchema: {
    type: "object",
    properties: {
      since: { type: "string", description: "Первый день, когда замечено отклонение, YYYY-MM-DD (по Москве). Пусто — вся история." },
      until: { type: "string", description: "Последний день включительно, YYYY-MM-DD. Пусто — по сегодня." },
      buyer: { type: "string", description: "Только для владельца и тимлида: один баер — имя, код (b1) или почта. Пусто — вся команда." },
      account: { type: "string", description: "Один кабинет: id (как в get_cabinets) или CAB и последние 4 цифры, как в имени кампании (CAB0956)." },
      search: { type: "string", description: "Часть имени объявления или кампании, без учёта регистра: t38, edit, MTG, ROMAN." },
      group_by: { type: "array", items: { type: "string", enum: [...GROUPS] }, description: "Разбивки сводки: creative, text (bN · tN), reason (политика Meta), buyer, account, face, land, geo. По умолчанию creative, text, reason." },
      top: { type: "integer", description: "Сколько строк в каждой разбивке, 1–100. По умолчанию 10." },
      limit: { type: "integer", description: "Сколько объявлений списком, новые первыми, 0–300. По умолчанию 30; 0 — только сводка." },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, title: "Отклонённые объявления" },
  async run({ me }, a) {
    const since = str(a.since) || null, until = str(a.until) || null;
    if ((since && !DAY.test(since)) || (until && !DAY.test(until))) throw new ToolError("Даты — в формате YYYY-MM-DD");
    if (since && until && since > until) throw new ToolError("since позже until");
    const db = warehouse();
    const buyer = await pickBuyer(me, a.buyer);
    const [{ buyers, accountIds }, { data: owners }, ads] = await Promise.all([
      resolveScope(db, me, buyer.id), db.from("wh_account_owners").select("account_id, account_name, owner_user_id"), loadAds(),
    ]);
    const label = new Map(buyers.map((b) => [b.id, b.label]));
    const own = new Map((owners ?? []).map((o) => [o.account_id as string, o]));
    const who: Who = (id) => {
      const o = own.get(id);
      return { buyer: o?.owner_user_id ? label.get(o.owner_user_id as string) ?? "—" : "не закреплён", account: `CAB${id.slice(-4)}${o?.account_name ? ` · ${o.account_name}` : ""}` };
    };
    const hits = pickAds(ads, { since, until, accounts: accountIds, account: str(a.account), search: str(a.search) });
    const wanted = Array.isArray(a.group_by) ? a.group_by.map(String).filter((g): g is Group => (GROUPS as readonly string[]).includes(g)) : [];
    const groups = wanted.length ? [...new Set(wanted)] : (["creative", "text", "reason"] as Group[]);
    const top = intOf(a.top, 10, 1, 100), limit = intOf(a.limit, 30, 0, 300);
    return {
      scope: buyer.label, period: { since: since ?? "вся история", until: until ?? "сегодня" },
      totals: { ads: hits.length, rejections: hits.reduce((s, h) => s + h.times.length, 0), now_rejected: hits.filter((h) => h.ad.status).length, with_actions: hits.filter((h) => h.ad.actions.length).length },
      groups: Object.fromEntries(groups.map((g) => {
        const all = summarize(hits, g, who);
        return [g, { rows: all.slice(0, top), more: Math.max(0, all.length - top) || undefined }];
      })),
      rows: limit ? hits.slice(0, limit).map((h) => rowOf(h, who, me.role !== "buyer")) : undefined,
      more_rows: Math.max(0, hits.length - limit) || undefined,
      history: HISTORY,
    };
  },
};

export const REJECT_TOOLS: Tool[] = [getRejects];
