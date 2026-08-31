// ВНИМАНИЕ: этот роут больше никто не зовёт. Reports переехали на склад, а чек
// за сегодня ходит в живую Мету через свой /api/check.
//
// Здесь он оставлен до решения владельца: сносить его вместе с ручной сверкой
// (/api/reports/manual, lib/reports/, buildLiveItems, crmSource) или держать
// запасным путём. Молча удалять работающую сверку не стали.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { fetchCampaignInsights, fetchAdInsights, fetchAdStatuses, fetchCampaignMeta } from "@/lib/reports-live/metaApi";
import { buildLiveCampaignItems, buildLiveCreativeItems } from "@/lib/reports-live/buildLiveItems";
import { loadCampaignPeriod, loadCreativePeriod } from "@/lib/reports-live/crmSource";
import type { LiveMode } from "@/lib/reports-live/types";
import type { Period } from "@/lib/reports-live/periods";
import { reportConfigFor } from "@/lib/reports-live/config";

// Кэшируется только поход в Meta — самая дорогая и самая лимитируемая часть.
// Список листов CRM перечитывается всегда, чтобы новая неделя появлялась сразу.
//
// В ключе кэша обязан быть человек. Раньше ключом были режим и период, и это
// работало, пока источник был один на всех. С личными подключениями тот же ключ
// означал бы, что один баер получает цифры другого — молча и правдоподобно.
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { data: unknown; at: number }>();

export async function GET(req: Request) {
  try {
    // Проверка стоит и здесь, а не только в layout страницы: роут вызывается
    // напрямую, и спрятанная страница ничего не закрывает.
    const me = await getProfile();
    if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    // Режим разбирается до конфига: от него зависит, какие источники нужны.
    // «Кампании» работают без выгрузки по объявлениям и наоборот.
    const mode = (searchParams.get("mode") ?? "campaigns") as LiveMode;
    if (mode !== "campaigns" && mode !== "ads") {
      return NextResponse.json({ error: `Неизвестный режим: ${mode}` }, { status: 400 });
    }

    const config = await reportConfigFor(me, mode);
    if ("missing" in config) {
      return NextResponse.json(
        {
          error:
            me.role === "buyer"
              ? `Подключи ${config.missing.join(", ")} в Настройках → Интеграции`
              : `Не заданы переменные окружения: ${config.missing.join(", ")}`,
        },
        { status: me.role === "buyer" ? 403 : 500 }
      );
    }


    const requestedPeriod = searchParams.get("period") ?? undefined;

    let periods: Period[];
    let period: Period;
    let items: unknown[];
    let failedAccounts = 0;
    let totalActiveDailyBudget = 0;

    if (mode === "campaigns") {
      const loaded = await loadCampaignPeriod(config.campaignsSheetId, requestedPeriod);
      periods = loaded.periods;
      period = loaded.period;
      const cacheKey = `${config.cacheKey}:campaigns:${period.key}`;
      const hit = cache.get(cacheKey);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return NextResponse.json({ ...(hit.data as object), periods, fetchedFrom: "cache" });
      }
      const [meta, campaignMeta] = await Promise.all([
        fetchCampaignInsights(config.metaToken, period.since, period.until),
        fetchCampaignMeta(config.metaToken),
      ]);
      failedAccounts = meta.failedAccounts;
      items = buildLiveCampaignItems(loaded.rows, meta.items, campaignMeta.statuses, campaignMeta.dailyBudgets);
      // Sum every distinct active campaign's budget once — not per-row — so this total
      // stays correct even though a campaign can appear once per creative in Ads mode.
      totalActiveDailyBudget = [...new Set(meta.items.map((c) => c.campaignId))].reduce(
        (sum, id) => sum + (campaignMeta.dailyBudgets.get(id) ?? 0), 0
      );
    } else {
      const loaded = await loadCreativePeriod(config.adsSheetId, config.adsByIdSheetId, requestedPeriod);
      periods = loaded.periods;
      period = loaded.period;
      const cacheKey = `${config.cacheKey}:ads:${period.key}`;
      const hit = cache.get(cacheKey);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return NextResponse.json({ ...(hit.data as object), periods, fetchedFrom: "cache" });
      }
      const [meta, statuses, campaignMeta] = await Promise.all([
        fetchAdInsights(config.metaToken, period.since, period.until),
        fetchAdStatuses(config.metaToken),
        fetchCampaignMeta(config.metaToken),
      ]);
      failedAccounts = meta.failedAccounts;
      items = buildLiveCreativeItems(meta.items, loaded.crmByName, loaded.crmById, statuses, campaignMeta.dailyBudgets);
      totalActiveDailyBudget = [...new Set(meta.items.map((a) => a.campaignId))].reduce(
        (sum, id) => sum + (campaignMeta.dailyBudgets.get(id) ?? 0), 0
      );
    }

    // Surface partial data loss (e.g. Meta rate limits) instead of silently under-reporting.
    const warning =
      failedAccounts > 0
        ? `Не удалось загрузить данные по ${failedAccounts} рекламным кабинетам (Meta API) — цифры могут быть занижены. Обновите отчёт через минуту.`
        : undefined;

    const data = { mode, period, items, totalActiveDailyBudget, generatedAt: new Date().toISOString(), warning };
    // Don't cache a partial-failure response — a retry a moment later should get real data.
    // Ключ записи обязан совпадать с ключом чтения выше — включая человека.
    if (!warning) cache.set(`${config.cacheKey}:${mode}:${period.key}`, { data, at: Date.now() });
    return NextResponse.json({ ...data, periods, fetchedFrom: "api" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Reports live API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
