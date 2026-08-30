// Shared column resolution for the two ad-level CRM exports (by name, by Ad ID).
// The two spreadsheets are configured independently and their column ORDER can differ
// (confirmed live: the by-name sheet is Кол-во продаж→Сумма продаж→Кол-во повторных→Сумма
// повторных, the by-id sheet is Кол-во продаж→Кол-во повторных→Сумма продаж→Сумма повторных).
// Resolving by header text instead of a fixed index — same defense parseMvpXlsx.ts already
// uses for the campaign-level export — makes both immune to future reordering.

export type CrmColumnKey =
  | "clicks" | "pdp" | "dia" | "registrations"
  | "depCount" | "redepCount" | "depSummary" | "redepSummary"
  | "unsubscribes";

// Longest/most specific candidate first where one name is a superset-looking string of another
// ("повторных" variants must never be matched by the plain candidate).
const CANDIDATES: Record<CrmColumnKey, string> = {
  // Клик на лендинге, не клик по объявлению. Есть в дневной выгрузке по крео,
  // в дневной по кампаниям её нет — отсутствие даёт -1 и хранится как null,
  // потому что «не выгружали» и «ноль» это разные вещи.
  clicks: "клик",
  pdp: "подписчик",
  dia: "диалог",
  registrations: "кол-во регистраций",
  redepCount: "кол-во повторных",
  depCount: "кол-во продаж",
  redepSummary: "сумма повторных",
  depSummary: "сумма продаж",
  unsubscribes: "отписк",
};

export type CrmColumnMap = Record<CrmColumnKey, number>;

export function resolveCrmColumns(rawHeader: unknown[]): CrmColumnMap {
  const header = rawHeader.map((h) => String(h ?? "").trim().toLowerCase());
  const map = {} as CrmColumnMap;
  for (const key of Object.keys(CANDIDATES) as CrmColumnKey[]) {
    map[key] = header.findIndex((h) => h.includes(CANDIDATES[key]));
  }
  return map;
}

export function crmNum(v: unknown): number {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  const num = parseFloat(s);
  return Number.isFinite(num) ? num : 0;
}

export function crmAt(row: unknown[], col: CrmColumnMap, key: CrmColumnKey): number {
  const i = col[key];
  return i !== -1 ? crmNum(row[i]) : 0;
}
