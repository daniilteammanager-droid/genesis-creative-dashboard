import type { Entity, EntityMode, FBItem, FBDetailedItem, MVPItem, ParseFBResult, ParseFBDetailedResult, SheetData } from "./types";

// ─── Geo constants ────────────────────────────────────────────────────────────

export const GEO_PRIORITY = ["Бельгия", "Чехия", "Испания"];

const ISO2_TO_RU: Record<string, string> = {
  "AD": "Андорра", "AE": "ОАЭ", "AF": "Афганистан", "AG": "Антигуа и Барбуда", "AL": "Албания",
  "AM": "Армения", "AO": "Ангола", "AR": "Аргентина", "AT": "Австрия", "AU": "Австралия",
  "AZ": "Азербайджан", "BA": "Босния и Герцеговина", "BB": "Барбадос", "BD": "Бангладеш",
  "BE": "Бельгия", "BF": "Буркина-Фасо", "BG": "Болгария", "BH": "Бахрейн", "BI": "Бурунди",
  "BJ": "Бенин", "BN": "Бруней", "BO": "Боливия", "BR": "Бразилия", "BS": "Багамы",
  "BT": "Бутан", "BW": "Ботсвана", "BY": "Беларусь", "BZ": "Белиз", "CA": "Канада",
  "CD": "ДР Конго", "CF": "ЦАР", "CG": "Республика Конго", "CH": "Швейцария",
  "CI": "Кот-д'Ивуар", "CL": "Чили", "CM": "Камерун", "CN": "Китай", "CO": "Колумбия",
  "CR": "Коста-Рика", "CU": "Куба", "CV": "Кабо-Верде", "CY": "Кипр", "CZ": "Чехия",
  "DE": "Германия", "DJ": "Джибути", "DK": "Дания", "DM": "Доминика",
  "DO": "Доминиканская Республика", "DZ": "Алжир", "EC": "Эквадор", "EE": "Эстония",
  "EG": "Египет", "ER": "Эритрея", "ES": "Испания", "ET": "Эфиопия", "FI": "Финляндия",
  "FJ": "Фиджи", "FM": "Микронезия", "FR": "Франция", "GA": "Габон", "GB": "Великобритания",
  "GD": "Гренада", "GE": "Грузия", "GH": "Гана", "GM": "Гамбия", "GN": "Гвинея",
  "GQ": "Экваториальная Гвинея", "GR": "Греция", "GT": "Гватемала", "GW": "Гвинея-Бисау",
  "GY": "Гайана", "HN": "Гондурас", "HR": "Хорватия", "HT": "Гаити", "HU": "Венгрия",
  "ID": "Индонезия", "IE": "Ирландия", "IL": "Израиль", "IN": "Индия", "IQ": "Ирак",
  "IR": "Иран", "IS": "Исландия", "IT": "Италия", "JM": "Ямайка", "JO": "Иордания",
  "JP": "Япония", "KE": "Кения", "KG": "Кыргызстан", "KH": "Камбоджа", "KI": "Кирибати",
  "KM": "Коморы", "KN": "Сент-Китс и Невис", "KP": "КНДР", "KR": "Южная Корея",
  "KW": "Кувейт", "KZ": "Казахстан", "LA": "Лаос", "LB": "Ливан", "LC": "Сент-Люсия",
  "LI": "Лихтенштейн", "LK": "Шри-Ланка", "LR": "Либерия", "LS": "Лесото", "LT": "Литва",
  "LU": "Люксембург", "LV": "Латвия", "LY": "Ливия", "MA": "Марокко", "MC": "Монако",
  "MD": "Молдова", "ME": "Черногория", "MG": "Мадагаскар", "MH": "Маршалловы Острова",
  "MK": "Северная Македония", "ML": "Мали", "MM": "Мьянма", "MN": "Монголия",
  "MR": "Мавритания", "MT": "Мальта", "MU": "Маврикий", "MV": "Мальдивы", "MW": "Малави",
  "MX": "Мексика", "MY": "Малайзия", "MZ": "Мозамбик", "NA": "Намибия", "NE": "Нигер",
  "NG": "Нигерия", "NI": "Никарагуа", "NL": "Нидерланды", "NO": "Норвегия", "NP": "Непал",
  "NR": "Науру", "NZ": "Новая Зеландия", "OM": "Оман", "PA": "Панама", "PE": "Перу",
  "PG": "Папуа — Новая Гвинея", "PH": "Филиппины", "PK": "Пакистан", "PL": "Польша",
  "PT": "Португалия", "PW": "Палау", "PY": "Парагвай", "QA": "Катар", "RO": "Румыния",
  "RS": "Сербия", "RU": "Россия", "RW": "Руанда", "SA": "Саудовская Аравия",
  "SB": "Соломоновы Острова", "SC": "Сейшелы", "SD": "Судан", "SE": "Швеция",
  "SG": "Сингапур", "SI": "Словения", "SK": "Словакия", "SL": "Сьерра-Леоне",
  "SM": "Сан-Марино", "SN": "Сенегал", "SO": "Сомали", "SR": "Суринам",
  "SS": "Южный Судан", "ST": "Сан-Томе и Принсипи", "SV": "Сальвадор", "SY": "Сирия",
  "SZ": "Эсватини", "TD": "Чад", "TG": "Того", "TH": "Таиланд", "TJ": "Таджикистан",
  "TL": "Восточный Тимор", "TM": "Туркменистан", "TN": "Тунис", "TO": "Тонга",
  "TR": "Турция", "TT": "Тринидад и Тобаго", "TV": "Тувалу", "TZ": "Танзания",
  "UA": "Украина", "UG": "Уганда", "US": "США", "UY": "Уругвай", "UZ": "Узбекистан",
  "VA": "Ватикан", "VC": "Сент-Винсент и Гренадины", "VE": "Венесуэла", "VN": "Вьетнам",
  "VU": "Вануату", "WS": "Самоа", "YE": "Йемен", "ZA": "ЮАР", "ZM": "Замбия", "ZW": "Зимбабве",
};

const GEO_ALIASES: Record<string, string> = {
  "SPAIN": "Испания", "GERM": "Германия", "GERMANY": "Германия",
  "NORW": "Норвегия", "NORWAY": "Норвегия", "POLAND": "Польша",
  "BELGIUM": "Бельгия", "CZECH": "Чехия", "CZECHIA": "Чехия",
  "KYRGYZSTAN": "Кыргызстан", "KYRGYZ": "Кыргызстан",
  ...ISO2_TO_RU,
};

// ─── Header aliases ───────────────────────────────────────────────────────────

const FB_CAMPAIGN_HEADERS = ["кампания", "название кампании", "campaign", "campaign name"];
const FB_AD_HEADERS = ["объявление", "название объявления", "ad", "ad name"];
const FB_SPEND_HEADERS = ["расход", "сумма затрат", "потраченная сумма", "amount spent", "amount spent (usd)", "spent", "spend"];
const FB_CLICK_HEADERS = ["клики", "клики (все)", "клики по ссылке", "link clicks", "clicks", "clicks (all)"];
const FB_VIEW_HEADERS = ["просмотры", "просмотры целевой страницы", "просмотры лендинга", "landing page views", "views", "показы", "impressions"];
const MVP_CAMPAIGN_HEADERS = ["name", "campaign", "campaign name", "кампания", "название кампании"];
const MVP_AD_HEADERS = ["name", "ad", "ad name", "объявление", "название объявления", "id", "ad id", "ad_id", "ид объявления", "id объявления", "идентификатор объявления"];
const MVP_AD_ID_HEADERS = ["ad id", "ad_id", "id объявления", "ид объявления", "идентификатор объявления", "id"];
const MVP_SUB_HEADERS = ["sub", "subs", "пдп", "подписки"];
const MVP_CHAT_HEADERS = ["chat", "chats", "диа", "диалоги"];
const MVP_DEP_SUMMARY_HEADERS = ["dep_summary", "dep summary", "deposit_summary", "deposits", "депозиты", "деп"];
const MVP_REDEP_SUMMARY_HEADERS = ["redep_summary", "redep summary", "redeposit_summary", "redeposits", "редепозиты", "редеп"];
const MVP_WEBSITE_CLICK_HEADERS = ["click", "website click", "website clicks", "клики на вебсайте", "клики на сайте"];

// ─── String helpers ───────────────────────────────────────────────────────────

export function normalizeSpaces(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeHeader(value: unknown): string {
  return normalizeSpaces(value).toLowerCase();
}

export function parseDecimal(
  value: unknown,
  { blankIsZero = false, field = "значение" } = {}
): number {
  if (value === null || value === undefined || normalizeSpaces(value) === "") {
    if (blankIsZero) return 0;
    throw new Error(`Пустое поле: ${field}`);
  }
  if (typeof value === "boolean") throw new Error(`Некорректное число в поле ${field}: ${value}`);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  let text = normalizeSpaces(value)
    .replace(/\$/g, "")
    .replace(/USD/gi, "")
    .replace(/\s/g, "");
  if (text.includes(",") && !text.includes(".")) text = text.replace(/,/g, ".");
  else if (text.includes(",") && text.includes(".")) text = text.replace(/,/g, "");

  const num = Number(text);
  if (!Number.isFinite(num)) throw new Error(`Не удалось прочитать число в поле ${field}: ${value}`);
  return num;
}

function ensureNonnegativeInteger(value: number, field: string, rowNumber: number): number {
  if (value < 0 || Math.round(value) !== value) {
    throw new Error(`${field} должен быть целым неотрицательным числом, строка ${rowNumber}: ${value}`);
  }
  return value;
}

// ─── Format helpers (exported for UI use) ────────────────────────────────────

export function formatMoney(value: number): string {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  return `$${rounded.toFixed(2)}`;
}

export function formatMetric(spend: number, count: number): string {
  return !count ? "0" : formatMoney(spend / count);
}

export function formatPlainNumber(value: unknown): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function formatBudget(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return `${Number.isInteger(n) ? n.toFixed(0) : String(Number(n.toFixed(2))).replace(/\.0+$/, "")}$`;
}

// ─── Geo detection ────────────────────────────────────────────────────────────

export function detectGeo(title: string): string | null {
  const normalized = normalizeSpaces(title).toUpperCase();
  const words = normalized.match(/[A-Z]{2,}/g) || [];
  for (const token of words) {
    if (token.length > 2 && GEO_ALIASES[token]) return GEO_ALIASES[token];
  }
  for (const token of words) {
    if (GEO_ALIASES[token]) return GEO_ALIASES[token];
  }
  return null;
}

export function extractTitleMeta(title: string): { date: string; geo: string; edit: string; cabinet: string } {
  const parts = normalizeSpaces(title).split(/\s+-\s+/).filter(Boolean);
  let dateValue = "";
  for (const part of parts) {
    const m = part.match(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/);
    if (m) { dateValue = m[0]; break; }
  }
  let editValue = "";
  for (const part of parts) {
    const m = part.match(/\bEDIT\s*\d+\b/i);
    if (m) { editValue = m[0].replace(/\s+/g, "").toUpperCase(); break; }
  }
  let cabinetValue = "";
  for (const part of parts) {
    const m = part.match(/\b\d*T\d+A\b/i);
    if (m) { cabinetValue = m[0].toUpperCase(); break; }
  }
  return { date: dateValue, geo: detectGeo(title) || "Неизвестное гео", edit: editValue, cabinet: cabinetValue };
}

export function priorityGeoOrder(
  grouped: Record<string, unknown[]>,
  firstSeenGeo: Record<string, number>
): string[] {
  const priorityIndex = new Map(GEO_PRIORITY.map((geo, idx) => [geo, idx]));
  return Object.keys(grouped).sort((a, b) => {
    const ap = priorityIndex.has(a), bp = priorityIndex.has(b);
    if (ap && bp) return priorityIndex.get(a)! - priorityIndex.get(b)!;
    if (ap) return -1;
    if (bp) return 1;
    return (firstSeenGeo[a] ?? 999999) - (firstSeenGeo[b] ?? 999999);
  });
}

// ─── Sheet/header utilities ───────────────────────────────────────────────────

function rowHeaderPositions(row: unknown[]): Map<string, number> {
  const headers = new Map<string, number>();
  (row || []).forEach((value, idx) => {
    const key = normalizeHeader(value);
    if (key && !headers.has(key)) headers.set(key, idx);
  });
  return headers;
}

function resolveCol(headers: Map<string, number>, aliases: string[]): number | null {
  for (const alias of aliases.map(normalizeHeader)) {
    if (headers.has(alias)) return headers.get(alias)!;
  }
  return null;
}

interface NameCandidate { entity: Entity; headers: string[] }
interface FindTableResult {
  rows: unknown[][];
  headerIdx: number;
  headers: Map<string, number>;
  nameCol: number;
  chosenIdx: number;
}

function findTableHeader(
  sheets: SheetData[],
  {
    nameCandidates,
    requiredCandidates,
    scanLimit = 15,
    fileLabel = "файл",
  }: {
    nameCandidates: NameCandidate[];
    requiredCandidates: string[][];
    scanLimit?: number;
    fileLabel?: string;
  }
): FindTableResult {
  for (const { rows } of sheets) {
    for (let idx = 0; idx < Math.min(scanLimit, rows.length); idx++) {
      const row = rows[idx] || [];
      const headers = rowHeaderPositions(row);
      const requiredOk = requiredCandidates.every((aliases) => resolveCol(headers, aliases) !== null);
      if (!requiredOk) continue;
      for (let c = 0; c < nameCandidates.length; c++) {
        const nameCol = resolveCol(headers, nameCandidates[c].headers);
        if (nameCol !== null) return { rows, headerIdx: idx, headers, nameCol, chosenIdx: c };
      }
    }
  }
  const required = requiredCandidates.map((x) => x.join("/")).join(", ");
  const names = nameCandidates.map((x) => x.headers.join("/")).join(", ");
  throw new Error(
    `В ${fileLabel} не найдена строка заголовков. Нужны колонки имени (${names}) и колонки: ${required}`
  );
}

function cellVal(row: unknown[], index: number | null): unknown {
  if (index === null || index === undefined || index >= row.length) return null;
  return row[index];
}

function extractObjectId(value: unknown): string {
  const text = normalizeSpaces(value);
  if (!text) return "";
  const inParens = text.match(/\((\d{8,})\)/);
  if (inParens) return inParens[1];
  const plain = text.match(/\b\d{8,}\b/);
  return plain ? plain[0] : "";
}

function entityNameCandidates(entity: EntityMode, source: "fb" | "mvp"): NameCandidate[] {
  const campaignHeaders = source === "fb" ? FB_CAMPAIGN_HEADERS : MVP_CAMPAIGN_HEADERS;
  const adHeaders = source === "fb" ? FB_AD_HEADERS : MVP_AD_HEADERS;
  if (entity === "campaign") return [{ entity: "campaign", headers: campaignHeaders }];
  if (entity === "ad") return [{ entity: "ad", headers: adHeaders }];
  return [{ entity: "ad", headers: adHeaders }, { entity: "campaign", headers: campaignHeaders }];
}

function stripFbNameTail(rawValue: unknown): { title: string; budget: number | null } {
  const raw = normalizeSpaces(rawValue);
  // Strip only the real FB service tail: "(<8+ digit ad/campaign id>)<STATUS>    Дневной бюджет ... USD".
  // The 8+ digit threshold matches extractObjectId()'s own convention for a real FB id below,
  // so a plain duplicate tail like (2) or (3) — never 8+ digits — is never touched.
  // Campaign and Campaign (2) must remain distinct across matching, filters, and summaries.
  const title = raw
    .replace(/\s*\(\d{8,}\)[A-ZА-ЯЁ_]*\s*(?:Дневной\s+бюджет\s+(?:кампании|объявления)?\s*-\s*[\d\s.,]+\s*USD)?\s*$/i, "")
    .trim();
  const match = raw.match(/Дневной\s+бюджет\s+(?:кампании|объявления)?\s*-\s*([\d\s.,]+)\s*USD/i);
  const budget = match ? parseDecimal(match[1], { field: "дневной бюджет" }) : null;
  return { title, budget };
}

// ─── parseFB ─────────────────────────────────────────────────────────────────

export function parseFB(
  sheets: SheetData[],
  { entity = "auto" as EntityMode, includeZeroSpend = false } = {}
): ParseFBResult {
  const nameOptions = entityNameCandidates(entity, "fb");
  const found = findTableHeader(sheets, {
    nameCandidates: nameOptions,
    requiredCandidates: [FB_SPEND_HEADERS],
    fileLabel: "FB-файле",
  });
  const resolvedEntity = nameOptions[found.chosenIdx].entity;
  const spendCol = resolveCol(found.headers, FB_SPEND_HEADERS);
  const clickCol = resolveCol(found.headers, FB_CLICK_HEADERS);
  const viewCol = resolveCol(found.headers, FB_VIEW_HEADERS);

  if (spendCol === null) throw new Error("В FB-файле не найдена колонка расхода");

  const output: FBItem[] = [];
  let seenIndex = 0;
  for (let i = found.headerIdx + 1; i < found.rows.length; i++) {
    const excelRow = i + 1;
    const row = found.rows[i] || [];
    const rawName = cellVal(row, found.nameCol);
    if (rawName === null || normalizeSpaces(rawName) === "") continue;
    const { title, budget } = stripFbNameTail(rawName);
    if (!title) continue;
    const spend = parseDecimal(cellVal(row, spendCol), { blankIsZero: true, field: `Расход, строка ${excelRow}` });
    if (spend === 0 && !includeZeroSpend) continue;
    const clicks = clickCol !== null
      ? parseDecimal(cellVal(row, clickCol), { blankIsZero: true, field: `Клики, строка ${excelRow}` })
      : null;
    const views = viewCol !== null
      ? parseDecimal(cellVal(row, viewCol), { blankIsZero: true, field: `Просмотры, строка ${excelRow}` })
      : null;
    output.push({ title, normalizedTitle: normalizeSpaces(title), spend, budget, rowNumber: excelRow, firstSeenIndex: seenIndex, clicks, views });
    seenIndex++;
  }
  return { items: output, resolvedEntity };
}

// ─── parseMVP ────────────────────────────────────────────────────────────────

export function parseMVP(sheets: SheetData[], { entity }: { entity: Entity }): MVPItem[] {
  const nameOptions = entityNameCandidates(entity, "mvp");
  const found = findTableHeader(sheets, {
    nameCandidates: nameOptions,
    requiredCandidates: [MVP_SUB_HEADERS, MVP_CHAT_HEADERS],
    fileLabel: "MVP-файле",
  });
  const subCol = resolveCol(found.headers, MVP_SUB_HEADERS);
  const chatCol = resolveCol(found.headers, MVP_CHAT_HEADERS);
  const depCol = resolveCol(found.headers, MVP_DEP_SUMMARY_HEADERS);
  const redepCol = resolveCol(found.headers, MVP_REDEP_SUMMARY_HEADERS);
  const websiteClickCol = resolveCol(found.headers, MVP_WEBSITE_CLICK_HEADERS);
  const idCol = entity === "ad" ? resolveCol(found.headers, MVP_AD_ID_HEADERS) : null;

  if (subCol === null || chatCol === null) throw new Error("В MVP-файле не найдены колонки sub/chat");

  const output: MVPItem[] = [];
  for (let i = found.headerIdx + 1; i < found.rows.length; i++) {
    const excelRow = i + 1;
    const row = found.rows[i] || [];
    const rawTitle = cellVal(row, found.nameCol);
    const sub = ensureNonnegativeInteger(
      parseDecimal(cellVal(row, subCol), { blankIsZero: true, field: `sub, строка ${excelRow}` }),
      "sub", excelRow
    );
    const chat = ensureNonnegativeInteger(
      parseDecimal(cellVal(row, chatCol), { blankIsZero: true, field: `chat, строка ${excelRow}` }),
      "chat", excelRow
    );
    const depSummary = depCol !== null
      ? parseDecimal(cellVal(row, depCol), { blankIsZero: true, field: `dep_summary, строка ${excelRow}` })
      : 0;
    const redepSummary = redepCol !== null
      ? parseDecimal(cellVal(row, redepCol), { blankIsZero: true, field: `redep_summary, строка ${excelRow}` })
      : 0;
    const websiteClicks = websiteClickCol !== null
      ? ensureNonnegativeInteger(
          parseDecimal(cellVal(row, websiteClickCol), { blankIsZero: true, field: `click, строка ${excelRow}` }),
          "click", excelRow
        )
      : 0;
    const hasMetric = sub || chat || depSummary || redepSummary || websiteClicks;
    if ((rawTitle === null || normalizeSpaces(rawTitle) === "") && !hasMetric) continue;

    const title = rawTitle === null || normalizeSpaces(rawTitle) === ""
      ? `Без ID / пустая строка MVP #${excelRow}`
      : String(rawTitle).trim();
    const rawId = idCol !== null ? cellVal(row, idCol) : rawTitle;
    const adId = entity === "ad" ? extractObjectId(rawId) : "";
    output.push({
      title,
      normalizedTitle: normalizeSpaces(title),
      adId,
      geo: detectGeo(title) || "",
      sub,
      chat,
      rowNumber: excelRow,
      depSummary,
      redepSummary,
      websiteClicks,
    });
  }
  return output;
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

export function aggregateFBItems(items: FBItem[]): FBItem[] {
  const grouped = new Map<string, FBItem>();
  for (const item of items) {
    if (!grouped.has(item.normalizedTitle)) {
      grouped.set(item.normalizedTitle, { ...item });
      continue;
    }
    const b = grouped.get(item.normalizedTitle)!;
    b.spend += item.spend;
    b.firstSeenIndex = Math.min(b.firstSeenIndex, item.firstSeenIndex);
    b.rowNumber = Math.min(b.rowNumber, item.rowNumber);
    if (b.budget === null && item.budget !== null) b.budget = item.budget;
    if (b.clicks === null && item.clicks !== null) b.clicks = item.clicks;
    else if (b.clicks !== null && item.clicks !== null) b.clicks += item.clicks;
    if (b.views === null && item.views !== null) b.views = item.views;
    else if (b.views !== null && item.views !== null) b.views += item.views;
  }
  return Array.from(grouped.values()).sort((a, b) => a.firstSeenIndex - b.firstSeenIndex);
}

// ─── Additional FB header aliases (for detailed ad parsing) ──────────────────

const FB_STATUS_HEADERS = ["статус", "статус показа", "показ", "доставка", "результативность", "status", "delivery", "ad delivery", "campaign delivery", "serving status"];
const FB_AD_STATUS_HEADERS = ["статус объявления", "статус объявлений", "ad status", "delivery status"];
const FB_ACCOUNT_STATUS_HEADERS = ["статус кабинета", "статус аккаунта", "статус рекламного аккаунта", "ad account status", "account status", "billing status", "payment status"];
const FB_ID_HEADERS = ["id", "идентификатор", "campaign id", "ad id", "идентификатор кампании", "идентификатор объявления"];

// ─── Creative label extraction ────────────────────────────────────────────────

function stripCreativeGeoSuffix(value: string): string {
  const clean = normalizeSpaces(value);
  if (!clean) return "";
  return clean.replace(/[-_](?:eng|en|de|es|pl|be|cz|it|fr|pt|nl|no|norw|germ|germany|spain|poland|belgium|czech|czechia|[a-z]{2})$/i, "");
}

export function extractCreativeLabel(title: string): string {
  const clean = stripCreativeGeoSuffix(title);
  if (!clean) return "Без названия крео";
  const edit = clean.match(/\bEDIT\s*\d+\b/i);
  if (edit) return edit[0].replace(/\s+/g, "").toUpperCase();
  const staticName = clean.match(/\b(?:STATIC|STAT|VIDEO|VID|IMG|IMAGE|CREO|CREATIVE|КРЕО)\s*\d*[A-ZА-Я0-9_-]*\b/i);
  if (staticName) return stripCreativeGeoSuffix(normalizeSpaces(staticName[0])).toUpperCase();
  const parts = clean.split(/\s+-\s+/).filter(Boolean);
  const candidate = parts.find((part) => /(?:EDIT|STATIC|VIDEO|IMG|CREO|КРЕО|A\d+|P\d+)/i.test(part));
  if (candidate) {
    const base = stripCreativeGeoSuffix(candidate);
    return base.length > 44 ? base.slice(0, 44) + "…" : base;
  }
  return clean.length > 54 ? clean.slice(0, 54) + "…" : clean;
}

// ─── parseFBDetailed ──────────────────────────────────────────────────────────

export function parseFBDetailed(
  sheets: SheetData[],
  { entity = "auto" as EntityMode, includeZeroSpend = true, fileLabel = "FB-файле объявлений" } = {}
): ParseFBDetailedResult {
  const nameOptions = entityNameCandidates(entity, "fb");
  const found = findTableHeader(sheets, {
    nameCandidates: nameOptions,
    requiredCandidates: [FB_SPEND_HEADERS],
    fileLabel,
  });
  const resolvedEntity = nameOptions[found.chosenIdx].entity;
  const spendCol = resolveCol(found.headers, FB_SPEND_HEADERS);
  const clickCol = resolveCol(found.headers, FB_CLICK_HEADERS);
  const viewCol = resolveCol(found.headers, FB_VIEW_HEADERS);
  const statusCol = resolveCol(found.headers, FB_STATUS_HEADERS);
  const adStatusCol = resolveCol(found.headers, FB_AD_STATUS_HEADERS);
  const accountStatusCol = resolveCol(found.headers, FB_ACCOUNT_STATUS_HEADERS);
  const campaignCol = resolveCol(found.headers, FB_CAMPAIGN_HEADERS);
  const adCol = resolveCol(found.headers, FB_AD_HEADERS);
  const idCol = resolveCol(found.headers, FB_ID_HEADERS);

  if (spendCol === null) throw new Error(`В ${fileLabel} не найдена колонка расхода`);

  const output: FBDetailedItem[] = [];
  let seenIndex = 0;
  for (let i = found.headerIdx + 1; i < found.rows.length; i++) {
    const excelRow = i + 1;
    const row = found.rows[i] || [];
    const rawName = cellVal(row, found.nameCol);
    if (rawName === null || normalizeSpaces(rawName) === "") continue;

    const { title, budget } = stripFbNameTail(rawName);
    if (!title) continue;
    const spend = parseDecimal(cellVal(row, spendCol), { blankIsZero: true, field: `Расход, строка ${excelRow}` });
    if (spend === 0 && !includeZeroSpend) continue;

    let campaignTitle = "";
    let campaignNormalizedTitle = "";
    let campaignRawValue: unknown = null;
    if (campaignCol !== null) {
      campaignRawValue = cellVal(row, campaignCol);
      if (campaignRawValue !== null && normalizeSpaces(campaignRawValue) !== "") {
        const parsed = stripFbNameTail(campaignRawValue);
        campaignTitle = parsed.title;
        campaignNormalizedTitle = normalizeSpaces(parsed.title);
      }
    }
    if (resolvedEntity === "campaign") {
      campaignTitle = title;
      campaignNormalizedTitle = normalizeSpaces(title);
    }

    let adTitle = "";
    let adNormalizedTitle = "";
    let adRawValue: unknown = null;
    if (adCol !== null) {
      adRawValue = cellVal(row, adCol);
      if (adRawValue !== null && normalizeSpaces(adRawValue) !== "") {
        const parsed = stripFbNameTail(adRawValue);
        adTitle = parsed.title;
        adNormalizedTitle = normalizeSpaces(parsed.title);
      }
    }
    if (resolvedEntity === "ad") {
      adTitle = title;
      adNormalizedTitle = normalizeSpaces(title);
    }

    const titleForMeta = campaignTitle || title;
    const meta = extractTitleMeta(titleForMeta);
    const rawIdValue = idCol !== null ? cellVal(row, idCol) : null;
    const adId =
      extractObjectId(adRawValue) ||
      (resolvedEntity === "ad" ? extractObjectId(rawName) : "") ||
      extractObjectId(rawIdValue);
    const campaignId = extractObjectId(campaignRawValue);

    output.push({
      title,
      normalizedTitle: normalizeSpaces(title),
      entity: resolvedEntity,
      campaignTitle,
      campaignNormalizedTitle,
      adTitle,
      adNormalizedTitle,
      creative: extractCreativeLabel(adTitle || title),
      geo: meta.geo,
      date: meta.date,
      cabinet: meta.cabinet,
      spend,
      budget,
      clicks: clickCol !== null
        ? parseDecimal(cellVal(row, clickCol), { blankIsZero: true, field: `Клики, строка ${excelRow}` })
        : null,
      views: viewCol !== null
        ? parseDecimal(cellVal(row, viewCol), { blankIsZero: true, field: `Просмотры, строка ${excelRow}` })
        : null,
      status: statusCol !== null ? normalizeSpaces(cellVal(row, statusCol)) : "",
      adStatus: adStatusCol !== null ? normalizeSpaces(cellVal(row, adStatusCol)) : "",
      accountStatus: accountStatusCol !== null ? normalizeSpaces(cellVal(row, accountStatusCol)) : "",
      rawId: idCol !== null ? normalizeSpaces(cellVal(row, idCol)) : "",
      adId,
      campaignId,
      rowNumber: excelRow,
      firstSeenIndex: seenIndex,
    });
    seenIndex++;
  }
  return { items: output, resolvedEntity };
}

export function aggregateMVPItems(
  items: MVPItem[],
  keyFn: (item: MVPItem) => string = (item) => item.normalizedTitle
): MVPItem[] {
  const grouped = new Map<string, MVPItem>();
  for (const item of items) {
    const key = keyFn(item);
    if (!grouped.has(key)) {
      grouped.set(key, { ...item });
      continue;
    }
    const b = grouped.get(key)!;
    b.sub += item.sub;
    b.chat += item.chat;
    b.rowNumber = Math.min(b.rowNumber, item.rowNumber);
    b.depSummary += item.depSummary;
    b.redepSummary += item.redepSummary;
    b.websiteClicks += item.websiteClicks;
    if (!b.geo && item.geo) b.geo = item.geo;
    if (!b.adId && item.adId) b.adId = item.adId;
  }
  return Array.from(grouped.values());
}
