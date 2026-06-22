import type { FBItem, MVPItem, CheckRow } from "./types";
import {
  detectGeo, extractTitleMeta, priorityGeoOrder,
  formatMoney, formatMetric, formatBudget, normalizeSpaces,
} from "./parse";

// ─── Build check text ─────────────────────────────────────────────────────────

// Produces only the clean, copyable check text.
// FB-only rows (no MVP match) are included with sub/chat = 0 — spend always shown.
// MVP-only rows are excluded — they belong in the Несовпадения tab.
// No warnings or diagnostic headers.
export function buildCheckFromItems(fbItems: FBItem[], mvpItems: MVPItem[]): string {
  const mvpByTitle = new Map(mvpItems.map((x) => [x.normalizedTitle, x]));

  const grouped: Record<string, FBItem[]> = {};
  const firstSeenGeo: Record<string, number> = {};

  for (const item of fbItems) {
    const geo = detectGeo(item.title) ?? "Неизвестное гео";
    if (!(geo in firstSeenGeo)) firstSeenGeo[geo] = item.firstSeenIndex;
    (grouped[geo] ||= []).push(item);
  }

  const lines: string[] = [];
  for (const geo of priorityGeoOrder(grouped, firstSeenGeo)) {
    lines.push(geo, "");
    let totalSpend = 0, totalSub = 0, totalChat = 0;
    for (const item of grouped[geo].slice().sort((a, b) => a.title.localeCompare(b.title, "ru"))) {
      const mvp = mvpByTitle.get(item.normalizedTitle);
      const sub = mvp ? mvp.sub : 0;
      const chat = mvp ? mvp.chat : 0;
      totalSpend += item.spend;
      totalSub += sub;
      totalChat += chat;
      const titleLine = item.budget !== null ? `${item.title} [${formatBudget(item.budget)}]` : item.title;
      lines.push(titleLine);
      lines.push(`${formatMoney(item.spend)} / ${formatMetric(item.spend, sub)} / ${formatMetric(item.spend, chat)}`);
      lines.push("");
    }
    lines.push(`Общ.: ${formatMoney(totalSpend)} / ${formatMetric(totalSpend, totalSub)} / ${formatMetric(totalSpend, totalChat)}`, "");
  }
  return lines.join("\n").trimEnd();
}

// ─── Build rows ───────────────────────────────────────────────────────────────

export function buildRows(fbItems: FBItem[], mvpItems: MVPItem[], warnMvpOnly: boolean): CheckRow[] {
  const mvpByTitle = new Map(mvpItems.map((x) => [x.normalizedTitle, x]));
  const fbByTitle = new Map(fbItems.map((x) => [x.normalizedTitle, x]));
  const rows: CheckRow[] = [];

  for (const item of fbItems) {
    const mvp = mvpByTitle.get(item.normalizedTitle);
    const sub = mvp ? mvp.sub : 0;
    const chat = mvp ? mvp.chat : 0;
    const dep = mvp ? mvp.depSummary : 0;
    const redep = mvp ? mvp.redepSummary : 0;
    const meta = extractTitleMeta(item.title);
    rows.push({
      status: mvp ? "✅ OK" : "⚠️ Есть в ФБ, нет в MVP",
      title: item.title,
      geo: meta.geo,
      date: meta.date,
      cabinet: meta.cabinet,
      budget: item.budget !== null ? formatBudget(item.budget) : "",
      spend: item.spend,
      sub,
      chat,
      deposits: dep + redep,
      depSummary: dep,
      redepSummary: redep,
      websiteClicks: mvp ? mvp.websiteClicks : 0,
      costPerSub: sub ? item.spend / sub : null,
      costPerChat: chat ? item.spend / chat : null,
      fbClicks: item.clicks,
      views: item.views,
      fbRow: item.rowNumber,
      mvpRow: mvp ? mvp.rowNumber : null,
      inCheck: true,
    });
  }

  if (warnMvpOnly) {
    for (const item of mvpItems) {
      if (fbByTitle.has(item.normalizedTitle)) continue;
      const meta = extractTitleMeta(item.title);
      rows.push({
        status: "⚠️ Есть в MVP, нет в ФБ",
        title: item.title,
        geo: meta.geo,
        date: meta.date,
        cabinet: meta.cabinet,
        budget: "",
        spend: 0,
        sub: item.sub,
        chat: item.chat,
        deposits: item.depSummary + item.redepSummary,
        depSummary: item.depSummary,
        redepSummary: item.redepSummary,
        websiteClicks: item.websiteClicks,
        costPerSub: null,
        costPerChat: null,
        fbClicks: null,
        views: null,
        fbRow: null,
        mvpRow: item.rowNumber,
        inCheck: false,
      });
    }
  }
  return rows;
}

// ─── Filter / aggregate ───────────────────────────────────────────────────────

function tokenChar(ch: string): boolean {
  return /[0-9A-ZА-ЯЁ_-]/i.test(ch || "");
}

export function smartNameMatch(title: string, needle: string): boolean {
  const needleNorm = normalizeSpaces(needle).toUpperCase();
  const titleNorm = normalizeSpaces(title).toUpperCase();
  if (!needleNorm) return true;
  let start = 0;
  while (true) {
    const idx = titleNorm.indexOf(needleNorm, start);
    if (idx === -1) return false;
    const before = idx === 0 ? "" : titleNorm[idx - 1];
    const after = idx + needleNorm.length >= titleNorm.length ? "" : titleNorm[idx + needleNorm.length];
    if (!tokenChar(before) && !tokenChar(after)) return true;
    start = idx + Math.max(needleNorm.length, 1);
  }
}

export interface FilterOptions {
  rows: CheckRow[];
  searchText?: string;
  names?: string[];
  geos?: string[];
  dates?: string[];
  cabinets?: string[];
}

export function filterRows({ rows, searchText = "", names = [], geos = [], dates = [], cabinets = [] }: FilterOptions): CheckRow[] {
  const activeNames = [...names.map(normalizeSpaces).filter(Boolean)];
  if (searchText) activeNames.push(normalizeSpaces(searchText));
  return rows.filter((row) => {
    if (activeNames.length && !activeNames.some((n) => smartNameMatch(row.title, n))) return false;
    if (geos.length && !geos.includes(row.geo)) return false;
    if (dates.length && !dates.includes(row.date)) return false;
    if (cabinets.length && !cabinets.includes(row.cabinet)) return false;
    return true;
  });
}

export function sumField(
  rows: CheckRow[],
  field: keyof CheckRow,
  onlyNonNull = false
): number | null {
  let hasAny = false;
  const sum = rows.reduce((acc, row) => {
    const value = row[field];
    if (value === null || value === undefined || value === "") return acc;
    const n = Number(value);
    if (!Number.isFinite(n)) return acc;
    hasAny = true;
    return acc + n;
  }, 0);
  return onlyNonNull && !hasAny ? null : sum;
}

export function uniqueValues(rows: CheckRow[], field: keyof CheckRow): string[] {
  return [...new Set(rows.map((r) => String(r[field] ?? "")).filter((x) => x.trim() !== ""))].sort((a, b) =>
    a.localeCompare(b, "ru")
  );
}
