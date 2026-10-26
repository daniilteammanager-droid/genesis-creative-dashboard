// Автозалив (Decision 081): сборка из формы — какие кампании, адсеты и объявления
// создать. Логика и нейминг — из Genesis Manager Артёма (auto-upload.cjs), без
// изменений по сути:
//   кампания  CAB####_ДД.ММ_ВОРОНКА_МАРКЕР_GEO_ЛЕНДИНГ_ЛИЦО_N
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
export const CTAS = ["LEARN_MORE", "SIGN_UP", "CONTACT_US", "MESSAGE_PAGE", "APPLY_NOW", "SUBSCRIBE"];
// Для ЕС Meta требует рекламодателя и плательщика в адсете (DSA) — как у Артёма.
export const EU_GEOS = new Set(["ESP"]);
export const DSA_DEFAULT = "Roman B.";

const CODE_RE = /^(vid|stat)-(storytell|checklist|balance|signal|qa|edit|live|lifestyle)-t\d+-v\d+-b\d+-(es|en|pt|ru)(?:-([a-z]{2})?)?$/i;

export interface CreativeInput { key: string; code: string; kind: "video" | "image" }
export interface PlanInput {
  accountIds: string[];
  pixelByAccount: Record<string, string>;
  pageId: string;
  date: string;               // ГГГГ-ММ-ДД
  launchTime?: string;        // ЧЧ:ММ во времени кабинета; пусто — сразу
  campaignNumber: number;     // с какого N нумеровать
  dailyBudgetUsd: number;
  oneToOne: boolean;          // 1-1-1: на каждый креатив своя кампания с одним адсетом
  paused: boolean;            // создать на паузе вместо ACTIVE
  campaigns: { geo: string; actor: string; funnel: string; marker: string; lander: string; landingUrl: string }[];
  adsets: { target: string; customAudienceId?: string; label?: string; creatives: CreativeInput[] }[];
  text: { primaryText?: string; headline?: string; description?: string; cta: string };
}
export interface AccountInfo { id: string; name: string }

export interface PlanAd { name: string; key: string; kind: "video" | "image" }
export interface PlanAdset { name: string; country: string; target: string; customAudienceId?: string; ads: PlanAd[] }
export interface PlanCampaign {
  accountId: string; cab: string; name: string; geo: string; actor: string;
  pixelId: string; pageId: string; landingUrl: string; budgetUsd: number;
  startLocal: string | null;  // «ГГГГ-ММ-ДДTЧЧ:ММ» во времени кабинета
  dsa: string | null;
  adsets: PlanAdset[];
}
export interface Plan {
  campaigns: PlanCampaign[];
  paused: boolean;
  text: PlanInput["text"];
  summary: { campaigns: number; adsets: number; ads: number; accounts: number };
}

const clean = (v: unknown) => String(v ?? "").trim();

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

export function buildPlan(input: PlanInput, accounts: Map<string, AccountInfo>, torroBuyerId: number | null): Plan {
  const ids = [...new Set(input.accountIds.map((x) => clean(x).replace(/^act_/, "")).filter((x) => /^\d+$/.test(x)))];
  if (!ids.length) throw new Error("Выбери хотя бы один кабинет");
  if (!/^\d+$/.test(clean(input.pageId))) throw new Error("Выбери Facebook Page");
  const date = dateLabel(clean(input.date));
  const time = clean(input.launchTime);
  if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Время запуска — ЧЧ:ММ");
  const budget = Number(input.dailyBudgetUsd);
  if (!(budget > 0)) throw new Error("Укажи дневной бюджет в долларах");
  const firstN = Number(input.campaignNumber) || 1;
  if (!Number.isInteger(firstN) || firstN < 1) throw new Error("Номер кампании — целое число от 1");
  if (!input.campaigns.length) throw new Error("Добавь хотя бы одну кампанию");
  if (!input.adsets.length) throw new Error("Добавь хотя бы один адсет с креативами");
  input.adsets.forEach((a, i) => {
    if (!TARGETS.includes(a.target)) throw new Error(`Адсет ${i + 1}: неизвестная аудитория`);
    if (a.target === "RETARGET" && !/^\d+$/.test(clean(a.customAudienceId))) throw new Error(`Адсет ${i + 1}: для RETARGET укажи ID Custom Audience`);
    if (!a.creatives.length) throw new Error(`Адсет ${i + 1}: добавь хотя бы один креатив`);
  });

  // 1-1-1 — каждый креатив отдельным «сетом»: своя кампания и свой адсет.
  const units = input.oneToOne
    ? input.adsets.flatMap((a) => a.creatives.map((c) => [{ ...a, creatives: [c] }]))
    : [input.adsets];

  const campaigns: PlanCampaign[] = [];
  const nByGeo = new Map<string, number>();
  input.campaigns.forEach((row, ri) => {
    const geo = clean(row.geo).toUpperCase(), actor = clean(row.actor).toUpperCase(), funnel = clean(row.funnel).toUpperCase();
    const marker = clean(row.marker).toUpperCase(), lander = clean(row.lander).toUpperCase();
    if (!COUNTRY_ISO[geo]) throw new Error(`Кампания ${ri + 1}: выбери конкретное GEO`);
    if (!FUNNEL_LANDERS[funnel]?.includes(lander)) throw new Error(`Кампания ${ri + 1}: проверь воронку и лендинг`);
    if (!MARKERS.includes(marker) || !ACTORS.includes(actor)) throw new Error(`Кампания ${ri + 1}: проверь маркер и лицо`);
    if (!clean(row.landingUrl)) throw new Error(`Кампания ${ri + 1}: выбери ссылку MVP`);
    for (const unit of units) {
      // Номер растёт только у повторов одного GEO; размножение по кабинетам его не двигает.
      const n = firstN + (nByGeo.get(geo) ?? 0);
      nByGeo.set(geo, (nByGeo.get(geo) ?? 0) + 1);
      for (const accountId of ids) {
        const acc = accounts.get(accountId);
        if (!acc) throw new Error(`Кабинет ${accountId} не твой или недоступен`);
        const pixelId = clean(input.pixelByAccount[accountId]);
        if (!/^\d+$/.test(pixelId)) throw new Error(`Для кабинета ${cabCode(acc)} выбери пиксель`);
        const cab = cabCode(acc);
        const seen = new Set<string>();
        const adsets = unit.map((a): PlanAdset => {
          const label = clean(a.label).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
          const name = `${geo}_${a.target}${label ? `_${label}` : ""}_TEST1`;
          if (seen.has(name)) throw new Error(`Адсеты не должны повторяться в кампании: ${name} — поставь метку`);
          seen.add(name);
          return {
            name, country: COUNTRY_ISO[geo], target: a.target, customAudienceId: clean(a.customAudienceId) || undefined,
            ads: a.creatives.map((c) => ({ name: codeForGeo(c.code, geo), key: c.key, kind: c.kind })),
          };
        });
        campaigns.push({
          accountId, cab, geo, actor, pixelId, pageId: clean(input.pageId),
          name: `${cab}_${date}_${funnel}_${marker}_${geo}_${lander}_${actor}_${n}`,
          landingUrl: trackedUrl(row.landingUrl, torroBuyerId, pixelId), budgetUsd: budget,
          startLocal: time ? `${clean(input.date)}T${time}` : null,
          dsa: EU_GEOS.has(geo) ? DSA_DEFAULT : null, adsets,
        });
      }
    }
  });
  if (campaigns.length > 50 * ids.length) throw new Error("За один запуск — не больше 50 кампаний на кабинет");
  if (!CTAS.includes(clean(input.text.cta).toUpperCase())) throw new Error("Выбери кнопку (CTA)");
  return {
    campaigns, paused: Boolean(input.paused),
    text: { ...input.text, cta: clean(input.text.cta).toUpperCase() },
    summary: {
      campaigns: campaigns.length, accounts: ids.length,
      adsets: campaigns.reduce((s, c) => s + c.adsets.length, 0),
      ads: campaigns.reduce((s, c) => s + c.adsets.reduce((t, a) => t + a.ads.length, 0), 0),
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
