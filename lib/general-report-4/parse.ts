import type { Gr4Row, Gr4Targets } from "./types";

// Разбор листов GR 4.0. Значения приходят из Sheets API как UNFORMATTED_VALUE +
// SERIAL_NUMBER: числа — числами, даты — серийным номером дня.
//
// Раскладка колонок одна для всех листов: A дата, B лицо, C язык, D гео,
// E источник, F воронка, G баер. Дальше у каждого листа свои цифры, а регион
// подставлен формулой в отдельной колонке (см. build.py в «Новый формат таблиц»).

const SERIAL_EPOCH = Date.UTC(1899, 11, 30);

function isoDate(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 30000) return null; // пусто, текст, мусор
  return new Date(SERIAL_EPOCH + Math.round(v) * 86_400_000).toISOString().slice(0, 10);
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string" || v.trim() === "") return 0;
  const n = parseFloat(v.replace(/[$\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function blank(r: Partial<Gr4Row> & Pick<Gr4Row, "date">): Gr4Row {
  return {
    country: "", face: "", lang: "", region: "", source: "", funnel: "", buyer: "",
    revenue: 0, budget: 0, adClicks: 0, websiteClicks: 0, impressions: 0,
    registrations: 0, dialogs: 0,
    depCountCpa: 0, depCountIb: 0, depAmountCpa: 0, depAmountIb: 0,
    payoutsCpa: 0, payoutsIb: 0, revenueCpa: 0, revenueIb: 0,
    ...r,
  };
}

function dims(row: unknown[], regionIdx: number) {
  return {
    face: str(row[1]), lang: str(row[2]), country: str(row[3]),
    source: str(row[4]), funnel: str(row[5]), buyer: str(row[6]),
    region: str(row[regionIdx]),
  };
}

const hasAny = (r: Gr4Row, keys: (keyof Gr4Row)[]) => keys.some((k) => r[k] !== 0);
const TRAFFIC: (keyof Gr4Row)[] = ["budget", "impressions", "adClicks", "websiteClicks", "registrations", "dialogs"];

// «Трафик»: A–G разрезы, H спенд, I показы, J клики, K клики на ленд,
// L подписки, M диалоги, N регион.
function parseTraffic(values: unknown[][]): Gr4Row[] {
  const out: Gr4Row[] = [];
  for (const row of values) {
    const date = isoDate(row[0]);
    if (!date) continue;
    const r = blank({
      date, ...dims(row, 13),
      budget: num(row[7]), impressions: num(row[8]), adClicks: num(row[9]),
      websiteClicks: num(row[10]), registrations: num(row[11]), dialogs: num(row[12]),
    });
    if (hasAny(r, TRAFFIC)) out.push(r);
  }
  return out;
}

// «Депы»: A–G разрезы, H тип CPA/IB, I кол-во деп, J сумма деп,
// K кол-во выплат, L выплата, M регион. Доход = выплаты.
function parseDeps(values: unknown[][]): Gr4Row[] {
  const out: Gr4Row[] = [];
  for (const row of values) {
    const date = isoDate(row[0]);
    if (!date) continue;
    const ib = str(row[7]).toUpperCase() === "IB";
    const count = num(row[8]), amount = num(row[9]), payouts = num(row[10]), payout = num(row[11]);
    if (!count && !amount && !payouts && !payout) continue;
    out.push(blank({
      date, ...dims(row, 12),
      revenue: payout,
      ...(ib
        ? { depCountIb: count, depAmountIb: amount, payoutsIb: payouts, revenueIb: payout }
        : { depCountCpa: count, depAmountCpa: amount, payoutsCpa: payouts, revenueCpa: payout }),
    }));
  }
  return out;
}

// «CRM итоги»: A–F разрезы, G «добор CRM», H–K итоги и суммы баеров,
// L добор подписок, M добор диалогов, N регион. Берём только сам добор:
// сумма баеров уже пришла через «Трафик».
function parseCrm(values: unknown[][]): Gr4Row[] {
  const out: Gr4Row[] = [];
  for (const row of values) {
    const date = isoDate(row[0]);
    if (!date) continue;
    const subs = num(row[11]), dia = num(row[12]);
    if (!subs && !dia) continue;
    out.push(blank({ date, ...dims(row, 13), buyer: str(row[6]) || "добор CRM", registrations: subs, dialogs: dia }));
  }
  return out;
}

// Таблица баера, «Ввод» и «История»: A–G разрезы, H–M трафик как в «Трафике»,
// N депы из Torro, O доход из Torro, W регион. Депы баер не делит на CPA/IB —
// кладём их в CPA, чтобы CR в деп и CAC считались общими формулами.
function parseBuyerSheet(values: unknown[][]): Gr4Row[] {
  const out: Gr4Row[] = [];
  for (const row of values) {
    const date = isoDate(row[0]);
    if (!date) continue;
    const r = blank({
      date, ...dims(row, 22),
      budget: num(row[7]), impressions: num(row[8]), adClicks: num(row[9]),
      websiteClicks: num(row[10]), registrations: num(row[11]), dialogs: num(row[12]),
      depCountCpa: num(row[13]), revenue: num(row[14]),
    });
    if (hasAny(r, [...TRAFFIC, "depCountCpa", "revenue"])) out.push(r);
  }
  return out;
}

function parseTargets(values: unknown[][] | undefined): Gr4Targets {
  const at = (i: number) => {
    const v = values?.[i]?.[0];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  return { costPerSub: at(0), costPerDialog: at(1), crToDialog: at(2), crDialogToDep: at(3) };
}

// Листы и диапазоны, которые нужны каждому виду таблицы. Регион — последняя колонка.
export const MAIN_RANGES = {
  traffic: "'Трафик'!A2:N",
  deps: "'Депы'!A2:M",
  crm: "'CRM итоги'!A2:N",
  targets: "'Настройки'!E2:E5",
} as const;

export const BUYER_SHEETS = ["Ввод", "История"] as const;
export const BUYER_RANGE = (sheet: string) => `'${sheet}'!A2:W`;
export const BUYER_TARGETS = "'Настройки'!E2:E5";

export function parseMain(v: { traffic: unknown[][]; deps: unknown[][]; crm?: unknown[][]; targets?: unknown[][] }) {
  return {
    rows: [...parseTraffic(v.traffic), ...parseDeps(v.deps), ...parseCrm(v.crm ?? [])],
    targets: parseTargets(v.targets),
  };
}

export function parseBuyer(sheets: unknown[][][], targets?: unknown[][]) {
  return { rows: sheets.flatMap(parseBuyerSheet), targets: parseTargets(targets) };
}
