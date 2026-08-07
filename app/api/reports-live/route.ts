import { NextResponse } from "next/server";
import { fetchCampaignInsights, fetchAdInsights, fetchCampaignStatuses, fetchAdStatuses } from "@/lib/reports-live/metaApi";
import { buildLiveCampaignItems, buildLiveCreativeItems } from "@/lib/reports-live/buildLiveItems";
import { loadCampaignPeriod, loadCreativePeriod } from "@/lib/reports-live/crmSource";
import type { LiveMode } from "@/lib/reports-live/types";
import type { Period } from "@/lib/reports-live/periods";

// Caches only the Meta API call (the expensive/rate-limited part) per mode+period.
// The CRM sheet list is always re-fetched so a newly-added week shows up immediately.
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { data: unknown; at: number }>();

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get("mode") ?? "campaigns") as LiveMode;
    if (mode !== "campaigns" && mode !== "ads") {
      return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
    }
    const requestedPeriod = searchParams.get("period") ?? undefined;

    let periods: Period[];
    let period: Period;
    let items: unknown[];
    let failedAccounts = 0;

    if (mode === "campaigns") {
      const loaded = await loadCampaignPeriod(requestedPeriod);
      periods = loaded.periods;
      period = loaded.period;
      const cacheKey = `campaigns:${period.key}`;
      const hit = cache.get(cacheKey);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return NextResponse.json({ ...(hit.data as object), periods, fetchedFrom: "cache" });
      }
      const [meta, statuses] = await Promise.all([
        fetchCampaignInsights(period.since, period.until),
        fetchCampaignStatuses(),
      ]);
      failedAccounts = meta.failedAccounts;
      items = buildLiveCampaignItems(loaded.rows, meta.items, statuses);
    } else {
      const loaded = await loadCreativePeriod(requestedPeriod);
      periods = loaded.periods;
      period = loaded.period;
      const cacheKey = `ads:${period.key}`;
      const hit = cache.get(cacheKey);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return NextResponse.json({ ...(hit.data as object), periods, fetchedFrom: "cache" });
      }
      const [meta, statuses] = await Promise.all([
        fetchAdInsights(period.since, period.until),
        fetchAdStatuses(),
      ]);
      failedAccounts = meta.failedAccounts;
      items = buildLiveCreativeItems(meta.items, loaded.crmByName, loaded.crmById, statuses);
    }

    // Surface partial data loss (e.g. Meta rate limits) instead of silently under-reporting.
    const warning =
      failedAccounts > 0
        ? `Не удалось загрузить данные по ${failedAccounts} рекламным кабинетам (Meta API) — цифры могут быть занижены. Обновите отчёт через минуту.`
        : undefined;

    const data = { mode, period, items, generatedAt: new Date().toISOString(), warning };
    // Don't cache a partial-failure response — a retry a moment later should get real data.
    if (!warning) cache.set(`${mode}:${period.key}`, { data, at: Date.now() });
    return NextResponse.json({ ...data, periods, fetchedFrom: "api" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Reports live API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
