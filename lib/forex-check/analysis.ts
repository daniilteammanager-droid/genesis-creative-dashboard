import type {
  FBItem, MVPItem, CheckRow,
  FBDetailedItem, CreativeSummaryRow, CreativeDetailRow, LinkRow, CreativeAnalysis,
} from "./types";
import {
  detectGeo, extractTitleMeta, priorityGeoOrder,
  formatMoney, formatMetric, formatBudget, normalizeSpaces,
  aggregateMVPItems,
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

// ─── Creative analysis ────────────────────────────────────────────────────────

export function aggregateFBDetailed(
  items: FBDetailedItem[],
  keyFn: (item: FBDetailedItem) => string
): FBDetailedItem[] {
  const grouped = new Map<string, FBDetailedItem>();
  for (const item of items) {
    const key = keyFn(item);
    if (!grouped.has(key)) {
      grouped.set(key, { ...item });
      continue;
    }
    const b = grouped.get(key)!;
    b.spend += item.spend;
    b.firstSeenIndex = Math.min(b.firstSeenIndex, item.firstSeenIndex);
    b.rowNumber = Math.min(b.rowNumber, item.rowNumber);
    if (!b.status && item.status) b.status = item.status;
    if (b.budget === null && item.budget !== null) b.budget = item.budget;
    if (b.clicks === null && item.clicks !== null) b.clicks = item.clicks;
    else if (b.clicks !== null && item.clicks !== null) b.clicks += item.clicks;
    if (b.views === null && item.views !== null) b.views = item.views;
    else if (b.views !== null && item.views !== null) b.views += item.views;
  }
  return Array.from(grouped.values()).sort((a, b) => a.firstSeenIndex - b.firstSeenIndex);
}

function mvpMetricKey(item: MVPItem): string {
  return item.adId ? `mvp_ad_id::${item.adId}` : `mvp_ad_title::${item.normalizedTitle}`;
}

function metricStatusLabel(matchType: string): string {
  if (matchType === "mvp_ad_id") return "✅ Найдено в MVP объявлениях по ID";
  if (matchType === "mvp_ad") return "✅ Найдено в MVP объявлениях по названию";
  if (matchType === "check_ad") return "⚠️ Метрики из основного чека: объявление";
  if (matchType === "check_campaign") return "⚠️ Метрики из основного чека: кампания";
  return "⚠️ Нет в MVP объявлениях";
}

function metricSourceLabel(matchType: string): string {
  if (matchType === "mvp_ad_id") return "MVP объявления: ID";
  if (matchType === "mvp_ad") return "MVP объявления: название";
  if (matchType === "check_ad") return "основной чек: объявление";
  if (matchType === "check_campaign") return "основной чек: кампания";
  return "—";
}

interface MetricMatch {
  key: string;
  matchType: string;
  sub: number;
  chat: number;
  deposits: number;
  websiteClicks: number;
  mvpRow: number | null;
  mvpId: string;
}

interface SummaryBucket {
  geo: string;
  creative: string;
  spendTotal: number;
  fbClicks: number;
  views: number;
  websiteClicks: number;
  sub: number;
  chat: number;
  deposits: number;
  adsCount: number;
  campaigns: Set<string>;
  adNamesSet: Set<string>;
  _metricKeys: Set<string>;
}

interface DetailBucket extends SummaryBucket {
  adName: string;
}

export function buildAdCreativeAnalysis({
  adItemsRaw,
  mvpAdItemsRaw,
  metricRows,
}: {
  adItemsRaw: FBDetailedItem[];
  mvpAdItemsRaw: MVPItem[];
  metricRows: CheckRow[];
}): CreativeAnalysis {
  const adItems = aggregateFBDetailed(
    adItemsRaw,
    (x) => `${x.campaignNormalizedTitle || "_NO_CAMPAIGN_"}||${x.adId || x.normalizedTitle}`
  );

  const mvpAdItems = aggregateMVPItems(
    mvpAdItemsRaw,
    (item) => (item.adId ? `id:${item.adId}` : `title:${item.normalizedTitle}`)
  );

  const hasMvpAdSource = mvpAdItems.length > 0;
  const mvpHasIds = mvpAdItems.some((item) => item.adId);

  const mvpByAdId = new Map<string, MVPItem[]>();
  const mvpByAdTitle = new Map<string, MVPItem[]>();
  for (const item of mvpAdItems) {
    if (item.adId) {
      if (!mvpByAdId.has(item.adId)) mvpByAdId.set(item.adId, []);
      mvpByAdId.get(item.adId)!.push(item);
    }
    if (!mvpByAdTitle.has(item.normalizedTitle)) mvpByAdTitle.set(item.normalizedTitle, []);
    mvpByAdTitle.get(item.normalizedTitle)!.push(item);
  }

  const metricByTitle = new Map(metricRows.map((row) => [normalizeSpaces(row.title), row]));

  const metricForAd = (ad: FBDetailedItem): MetricMatch => {
    const candidates = mvpHasIds
      ? (ad.adId ? (mvpByAdId.get(ad.adId) || []) : [])
      : (ad.adNormalizedTitle ? (mvpByAdTitle.get(ad.adNormalizedTitle) || []) : []);

    if (hasMvpAdSource) {
      if (!candidates.length) {
        return { key: "", matchType: "", sub: 0, chat: 0, deposits: 0, websiteClicks: 0, mvpRow: null, mvpId: "" };
      }
      const mvpAd = candidates[0];
      return {
        key: mvpMetricKey(mvpAd),
        matchType: mvpAd.adId ? "mvp_ad_id" : "mvp_ad",
        sub: Number(mvpAd.sub || 0),
        chat: Number(mvpAd.chat || 0),
        deposits: Number(mvpAd.depSummary || 0) + Number(mvpAd.redepSummary || 0),
        websiteClicks: Number(mvpAd.websiteClicks || 0),
        mvpRow: mvpAd.rowNumber,
        mvpId: mvpAd.adId || "",
      };
    }

    // Fallback: use main check rows
    const adMetric = ad.adNormalizedTitle ? metricByTitle.get(ad.adNormalizedTitle) : null;
    const campaignMetric = ad.campaignNormalizedTitle ? metricByTitle.get(ad.campaignNormalizedTitle) : null;
    const row = adMetric || campaignMetric || null;
    if (!row) {
      return { key: "", matchType: "", sub: 0, chat: 0, deposits: 0, websiteClicks: 0, mvpRow: null, mvpId: "" };
    }
    return {
      key: `check::${normalizeSpaces(row.title)}`,
      matchType: adMetric ? "check_ad" : "check_campaign",
      sub: Number(row.sub || 0),
      chat: Number(row.chat || 0),
      deposits: Number(row.deposits || 0),
      websiteClicks: Number(row.websiteClicks || 0),
      mvpRow: row.mvpRow || null,
      mvpId: "",
    };
  };

  // Build link rows
  const linkRows: LinkRow[] = adItems.map((ad) => {
    const metric = metricForAd(ad);
    return {
      linkStatus: metricStatusLabel(metric.matchType),
      geo: ad.geo,
      creative: ad.creative,
      adTitle: ad.adTitle || ad.title,
      adId: ad.adId || "—",
      mvpId: metric.mvpId || "—",
      campaign: ad.campaignTitle || "—",
      spendAd: ad.spend,
      adStatus: ad.adStatus || ad.status || "—",
      accountStatus: ad.accountStatus || "—",
      date: ad.date,
      cabinet: ad.cabinet,
      fbClicks: ad.clicks,
      views: ad.views,
      websiteClicks: metric.websiteClicks,
      sub: metric.sub,
      chat: metric.chat,
      deposits: metric.deposits,
      costPerSub: metric.sub ? ad.spend / metric.sub : null,
      costPerChat: metric.chat ? ad.spend / metric.chat : null,
      metricsFrom: metricSourceLabel(metric.matchType),
      fbAdRow: ad.rowNumber,
      mvpAdRow: metric.mvpRow,
      _geo: ad.geo,
      _creative: ad.creative,
      _metricKey: metric.key,
    };
  });

  // Add unmatched MVP ad items
  const matchedMvpKeys = new Set(linkRows.map((r) => r._metricKey).filter(Boolean));
  const unmatchedMvpAdItems = hasMvpAdSource
    ? mvpAdItems.filter(
        (item) =>
          !matchedMvpKeys.has(mvpMetricKey(item)) &&
          (item.sub || item.chat || item.depSummary || item.redepSummary || item.websiteClicks)
      )
    : [];

  for (const item of unmatchedMvpAdItems) {
    const deposits = Number(item.depSummary || 0) + Number(item.redepSummary || 0);
    linkRows.push({
      linkStatus: "⚠️ Есть в MVP объявлениях, но нет в FB объявлениях",
      geo: "⚠️ Не сопоставлено",
      creative: "Без FB объявления",
      adTitle: item.title || "Без ID / пустая строка MVP",
      adId: "—",
      mvpId: item.adId || "—",
      campaign: "—",
      spendAd: 0,
      adStatus: "—",
      accountStatus: "—",
      date: "",
      cabinet: "",
      fbClicks: null,
      views: null,
      websiteClicks: Number(item.websiteClicks || 0),
      sub: Number(item.sub || 0),
      chat: Number(item.chat || 0),
      deposits,
      costPerSub: null,
      costPerChat: null,
      metricsFrom: "MVP объявления: не сопоставлено",
      fbAdRow: null,
      mvpAdRow: item.rowNumber,
      _geo: "⚠️ Не сопоставлено",
      _creative: "Без FB объявления",
      _metricKey: mvpMetricKey(item),
    });
  }

  // Build summary and detail buckets
  const grouped = new Map<string, SummaryBucket>();
  const nameGrouped = new Map<string, DetailBucket>();

  for (const ad of adItems) {
    const metric = metricForAd(ad);
    const variant = ad.adTitle || ad.title || "Без названия объявления";
    const key = `${ad.geo}||${ad.creative}`;
    const nameKey = `${ad.geo}||${ad.creative}||${variant}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        geo: ad.geo, creative: ad.creative,
        spendTotal: 0, fbClicks: 0, views: 0, websiteClicks: 0,
        sub: 0, chat: 0, deposits: 0, adsCount: 0,
        campaigns: new Set(), adNamesSet: new Set(), _metricKeys: new Set(),
      });
    }
    if (!nameGrouped.has(nameKey)) {
      nameGrouped.set(nameKey, {
        geo: ad.geo, creative: ad.creative, adName: variant,
        spendTotal: 0, fbClicks: 0, views: 0, websiteClicks: 0,
        sub: 0, chat: 0, deposits: 0, adsCount: 0,
        campaigns: new Set(), adNamesSet: new Set(), _metricKeys: new Set(),
      });
    }

    for (const bucket of [grouped.get(key)!, nameGrouped.get(nameKey)!]) {
      bucket.spendTotal += ad.spend;
      bucket.adsCount += 1;
      if (ad.campaignTitle) bucket.campaigns.add(ad.campaignTitle);
      bucket.adNamesSet.add(variant);
      if (ad.clicks !== null) bucket.fbClicks += Number(ad.clicks || 0);
      if (ad.views !== null) bucket.views += Number(ad.views || 0);
      if (metric.key && !bucket._metricKeys.has(metric.key)) {
        bucket._metricKeys.add(metric.key);
        bucket.sub += metric.sub;
        bucket.chat += metric.chat;
        bucket.deposits += metric.deposits;
        bucket.websiteClicks += metric.websiteClicks;
      }
    }
  }

  // Add unmatched MVP items to summary
  if (unmatchedMvpAdItems.length) {
    const uGeo = "⚠️ Не сопоставлено";
    const uCreative = "Без FB объявления";
    const uKey = `${uGeo}||${uCreative}`;
    if (!grouped.has(uKey)) {
      grouped.set(uKey, {
        geo: uGeo, creative: uCreative,
        spendTotal: 0, fbClicks: 0, views: 0, websiteClicks: 0,
        sub: 0, chat: 0, deposits: 0, adsCount: 0,
        campaigns: new Set(), adNamesSet: new Set(), _metricKeys: new Set(),
      });
    }
    for (const item of unmatchedMvpAdItems) {
      const mKey = mvpMetricKey(item);
      const variant = item.title || item.adId || "Без ID / пустая строка MVP";
      const deposits = Number(item.depSummary || 0) + Number(item.redepSummary || 0);
      grouped.get(uKey)!.adNamesSet.add(variant);
      if (!grouped.get(uKey)!._metricKeys.has(mKey)) {
        grouped.get(uKey)!._metricKeys.add(mKey);
        grouped.get(uKey)!.sub += Number(item.sub || 0);
        grouped.get(uKey)!.chat += Number(item.chat || 0);
        grouped.get(uKey)!.deposits += deposits;
        grouped.get(uKey)!.websiteClicks += Number(item.websiteClicks || 0);
      }
      const nKey = `${uGeo}||${uCreative}||${variant}`;
      nameGrouped.set(nKey, {
        geo: uGeo, creative: uCreative, adName: variant,
        spendTotal: 0, fbClicks: 0, views: 0,
        websiteClicks: Number(item.websiteClicks || 0),
        sub: Number(item.sub || 0), chat: Number(item.chat || 0), deposits,
        adsCount: 0, campaigns: new Set(), adNamesSet: new Set(),
        _metricKeys: new Set([mKey]),
      });
    }
  }

  const summaryRows: CreativeSummaryRow[] = Array.from(grouped.values())
    .map((b) => ({
      geo: b.geo, creative: b.creative,
      spendTotal: b.spendTotal, fbClicks: b.fbClicks, views: b.views,
      websiteClicks: b.websiteClicks, sub: b.sub, chat: b.chat, deposits: b.deposits,
      costPerSub: b.sub ? b.spendTotal / b.sub : null,
      costPerChat: b.chat ? b.spendTotal / b.chat : null,
      adsCount: b.adsCount, campaignsCount: b.campaigns.size,
      adNames: Array.from(b.adNamesSet).sort((a, c) => String(a).localeCompare(String(c), "ru")).join(", "),
    }))
    .sort((a, b) => {
      const g = String(a.geo).localeCompare(String(b.geo), "ru");
      return g || (b.spendTotal - a.spendTotal);
    });

  const detailRows: CreativeDetailRow[] = Array.from(nameGrouped.values())
    .map((b) => ({
      geo: b.geo, creative: b.creative, adName: b.adName,
      spendTotal: b.spendTotal, fbClicks: b.fbClicks, views: b.views,
      websiteClicks: b.websiteClicks, sub: b.sub, chat: b.chat, deposits: b.deposits,
      costPerSub: b.sub ? b.spendTotal / b.sub : null,
      costPerChat: b.chat ? b.spendTotal / b.chat : null,
      adsCount: b.adsCount, campaignsCount: b.campaigns.size,
    }))
    .sort((a, b) => {
      const g = String(a.geo).localeCompare(String(b.geo), "ru");
      if (g) return g;
      const c = String(a.creative).localeCompare(String(b.creative), "ru", { numeric: true });
      return c || String(a.adName).localeCompare(String(b.adName), "ru", { numeric: true });
    });

  return {
    summaryRows,
    detailRows,
    linkRows,
    hasAdData: adItemsRaw.length > 0,
  };
}
