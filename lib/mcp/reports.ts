import type { Profile } from "@/lib/auth/types";
import { COMBINED_ID, collectSources4, publicSources4 } from "@/lib/general-report-4/sources";
import { loadCombined, snapshot } from "@/lib/general-report-4/store";
import { applyFilters, buildGroups, computeTotals4, distinctValues, type Filters, type Period } from "@/lib/general-report-4/aggregate";
import { allocate } from "@/lib/general-report-4/allocate";
import { DIMENSIONS, DIM_LABELS, type Gr4Dim, type Gr4Totals } from "@/lib/general-report-4/types";
import { loadLeaders } from "@/lib/home/leaders";
import type { Board, Standing } from "@/lib/home/leaderboard";
import { mskDay, mskTime } from "@/lib/day";
import { pickBuyer } from "./scope";
import { ToolError, type ToolDef } from "./protocol";

// General 4.0 и рейтинг баеров через AI (27.11.2026, Даниил: «AI-подключение видит весь дашборд»). Те же источники и
// права, что у страниц: таблицы — collectSources4 (баер и джун — своя, владелец и тимлид — общая, сводная и любой баер),
// цифры — снимки gr4_snapshots (крон раз в 15 минут) и те же computeTotals4 / buildGroups / allocate, что страница;
// рейтинг — loadLeaders, как Главная (баеру суммы — только свои).

interface Ctx { me: Profile; tokenId?: string }
type Tool = ToolDef<Ctx>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 1000) / 10);
const at = (ms: number) => `${mskDay(new Date(ms))} ${mskTime(new Date(ms))} МСК`;

// Метрики строки — как столбцы «Таблицы» General 4.0; производные — из сумм, не из формул таблицы.
export const gr4View = (t: Gr4Totals) => ({
  spend: r2(t.budget), revenue: r2(t.revenue), profit: r2(t.netProfit), romi_pct: pct(t.romi), roas: r2(t.roas),
  impressions: t.impressions, ad_clicks: t.adClicks, website_clicks: t.websiteClicks, subscribers: t.registrations, dialogs: t.dialogs,
  deps_cpa: t.depCountCpa, deps_ib: t.depCountIb, dep_sum: r2(t.depAmountCpa + t.depAmountIb), avg_dep: r2(t.awDep),
  payouts: r2(t.payoutsCpa + t.payoutsIb), revenue_cpa: r2(t.revenueCpa), revenue_ib: r2(t.revenueIb), romi_cpa_pct: pct(t.romiCpa),
  cpm: r2(t.cpm), cpc: r2(t.cpc), ctr_pct: pct(t.ctr), cr_ad_to_lp_pct: pct(t.crAdToLp), cr_lp_to_sub_pct: pct(t.crLpToChannel),
  cost_per_sub: r2(t.costPerSub), cr_sub_to_dialog_pct: pct(t.crToDialog), cost_per_dialog: r2(t.costPerDialog),
  cr_dialog_to_dep_pct: pct(t.crDialogToDep), cac: r2(t.cac),
  quals: { A: t.qualA, B: t.qualB, C: t.qualC, D: t.qualD, E: t.qualE }, unquals: t.unquals,
});

// Значения фильтра — без учёта регистра, к тому написанию, что в таблице; чего нет — отказ со списком.
export function filtersOf(raw: unknown, values: Record<Gr4Dim, string[]>): Filters {
  const out: Filters = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const dim = DIMENSIONS.find((d) => d === k);
    if (!dim) throw new ToolError(`Нет разреза «${k}». Есть: ${DIMENSIONS.join(", ")}`);
    const list = (Array.isArray(v) ? v : [v]).map((x) => String(x).trim()).filter(Boolean);
    out[dim] = list.map((x) => {
      const hit = values[dim].find((y) => y.toLowerCase() === x.toLowerCase());
      if (!hit) throw new ToolError(`В разрезе «${DIM_LABELS[dim]}» нет «${x}». Есть: ${values[dim].slice(0, 40).join(", ") || "пусто"}`);
      return hit;
    });
  }
  return out;
}

const DIM_PROPS = Object.fromEntries(DIMENSIONS.map((d) => [d, { type: "array", items: { type: "string" }, description: DIM_LABELS[d] }]));
const PERIODS = ["day", "week", "month", "all"] as const;

const getGeneralReport: Tool = {
  name: "get_general_report",
  title: "General 4.0",
  description: "Таблицы General 4.0, как раздел «General 4.0» (снимок таблиц, обновляется раз в 15 минут): у баера — своя таблица; у владельца и тимлида — общая (main), «Сводная по баерам» (buyers) и таблица любого баера. Итог за период и строки по дням, неделям, месяцам или за весь период, с разбивкой внутри по разрезу (лицо, язык, гео, регион, источник, площадка, воронка, баер) и фильтрами по тем же разрезам. Цифры — как в таблице, производные из сумм: бюджет, доход, профит, ROMI, ROAS, показы, клики, клики на сайт, подписки, диалоги, депы и суммы CPA и IB, выплаты, цены, конверсии, квалы A–E; цели из листа «Настройки». У общей таблицы payouts_by_buyer — выплаты «Депов» разложены по баерам по их Torro, как вкладка «Отчёт». values — какие значения есть в разрезах (для фильтров).",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "Таблица: id из sources (main, buyers, buyer:<id>, у баера — me) или имя / код баера. По умолчанию — первая доступная." },
      since: { type: "string", description: "Первый день, YYYY-MM-DD. Без дат — весь период таблицы." },
      until: { type: "string", description: "Последний день включительно, YYYY-MM-DD." },
      period: { type: "string", enum: [...PERIODS], description: "Строки: по дням, неделям (пн–вс), месяцам или одной строкой за весь период. По умолчанию all." },
      group_by: { type: "string", enum: [...DIMENSIONS], description: "Разбивка внутри каждой строки периода." },
      filter: { type: "object", properties: DIM_PROPS, additionalProperties: false, description: "Фильтры по разрезам, несколько значений — любое из них: { \"country\": [\"ES\"], \"face\": [\"ROMAN\"] }. Значения — как в values." },
      payouts_by_buyer: { type: "boolean", description: "Только общая таблица: выплаты «Депов» (по направлению, без баера) разложить по баерам по их Torro — как вкладка «Отчёт»; с group_by=buyer — доход каждого баера по факту." },
      limit: { type: "integer", description: "Сколько строк периода, 1–100. По умолчанию 31. В разбивке — до 20 строк, по бюджету." },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, title: "General 4.0" },
  async run({ me }, a) {
    const all = await collectSources4(me);
    if (!all.length) throw new ToolError(me.role === "buyer" ? "Твоя таблица General 4.0 не подключена — её подключает владелец на «Команде»" : "Ни одной таблицы General 4.0 не подключено");
    const want = str(a.source).toLowerCase();
    let src = !want ? all[0] : all.find((s) => s.id.toLowerCase() === want || s.label.toLowerCase() === want);
    if (!src && want && me.role !== "buyer") {
      const b = await pickBuyer(me, a.source).catch(() => null);
      if (b?.id) src = all.find((s) => s.id === `buyer:${b.id}`);
    }
    if (!src) throw new ToolError(`Нет такой таблицы. Есть: ${all.map((s) => `${s.label} (${s.id})`).join(", ")}`);

    const since = str(a.since), until = str(a.until);
    if ((since && !DAY.test(since)) || (until && !DAY.test(until))) throw new ToolError("Даты — YYYY-MM-DD");
    const range = since || until ? { from: since || "0000-00-00", to: until || "9999-12-31" } : null;
    const period: Period = PERIODS.find((p) => p === str(a.period)) ?? "all";
    const by = DIMENSIONS.find((d) => d === str(a.group_by)) ?? null;

    const data = src.id === COMBINED_ID ? await loadCombined(all) : await snapshot(src.spreadsheetId, src.kind);
    const values = Object.fromEntries(DIMENSIONS.map((d) => [d, distinctValues(data.rows, d)])) as Record<Gr4Dim, string[]>;
    const filters = filtersOf(a.filter, values);
    let rows = data.rows, torro: Map<string, number> | null = null, at2 = data.at;
    if (a.payouts_by_buyer === true) {
      if (src.kind !== "main") throw new ToolError("payouts_by_buyer — только у общей таблицы (source: main)");
      const buyers = await loadCombined(all);
      const al = allocate(data.rows, buyers.rows, filters, range);
      rows = al.rows; torro = al.torro; at2 = Math.min(data.at, buyers.at);
    }
    const picked = applyFilters(rows, filters, range);
    const groups = buildGroups(picked, period, by);
    const limit = Math.min(100, Math.max(1, Number.isInteger(a.limit) ? (a.limit as number) : 31));
    return {
      sources: publicSources4(all), source: { id: src.id, label: src.label },
      period, since: since || undefined, until: until || undefined, group_by: by ?? undefined,
      totals: picked.length ? gr4View(computeTotals4(picked)) : null,
      rows: groups.slice(0, limit).map((g) => ({
        period: g.label, ...gr4View(g),
        by: g.children?.slice(0, 20).map((c) => ({ [by!]: c.label, ...gr4View(c) })),
        more_by: g.children && g.children.length > 20 ? g.children.length - 20 : undefined,
      })),
      more_rows: Math.max(0, groups.length - limit) || undefined,
      torro_by_buyer: torro ? Object.fromEntries([...torro].map(([k, v]) => [k, r2(v)])) : undefined,
      targets: data.targets,
      values: Object.fromEntries(DIMENSIONS.map((d) => [d, values[d].slice(0, 40)])),
      data_as_of: at(at2), sync_error: data.error ?? undefined,
    };
  },
};

const standing = (x: Standing, i: number) => ({
  place: i + 1, buyer: x.label, me: x.me || undefined, gone: x.gone || undefined,
  romi_pct: pct(x.romi), prev_romi_pct: x.prevRomi === undefined ? undefined : pct(x.prevRomi),
  spend: r2(x.spend) ?? undefined, revenue: r2(x.revenue) ?? undefined, profit: r2(x.profit) ?? undefined,
});
export const boardView = (b: Board) => ({
  ranking: b.ranking.map(standing),
  volume: b.volume?.label ?? null, efficiency: b.efficiency?.label ?? null,
  progress: b.progress === undefined ? undefined : b.progress?.label ?? null,
});

const getLeaderboard: Tool = {
  name: "get_leaderboard",
  title: "Рейтинг баеров",
  description: "Рейтинг баеров с Главной — по таблицам General 4.0 баеров за месяц (30 дней), 3 месяца и всё время: место по профиту (доход − расход), ROMI и ROMI прошлого окна той же длины; номинации «Объём» (наибольший расход при ROMI > 0), «Эффективность» (лучший ROMI у тех, кто лил в среднем от $15k в месяц) и «Прогресс» (сильнее всех поднял ROMI к прошлому окну, от $1k расхода в обоих; у всего времени нет). Баеру — место, ник и ROMI всех, суммы — только свои; владельцу и тимлиду — суммы всех. Выбывшие — gone.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, title: "Рейтинг баеров" },
  async run({ me }) {
    const r = await loadLeaders(me);
    return {
      month: boardView(r.month), quarter: boardView(r.quarter), all_time: boardView(r.allTime),
      failed: r.failed.length ? r.failed : undefined,
      note: "Цифры — из таблиц General 4.0 баеров (снимки раз в 15 минут), а не из склада: у таблиц длиннее история.",
    };
  },
};

export const REPORT_TOOLS: Tool[] = [getGeneralReport, getLeaderboard];
