import { QUAL_KEYS, type Gr4Row, type Gr4Targets } from "./types";

// Разбор листов GR 4.0. Значения приходят из Sheets API как UNFORMATTED_VALUE +
// SERIAL_NUMBER: числа — числами, даты — серийным номером дня.
//
// Колонки ищутся по ЗАГОЛОВКУ первой строки, а не по номеру: в таблицы вставляют
// колонки (так пришли квалы A–E), и разбор по номерам ломался бы молча — читал бы
// соседнюю колонку и показывал правдоподобную неверную цифру. Нет нужного заголовка —
// ноль в этой метрике; нет обязательного (дата, разрезы) — ошибка с текстом.

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
    qualA: 0, qualB: 0, qualC: 0, qualD: 0, qualE: 0,
    ...r,
  };
}

// Лист = шапка + строки. Колонка по одному из имён; -1 — нет такой.
function sheet(values: unknown[][], name: string, required: string[]) {
  const head = (values[0] ?? []).map(str);
  const at = (...names: string[]) => names.reduce((i, n) => (i >= 0 ? i : head.indexOf(n)), -1);
  const missing = required.filter((n) => head.indexOf(n) < 0);
  if (values.length > 1 && missing.length) throw new Error(`Лист «${name}»: нет колонок ${missing.join(", ")}`);
  return { rows: values.slice(1), at };
}

const DIM_HEADERS = ["Дата", "Лицо", "Язык", "Гео", "Источник", "Воронка", "Баер"];

function dimsOf(at: (...n: string[]) => number) {
  const [d, face, lang, geo, src, fun, buyer] = DIM_HEADERS.map((h) => at(h));
  const region = at("Регион (авто)", "Регион");
  return (row: unknown[]) => ({
    date: isoDate(row[d]),
    face: str(row[face]), lang: str(row[lang]), country: str(row[geo]),
    source: str(row[src]), funnel: str(row[fun]), buyer: str(row[buyer]),
    region: region >= 0 ? str(row[region]) : "",
  });
}

const val = (row: unknown[], i: number) => (i >= 0 ? num(row[i]) : 0);
const quals = (at: (...n: string[]) => number, prefix: string) =>
  (["A", "B", "C", "D", "E"] as const).map((x) => at(`${prefix}${x}`, `${prefix}${x} CRM`));
const qualFields = (row: unknown[], idx: number[]) =>
  Object.fromEntries(QUAL_KEYS.map((k, i) => [k, val(row, idx[i])])) as Pick<Gr4Row, (typeof QUAL_KEYS)[number]>;

const hasAny = (r: Gr4Row, keys: (keyof Gr4Row)[]) => keys.some((k) => r[k] !== 0);
const TRAFFIC: (keyof Gr4Row)[] = ["budget", "impressions", "adClicks", "websiteClicks", "registrations", "dialogs", ...QUAL_KEYS];

// «Трафик» (общая) и «Ввод»/«История» (баер) — одна раскладка: разрезы, трафик, квалы.
// У баера ещё депы и доход из Torro; депы он не делит на CPA/IB — кладём в CPA, чтобы
// CR в деп и CAC считались общими формулами.
function parseTrafficLike(values: unknown[][], name: string): Gr4Row[] {
  const { rows, at } = sheet(values, name, [...DIM_HEADERS, "Спенд"]);
  const dims = dimsOf(at);
  const [spend, impr, clicks, web, subs, dia] =
    ["Спенд", "Показы", "Клики", "Клики на ленд", "Подписки", "Диалоги"].map((h) => at(h));
  const q = quals(at, "Квал ");
  const deps = at("Депы (Torro)"), revenue = at("Доход (Torro)");
  const out: Gr4Row[] = [];
  for (const row of rows) {
    const d = dims(row);
    if (!d.date) continue;
    const r = blank({
      ...d, date: d.date,
      budget: val(row, spend), impressions: val(row, impr), adClicks: val(row, clicks),
      websiteClicks: val(row, web), registrations: val(row, subs), dialogs: val(row, dia),
      ...qualFields(row, q),
      depCountCpa: val(row, deps), revenue: val(row, revenue),
    });
    if (hasAny(r, [...TRAFFIC, "depCountCpa", "revenue"])) out.push(r);
  }
  return out;
}

// «Депы»: тип CPA/IB, кол-во и сумма депов, кол-во выплат, выплата. Доход = выплаты.
function parseDeps(values: unknown[][]): Gr4Row[] {
  const { rows, at } = sheet(values, "Депы", [...DIM_HEADERS, "Тип (CPA/IB)"]);
  const dims = dimsOf(at);
  const [type, cnt, sum, pays, pay] = ["Тип (CPA/IB)", "Кол-во деп", "Сумма деп", "Кол-во выплат", "Выплата"].map((h) => at(h));
  const out: Gr4Row[] = [];
  for (const row of rows) {
    const d = dims(row);
    if (!d.date) continue;
    const ib = str(row[type]).toUpperCase() === "IB";
    const count = val(row, cnt), amount = val(row, sum), payouts = val(row, pays), payout = val(row, pay);
    if (!count && !amount && !payouts && !payout) continue;
    out.push(blank({
      ...d, date: d.date, revenue: payout,
      ...(ib
        ? { depCountIb: count, depAmountIb: amount, payoutsIb: payouts, revenueIb: payout }
        : { depCountCpa: count, depAmountCpa: amount, payoutsCpa: payouts, revenueCpa: payout }),
    }));
  }
  return out;
}

// «CRM итоги»: берём только сам добор — сумма баеров уже пришла через «Трафик».
// Пустая строка-заготовка (без даты или без добора) пропускается.
function parseCrm(values: unknown[][]): Gr4Row[] {
  const { rows, at } = sheet(values, "CRM итоги", DIM_HEADERS.slice(0, 6));
  const dims = dimsOf(at);
  const subs = at("Добор подписок"), dia = at("Добор диалогов");
  const q = quals(at, "Добор ");
  const out: Gr4Row[] = [];
  for (const row of rows) {
    const d = dims(row);
    if (!d.date) continue;
    const r = blank({ ...d, date: d.date, buyer: d.buyer || "добор CRM",
      registrations: val(row, subs), dialogs: val(row, dia), ...qualFields(row, q) });
    if (hasAny(r, ["registrations", "dialogs", ...QUAL_KEYS])) out.push(r);
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

// Диапазоны — с шапкой и до колонки AF: запас под будущие колонки, Sheets всё равно
// отдаёт только заполненное.
export const MAIN_RANGES = {
  traffic: "'Трафик'!A1:AF",
  deps: "'Депы'!A1:AF",
  crm: "'CRM итоги'!A1:AF",
  targets: "'Настройки'!E2:E5",
} as const;

export const BUYER_SHEETS = ["Ввод", "История"] as const;
export const BUYER_RANGE = (sheet: string) => `'${sheet}'!A1:AF`;
export const BUYER_TARGETS = "'Настройки'!E2:E5";

export function parseMain(v: { traffic: unknown[][]; deps: unknown[][]; crm?: unknown[][]; targets?: unknown[][] }) {
  return {
    rows: [...parseTrafficLike(v.traffic, "Трафик"), ...parseDeps(v.deps), ...parseCrm(v.crm ?? [])],
    targets: parseTargets(v.targets),
  };
}

export function parseBuyer(sheets: unknown[][][], targets?: unknown[][]) {
  return { rows: sheets.flatMap((s, i) => parseTrafficLike(s, BUYER_SHEETS[i] ?? "Ввод")), targets: parseTargets(targets) };
}
