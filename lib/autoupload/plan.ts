// Автозалив (Decision 081, 087): сборка из формы — какие кампании, адсеты и объявления
// создать. Логика и нейминг — из Genesis Manager Артёма (auto-upload.cjs), без
// изменений по сути (сеты 1-1-1 раскрывает sets.ts, сюда приходят готовые строки):
//   кампания  CAB####_ДД.ММ_ВОРОНКА_МАРКЕР_GEO_ЛЕНДИНГ_ЛИЦО_N (или свой шаблон)
//   адсет     СТРАНА_АУДИТОРИЯ[_МЕТКА]_TEST1
//   объявление — код креатива, двухбуквенный хвост гео пересобран под страну кампании.
// Ссылка — MVP-лендинг Torro с параметрами трекинга (b, pixel, {{campaign.id}} …).
// Чистые функции: Meta здесь не трогается (это launch.ts).

export const GEOS = ["ESP", "ARG", "MEX", "COL", "CHL", "PER", "PRY", "URY", "ECU", "PAN"] as const;
export const COUNTRY_ISO: Record<string, string> = { ESP: "ES", ARG: "AR", MEX: "MX", COL: "CO", CHL: "CL", PER: "PE", PRY: "PY", URY: "UY", ECU: "EC", PAN: "PA" };
export const FUNNEL_LANDERS: Record<string, string[]> = { TG: ["TGR", "MTG", "VSL1", "VSL2", "KAL1", "KAL2"], WA: ["ART1", "ART2", "ART3"] };
export const MARKERS = ["NEW", "EXP", "MIX"];
export const ACTORS = ["ROMAN", "RICKY"];
export const TARGETS = ["BROAD", "INT", "RETARGET"];
export const CTAS = ["LEARN_MORE", "SIGN_UP", "MESSAGE_PAGE"];
// Для ЕС Meta требует рекламодателя и плательщика в адсете (DSA) — как у Артёма.
export const EU_GEOS = new Set(["ESP"]);
export const DSA_DEFAULT = "Roman B.";

const CODE_RE = /^(vid|stat)-(storytell|checklist|balance|signal|qa|edit|live|lifestyle)-t\d+-v\d+-b\d+-(es|en|pt|ru)(?:-([a-z]{2})?)?$/i;

export interface CreativeInput { key: string; code: string; kind: "video" | "image" }
export interface SharedAdset { id: string; target: string; customAudienceId?: string; label?: string; creatives: CreativeInput[] }
// Строка кампании — как у Артёма: у каждой свои GEO, лицо, воронка, ссылка, страница,
// бюджет, бидкап, время старта на каждый кабинет и шаблоны имён. В 1-1-1 строка — это
// кампания сета: unit говорит, какой адсет и какой креатив в ней (один и один).
export interface CampaignRow {
  key: string; setKey?: string; set?: number;
  geo: string; actor: string; funnel: string; marker: string; lander: string; landingUrl: string;
  pageId?: string; budgetUsd?: number | string; bidCapEnabled?: boolean; bidCapUsd?: number | string;
  startAtByAccount?: Record<string, string>;
  campaignName?: string; adsetNames?: string[];
  unit?: { adset: number; ad: number; key: string };
}
export interface PlanInput {
  accountIds: string[];
  pixelId: string;            // общий пиксель — есть во всех выбранных кабинетах
  pageId: string;             // FP по умолчанию
  date: string;               // ГГГГ-ММ-ДД
  campaignNumber: number;     // с какого N нумеровать
  dailyBudgetUsd: number | string; // бюджет по умолчанию — для строк без своего
  oneToOne: boolean;
  paused: boolean;            // создать на паузе вместо ACTIVE (у Артёма всегда ACTIVE)
  campaigns: CampaignRow[];
  adsets: SharedAdset[];
  text: { primaryText?: string; headline?: string; description?: string; cta: string };
}
export interface AccountInfo { id: string; name: string }

export interface PlanAd { name: string; key: string; kind: "video" | "image" }
export interface PlanAdset { name: string; country: string; target: string; customAudienceId?: string; ads: PlanAd[] }
export interface PlanCampaign {
  accountId: string; cab: string; name: string; geo: string; actor: string; set: number | null;
  pixelId: string; pageId: string; landingUrl: string; budgetUsd: number; bidCapUsd: number | null;
  startLocal: string;         // «ГГГГ-ММ-ДДTЧЧ:ММ» во времени кабинета
  dsa: string | null;
  adsets: PlanAdset[];
}
export interface Plan {
  campaigns: PlanCampaign[];
  paused: boolean;
  text: PlanInput["text"];
  summary: { campaigns: number; adsets: number; ads: number; accounts: number; sets: number; bidCaps: number };
}

const clean = (v: unknown) => String(v ?? "").trim();
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function dateLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error("Дата кампании — в формате ГГГГ-ММ-ДД");
  return `${m[3]}.${m[2]}`;
}

// CAB#### из названия кабинета, иначе последние 4 цифры id.
export function cabCode(a: AccountInfo): string {
  const found = /\bCAB\s*[-_]?\s*(\d{4,})/i.exec(a.name);
  return found ? `CAB${found[1]}` : `CAB${a.id.slice(-4)}`;
}

// Код креатива под гео кампании: «vid-storytell-t31-v1-b2-es-ar» → «…-es-mx» для MEX.
export function codeForGeo(code: string, geo: string): string {
  const raw = clean(code).toLowerCase().replace(/\.[^.]+$/, "");
  const iso = COUNTRY_ISO[geo];
  if (!iso) throw new Error(`Неизвестное GEO ${geo}`);
  const m = CODE_RE.exec(raw);
  // Старые имена (videoM2FXtoro) — как есть: гео пересобирать не из чего. У Артёма их
  // не пускало; у нас ими льют до сих пор (Decision 036).
  if (!m) return raw;
  const base = m[4] ? raw.slice(0, -3) : raw.replace(/-$/, "");
  return `${base}-${iso.toLowerCase()}`;
}

const TRACKING = new Set(["b", "pixel", "campaign_id", "adset_id", "ad_id", "campaign_name", "adset_name", "ad_name", "placement", "site_source_name"]);
export function trackedUrl(raw: string, buyerId: number | null, pixelId: string): string {
  let u: URL;
  try { u = new URL(clean(raw)); } catch { throw new Error("Ссылка MVP указана неверно"); }
  if (u.protocol !== "https:") throw new Error("Ссылка MVP должна начинаться с https://");
  const [beforeHash, hash = ""] = u.toString().split("#");
  const [base, query = ""] = beforeHash.split("?");
  const keep = query.split("&").filter((p) => p && !TRACKING.has(decodeURIComponent(p.split("=")[0]).toLowerCase()));
  const add = [
    ...(buyerId ? [`b=${buyerId}`] : []), `pixel=${pixelId}`,
    "campaign_id={{campaign.id}}", "adset_id={{adset.id}}", "ad_id={{ad.id}}",
    "campaign_name={{campaign.name}}", "adset_name={{adset.name}}", "ad_name={{ad.name}}",
    "placement={{placement}}", "site_source_name={{site_source_name}}",
  ];
  return `${base}?${[...keep, ...add].join("&")}${hash ? `#${hash}` : ""}`;
}

// Шаблон имени, как у Артёма: {{CAB}} {{GEO}} {{N}} … Неизвестный токен — ошибка, а не
// «{{ЧТО-ТО}}» в имени кампании.
export const NAME_TOKENS = ["CAB", "ACCOUNT_CODE", "ACCOUNT_ID", "DATE", "GEO", "FACE", "ACTOR", "FUNNEL", "MARKER", "LANDER", "N", "SET", "CREATIVE", "ADSET_N"];
export function fillName(tpl: string, values: Record<string, string>, where: string): string {
  const out = tpl.replace(/\{\{\s*([A-Z_]+)\s*\}\}/gi, (_, t: string) => {
    const k = t.toUpperCase();
    if (!(k in values)) throw new Error(`${where}: неизвестный токен {{${t}}} — есть ${NAME_TOKENS.map((x) => `{{${x}}}`).join(" ")}`);
    return values[k];
  }).trim();
  if (!out) throw new Error(`${where}: пустое имя`);
  return out;
}

const positive = (v: unknown, msg: string) => {
  const n = Number(String(v ?? "").replace(",", "."));
  if (!(n > 0) || !Number.isFinite(n)) throw new Error(msg);
  return Math.round(n * 1e6) / 1e6;
};

export function buildPlan(input: PlanInput, accounts: Map<string, AccountInfo>, torroBuyerId: number | null): Plan {
  const ids = [...new Set(input.accountIds.map((x) => clean(x).replace(/^act_/, "")).filter((x) => /^\d+$/.test(x)))];
  if (!ids.length) throw new Error("Выбери хотя бы один кабинет");
  const pixelId = clean(input.pixelId);
  if (!/^\d+$/.test(pixelId)) throw new Error("Выбери общий пиксель");
  const date = dateLabel(clean(input.date));
  const firstN = Number(input.campaignNumber) || 1;
  if (!Number.isInteger(firstN) || firstN < 1) throw new Error("Номер кампании — целое число от 1");
  const rows = input.campaigns;
  if (!rows.length) throw new Error("Добавь хотя бы одну кампанию");
  if (rows.length > 50) throw new Error("Не больше 50 кампаний за раз");
  if (!input.adsets.length) throw new Error("Добавь хотя бы один адсет с креативами");
  input.adsets.forEach((a, i) => {
    if (!TARGETS.includes(a.target)) throw new Error(`Адсет ${i + 1}: неизвестная аудитория`);
    if (a.target === "RETARGET" && !/^\d+$/.test(clean(a.customAudienceId))) throw new Error(`Адсет ${i + 1}: для RETARGET укажи ID Custom Audience`);
    if (!a.creatives.length) throw new Error(`Адсет ${i + 1}: добавь хотя бы один креатив`);
    if (a.creatives.length > 50) throw new Error(`Адсет ${i + 1}: не больше 50 креативов`);
  });

  const campaigns: PlanCampaign[] = [];
  const nByGeo = new Map<string, number>();
  rows.forEach((row, ri) => {
    const where = `Кампания ${ri + 1}`;
    const geo = clean(row.geo).toUpperCase(), actor = clean(row.actor).toUpperCase(), funnel = clean(row.funnel).toUpperCase();
    const marker = clean(row.marker).toUpperCase(), lander = clean(row.lander).toUpperCase();
    if (!COUNTRY_ISO[geo]) throw new Error(`${where}: выбери конкретное GEO`);
    if (!FUNNEL_LANDERS[funnel]?.includes(lander)) throw new Error(`${where}: проверь воронку и лендинг`);
    if (!MARKERS.includes(marker) || !ACTORS.includes(actor)) throw new Error(`${where}: проверь маркер и лицо`);
    if (!clean(row.landingUrl)) throw new Error(`${where}: выбери ссылку MVP`);
    const pageId = clean(row.pageId) || clean(input.pageId);
    if (!/^\d+$/.test(pageId)) throw new Error(`${where}: выбери Facebook Page`);
    const budget = positive(clean(row.budgetUsd) || input.dailyBudgetUsd, `Бюджет кампании ${ri + 1}: укажи сумму больше нуля`);
    const bidCap = row.bidCapEnabled ? positive(row.bidCapUsd, `Bid cap кампании ${ri + 1}: укажи сумму больше нуля`) : null;

    // 1-1-1: один адсет и один креатив сета. Ключ сверяется — набор могли поменять.
    let source: SharedAdset[] = input.adsets;
    if (row.unit) {
      const a = input.adsets[row.unit.adset], c = a?.creatives[row.unit.ad];
      if (!c || c.key !== row.unit.key) throw new Error(`${where}: список креативов изменился — обнови сборку`);
      source = [{ ...a, creatives: [c] }];
    }

    // Номер растёт только у повторов одного GEO; кабинеты его не двигают.
    const n = firstN + (nByGeo.get(geo) ?? 0);
    nByGeo.set(geo, (nByGeo.get(geo) ?? 0) + 1);
    for (const accountId of ids) {
      const acc = accounts.get(accountId);
      if (!acc) throw new Error(`Кабинет ${accountId} не твой или недоступен`);
      const cab = cabCode(acc);
      const time = clean(row.startAtByAccount?.[accountId]) || "00:00";
      if (!TIME_RE.test(time)) throw new Error(`У кампании ${ri + 1} неверное время запуска для кабинета ${cab} — ЧЧ:ММ`);
      const tokens: Record<string, string> = {
        CAB: cab, ACCOUNT_CODE: cab, ACCOUNT_ID: accountId, DATE: date, GEO: geo, FACE: actor, ACTOR: actor,
        FUNNEL: funnel, MARKER: marker, LANDER: lander, N: String(n), SET: String(row.set ?? ""),
        CREATIVE: row.unit ? codeForGeo(source[0].creatives[0].code, geo) : "", ADSET_N: "",
      };
      const seen = new Set<string>();
      const adsets = source.map((a, ai): PlanAdset => {
        const tpl = clean(row.adsetNames?.[ai]);
        const label = clean(a.label).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
        let name = tpl ? fillName(tpl, { ...tokens, ADSET_N: String(ai + 1) }, `${where}, адсет ${ai + 1}`) : `${geo}_${a.target}${label ? `_${label}` : ""}`;
        if (!/_TEST1$/i.test(name)) name += "_TEST1";
        if (seen.has(name)) throw new Error(`Адсеты не должны повторяться в кампании: ${name} — поставь метку или своё имя`);
        seen.add(name);
        return {
          name, country: COUNTRY_ISO[geo], target: a.target, customAudienceId: clean(a.customAudienceId) || undefined,
          ads: a.creatives.map((c) => ({ name: codeForGeo(c.code, geo), key: c.key, kind: c.kind })),
        };
      });
      const tpl = clean(row.campaignName);
      campaigns.push({
        accountId, cab, geo, actor, set: row.set ?? null, pixelId, pageId,
        name: tpl ? fillName(tpl, tokens, where) : `${cab}_${date}_${funnel}_${marker}_${geo}_${lander}_${actor}_${n}`,
        landingUrl: trackedUrl(row.landingUrl, torroBuyerId, pixelId), budgetUsd: budget, bidCapUsd: bidCap,
        startLocal: `${clean(input.date)}T${time}`,
        dsa: EU_GEOS.has(geo) ? DSA_DEFAULT : null, adsets,
      });
    }
  });
  if (!CTAS.includes(clean(input.text.cta).toUpperCase())) throw new Error("Выбери кнопку (CTA)");
  return {
    campaigns, paused: Boolean(input.paused),
    text: { ...input.text, cta: clean(input.text.cta).toUpperCase() },
    summary: {
      campaigns: campaigns.length, accounts: ids.length,
      adsets: campaigns.reduce((s, c) => s + c.adsets.length, 0),
      ads: campaigns.reduce((s, c) => s + c.adsets.reduce((t, a) => t + a.ads.length, 0), 0),
      sets: new Set(rows.map((r) => r.setKey).filter(Boolean)).size,
      bidCaps: campaigns.filter((c) => c.bidCapUsd !== null).length,
    },
  };
}

// Местное время кабинета → UTC ISO (start_time адсета).
export function zonedToUtc(local: string, timeZone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error("Время запуска указано неверно");
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offset = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
  };
  let guess = wall;
  for (let i = 0; i < 3; i++) guess = wall - offset(guess);
  return new Date(guess).toISOString();
}
