"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  type DatePreset, type CardDef, type ChartPoint,
  fmt, fmtMoney, fmtPct, fmtOptMoney, romiClass, presetRange, PRESETS,
  SummaryCard, CARD_DEFS, CHART_DEFS,
} from "@/components/general-report/shared";
import { applyFilters, buildGroups, computeTotals4, distinctValues, type Filters, type Gr4Group, type Period } from "@/lib/general-report-4/aggregate";
import { DIMENSIONS, DIM_LABELS, type Gr4Data, type Gr4Dim, type Gr4Kind, type Gr4Targets, type Gr4Totals } from "@/lib/general-report-4/types";

// ─── Колонки ──────────────────────────────────────────────────────────────────
// Порядок и названия — как в General 3.0 и в новой Google-таблице: к ним привыкла
// команда. Группа задаёт цвет полоски над заголовком (те же группы, что в таблице),
// key — обведённые ключевые колонки.

type Group = "money" | "traffic" | "cost" | "cr" | "deps";
const GROUP_BAR: Record<Group, string> = {
  money: "border-t-zinc-500", traffic: "border-t-sky-500/70", cost: "border-t-blue-500",
  cr: "border-t-green-500", deps: "border-t-orange-400/70",
};

interface Col {
  id: string;
  label: string;
  group: Group;
  key?: boolean;
  only?: Gr4Kind;                                   // колонка есть только у этого вида таблицы
  cell: (t: Gr4Totals, kind: Gr4Kind, targets: Gr4Targets) => ReactNode;
  delta?: (t: Gr4Totals) => number | null;          // что сравнивать с прошлым периодом
  lowerIsBetter?: boolean;
}

const dash = <span className="text-zinc-700">—</span>;
const n = (v: number) => (v > 0 ? <span className="text-zinc-300">{fmt(v)}</span> : dash);
const pct = (v: number | null) => <span className="text-zinc-300">{fmtPct(v)}</span>;
const usd = (v: number | null) => <span className="text-zinc-400">{fmtOptMoney(v)}</span>;
const green = (v: number) => (v > 0 ? <span className="text-green-400">{fmtMoney(v, 0)}</span> : dash);

// Цель: зелёный — в норме, красный — нет. Без цели — обычный цвет.
function target(v: number | null, goal: number | null, lowerIsBetter: boolean, text: string) {
  if (v === null || goal === null) return <span className="text-zinc-300">{text}</span>;
  const ok = lowerIsBetter ? v <= goal : v >= goal;
  return <span className={ok ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>{text}</span>;
}

const COLUMNS: Col[] = [
  { id: "revenue", label: "Revenue", group: "money", cell: (t) => green(t.revenue), delta: (t) => t.revenue },
  { id: "netProfit", label: "Net Profit", group: "money",
    cell: (t) => <span className={t.netProfit >= 0 ? "text-green-400" : "text-red-400"}>{fmtMoney(t.netProfit, 0)}</span> },
  { id: "romi", label: "ROMI TOTAL", group: "money",
    cell: (t) => <span className={`font-semibold ${romiClass(t.romi)}`}>{fmtPct(t.romi)}</span>, delta: (t) => t.romi },
  { id: "romiCpa", label: "ROMI CPA", group: "money", only: "main", cell: (t) => <span className={romiClass(t.romiCpa)}>{fmtPct(t.romiCpa)}</span> },
  { id: "roas", label: "ROAS", group: "money", cell: (t) => <span className="text-zinc-300">{t.roas === null ? "—" : t.roas.toFixed(2)}</span> },
  { id: "budget", label: "Ad Budget", group: "money",
    cell: (t) => (t.budget > 0 ? <span className="text-white">{fmtMoney(t.budget)}</span> : dash), delta: (t) => t.budget },
  { id: "adClicks", label: "Ad Clicks", group: "traffic", cell: (t) => n(t.adClicks) },
  { id: "websiteClicks", label: "Website Clicks", group: "traffic", cell: (t) => n(t.websiteClicks) },
  { id: "impressions", label: "Impressions", group: "traffic", cell: (t) => n(t.impressions) },
  { id: "cpm", label: "CPM", group: "traffic", cell: (t) => usd(t.cpm) },
  { id: "cpc", label: "CPC", group: "traffic", cell: (t) => usd(t.cpc) },
  { id: "ctr", label: "CTR %", group: "traffic", cell: (t) => pct(t.ctr) },
  { id: "crAdToLp", label: "CR% Ad to LP", group: "traffic", cell: (t) => pct(t.crAdToLp) },
  { id: "crLpToChannel", label: "CR% LP to Channel", group: "traffic", cell: (t) => pct(t.crLpToChannel) },
  { id: "subs", label: "Подписки", group: "traffic", cell: (t) => n(t.registrations), delta: (t) => t.registrations },
  { id: "crTotal", label: "Общая CR LP %", group: "traffic", cell: (t) => pct(t.crTotal) },
  { id: "cps", label: "Цена подписки", group: "cost", key: true, lowerIsBetter: true, delta: (t) => t.costPerSub,
    cell: (t, _k, g) => target(t.costPerSub, g.costPerSub, true, fmtOptMoney(t.costPerSub)) },
  { id: "dialogs", label: "Диалоги", group: "traffic", cell: (t) => n(t.dialogs), delta: (t) => t.dialogs },
  { id: "crDia", label: "CR% в диалог", group: "cr",
    cell: (t, _k, g) => target(t.crToDialog, g.crToDialog, false, fmtPct(t.crToDialog)) },
  { id: "cpd", label: "Цена диалога", group: "cost", key: true, lowerIsBetter: true, delta: (t) => t.costPerDialog,
    cell: (t, _k, g) => target(t.costPerDialog, g.costPerDialog, true, fmtOptMoney(t.costPerDialog)) },
  { id: "depTorro", label: "Депы (Torro)", group: "deps", only: "buyer", cell: (t) => n(t.depCountCpa) },
  { id: "depCpa", label: "Deposits (CPA)", group: "deps", only: "main", cell: (t) => n(t.depCountCpa) },
  { id: "depIb", label: "Deposits (IB)", group: "deps", only: "main", cell: (t) => n(t.depCountIb) },
  { id: "depAmountCpa", label: "Dep Amount (CPA)", group: "deps", only: "main", cell: (t) => green(t.depAmountCpa) },
  { id: "depAmountIb", label: "Dep Amount (IB)", group: "deps", only: "main", cell: (t) => green(t.depAmountIb) },
  { id: "crDep", label: "CR% диалог → деп", group: "cr", key: true,
    cell: (t, _k, g) => target(t.crDialogToDep, g.crDialogToDep, false, fmtPct(t.crDialogToDep)) },
  { id: "payCpa", label: "CPA Payouts", group: "deps", only: "main", cell: (t) => n(t.payoutsCpa) },
  { id: "payIb", label: "IB Payouts", group: "deps", only: "main", cell: (t) => n(t.payoutsIb) },
  { id: "revCpa", label: "Revenue CPA", group: "deps", only: "main", cell: (t) => green(t.revenueCpa) },
  { id: "revIb", label: "Revenue IB", group: "deps", only: "main", cell: (t) => green(t.revenueIb) },
  // CAC общей таблицы — на выплату, как в General 3.0; у баера выплат нет — на деп.
  { id: "cac", label: "CAC", group: "cost", key: true,
    cell: (t, k) => <span className="text-zinc-300 font-semibold">{fmtOptMoney(k === "main" ? t.cacPayouts : t.cac)}</span> },
  { id: "awDep", label: "AW DEP", group: "deps", only: "main", cell: (t) => usd(t.awDep) },
];

const PERIODS: { id: Period; label: string }[] = [
  { id: "day", label: "День" }, { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" }, { id: "all", label: "Весь период" },
];

const DEFAULT_CARDS = ["spend", "revenue", "netProfit", "romi", "costPerSub", "costPerDialog"];
const CARDS_KEY = "gr4.totalCards";
const CHARTS_KEY = "gr4.visibleCharts";

// Изменение к прошлому периоду: ▲/▼ и процент. Зелёный — когда стало лучше.
function Delta({ cur, prev, lowerIsBetter }: { cur: number | null; prev: number | null; lowerIsBetter?: boolean }) {
  if (cur === null || prev === null || prev === 0) return null;
  const d = (cur - prev) / Math.abs(prev);
  if (!Number.isFinite(d) || Math.abs(d) < 0.005) return null;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return (
    <span className={`block text-[10px] leading-none mt-0.5 ${good ? "text-green-500/80" : "text-red-400/80"}`}>
      {d > 0 ? "▲" : "▼"} {Math.abs(d * 100).toFixed(0)}%
    </span>
  );
}

// Сохранённый список id из localStorage, только известные. null — нечего брать.
// nonEmpty: пустой список карточек не годится, а пустой список графиков — это выбор.
function stored(key: string, known: string[], nonEmpty: boolean): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const list = (JSON.parse(raw) as string[]).filter((id) => known.includes(id));
    return nonEmpty && list.length === 0 ? null : list;
  } catch { return null; } // приватное окно или битое значение
}

// ─── Страница ─────────────────────────────────────────────────────────────────

export default function GeneralReport4Page() {
  const [source, setSource] = useState("");
  const [data, setData] = useState<Gr4Data | null>(null);
  const [sources, setSources] = useState<Gr4Data["sources"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>({});
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [preset, setPreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [period, setPeriod] = useState<Period>("week");
  const [by, setBy] = useState<Gr4Dim | null>("country");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [compare, setCompare] = useState(true);

  // Сохранённый выбор читается сразу при создании состояния. Разметке сервера это
  // не мешает: карточки и графики рисуются только после загрузки данных, а она
  // идёт уже в браузере.
  const [visibleCards, setVisibleCards] = useState<string[]>(() =>
    stored(CARDS_KEY, CARD_DEFS.map((d) => d.id), true) ?? DEFAULT_CARDS);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [visibleCharts, setVisibleCharts] = useState<string[]>(() =>
    stored(CHARTS_KEY, CHART_DEFS.map((d) => d.id), false) ?? ["spendRevenue"]);

  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const save = (key: string, v: string[]) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* не критично */ } };

  // «Загружаю» включает тот, кто меняет источник (pickSource), а на старте оно
  // уже включено начальным состоянием — эффект только запускает запрос.
  const load = useCallback((src: string) => {
    fetch(`/api/general-report-4${src ? `?source=${encodeURIComponent(src)}` : ""}`)
      .then((r) => r.json() as Promise<Gr4Data>)
      .then((d) => {
        if (d.sources?.length) setSources(d.sources);
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(source); }, [source, load]);
  // Другая таблица — другие значения разрезов, старые фильтры к ней не относятся.
  const pickSource = (id: string) => {
    if (id === source) return;
    setLoading(true); setError(null);
    setSource(id); setFilters({}); setOpen(new Set());
  };

  const kind: Gr4Kind = data?.kind ?? "main";
  const activeSource = source || data?.source || "";
  const rows = useMemo(() => data?.rows ?? [], [data]);

  // У баера разрез «Баер» один-единственный — фильтр по нему бессмысленен.
  const dims = DIMENSIONS.filter((d) => !(kind === "buyer" && d === "buyer"));
  const options = useMemo(() => Object.fromEntries(dims.map((d) => [d, distinctValues(rows, d)])) as Record<Gr4Dim, string[]>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, kind]);

  const range = preset === "custom" ? (customFrom && customTo ? { from: customFrom, to: customTo } : null) : presetRange(preset);
  const filtered = useMemo(() => applyFilters(rows, filters, range), [rows, filters, range?.from, range?.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const allTime = useMemo(() => computeTotals4(applyFilters(rows, filters, null)), [rows, filters]);
  const total = useMemo(() => computeTotals4(filtered), [filtered]);
  const groups = useMemo(() => buildGroups(filtered, period, by), [filtered, period, by]);

  const cols = COLUMNS.filter((c) => !c.only || c.only === kind);
  const targets: Gr4Targets = data?.targets ?? { costPerSub: null, costPerDialog: null, crToDialog: null, crDialogToDep: null };

  // CAC в карточке — так же, как в таблице: у общей на выплату.
  const cards: CardDef<Gr4Totals>[] = CARD_DEFS.map((c) =>
    c.id === "cac" && kind === "main" ? { ...c, value: (t: Gr4Totals) => fmtOptMoney(t.cacPayouts) } : c);

  const chartData: ChartPoint[] = useMemo(() => [...groups].reverse().map((g) => ({
    name: g.label, spend: g.budget, revenue: g.revenue,
    romiPct: g.romi === null ? null : g.romi * 100,
    cac: kind === "main" ? g.cacPayouts : g.cac,
    depCount: g.depCountCpa + g.depCountIb, depAmount: g.depAmountCpa + g.depAmountIb,
  })), [groups, kind]);

  const toggleFilter = (d: Gr4Dim, v: string | null) =>
    setFilters((f) => ({ ...f, [d]: v === null ? [] : toggleIn(f[d] ?? [], v) }));
  const activeFilters = dims.filter((d) => (filters[d]?.length ?? 0) > 0);

  // «Весь период» без разбивки — одна строка; с разбивкой — сразу раскрыт.
  const isOpen = (key: string) => period === "all" || open.has(key);
  const toggleOpen = (key: string) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const allOpen = groups.length > 0 && groups.every((g) => isOpen(g.key));

  const chip = (active: boolean) =>
    `px-4 py-2 rounded-xl text-sm font-semibold transition ${
      active ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm" : "text-zinc-400 hover:text-violet-300"}`;
  const smallChip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
      active ? "bg-violet-600 text-white"
        : "bg-[#111118] border border-violet-900/30 text-zinc-400 hover:text-violet-300 hover:border-violet-700/50"}`;
  const label = "text-xs text-zinc-600 uppercase tracking-wider mr-1";

  const td = (c: Col) => `px-3 py-2 tabular-nums whitespace-nowrap ${c.key ? "bg-violet-950/25 border-x border-violet-800/30" : ""}`;

  const renderCells = (t: Gr4Totals, prev?: Gr4Totals) => cols.map((c) => (
    <td key={c.id} className={td(c)}>
      {c.cell(t, kind, targets)}
      {compare && prev && c.delta && <Delta cur={c.delta(t)} prev={c.delta(prev)} lowerIsBetter={c.lowerIsBetter} />}
    </td>
  ));

  return (
    <main className="min-h-screen bg-[#0a080f] text-white p-4 md:p-8">
      <div className="max-w-[1800px] mx-auto">
        <h1 className="text-white text-3xl font-semibold tracking-wide mb-6">General Report 4.0</h1>

        {sources.length > 1 && (
          <div className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 w-fit flex-wrap mb-6">
            {sources.map((s) => (
              <button key={s.id} onClick={() => pickSource(s.id)} className={chip(activeSource === s.id)}>{s.label}</button>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-4 animate-pulse">
              <div className="w-10 h-10 rounded-full border-2 border-violet-600/40 border-t-violet-400 animate-spin" />
              <p className="text-violet-300/50 text-sm tracking-widest uppercase">Loading report...</p>
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-5 py-4 text-red-300 text-sm">
            Не удалось загрузить данные: {error}
          </div>
        )}

        {data && !loading && !error && (
          <>
            <div className="flex items-center gap-4 mb-6 text-xs text-zinc-600 flex-wrap">
              <span>Строк: <span className="text-zinc-500">{rows.length}</span></span>
              <span>•</span>
              <span>Последний день: <span className="text-zinc-500">{rows.reduce((m, r) => (r.date > m ? r.date : m), "") || "—"}</span></span>
              <span>•</span>
              <span>Обновлено: <span className="text-zinc-500">{new Date(data.generatedAt).toLocaleString()}</span>{data.fetchedFrom === "cache" ? " (кэш, 5 мин)" : ""}</span>
            </div>

            {/* Итоги за всё время — фильтры по разрезам учитывают, даты нет */}
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">
                За всё время{activeFilters.length ? " · с фильтрами" : ""}
              </p>
              <button onClick={() => setCardsOpen((v) => !v)} className={smallChip(cardsOpen)}>⚙ Настроить</button>
            </div>
            {cardsOpen && (
              <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-4 mb-4 flex flex-wrap gap-2">
                {cards.map((c) => (
                  <button key={c.id} className={smallChip(visibleCards.includes(c.id))}
                    onClick={() => { const v = toggleIn(visibleCards, c.id); if (v.length) { setVisibleCards(v); save(CARDS_KEY, v); } }}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
              {cards.filter((c) => visibleCards.includes(c.id)).map((c) => (
                <SummaryCard key={c.id} label={c.label} value={c.value(allTime)} tone={c.tone?.(allTime)} />
              ))}
            </div>

            {/* Фильтры: в каждом разрезе можно выбрать несколько значений */}
            <div className="bg-[#111118] border border-violet-900/25 rounded-2xl p-4 mb-4">
              <button onClick={() => setFiltersOpen((v) => !v)} className="flex items-center gap-2 text-sm text-zinc-300 w-full text-left">
                <span className="text-zinc-500">{filtersOpen ? "▾" : "▸"}</span>
                Фильтры
                {activeFilters.length > 0 && (
                  <span className="text-xs text-violet-300">
                    {activeFilters.map((d) => `${DIM_LABELS[d]}: ${filters[d]!.join(", ")}`).join(" · ")}
                  </span>
                )}
                {activeFilters.length > 0 && (
                  <span onClick={(e) => { e.stopPropagation(); setFilters({}); }}
                    className="ml-auto text-xs text-zinc-500 hover:text-red-300 cursor-pointer">сбросить</span>
                )}
              </button>
              {filtersOpen && (
                <div className="mt-3 space-y-2">
                  {dims.filter((d) => options[d]?.length > 1).map((d) => (
                    <div key={d} className="flex items-center gap-1.5 flex-wrap">
                      <span className={`${label} w-20`}>{DIM_LABELS[d]}</span>
                      <button onClick={() => toggleFilter(d, null)} className={smallChip(!filters[d]?.length)}>Все</button>
                      {options[d].map((v) => (
                        <button key={v} onClick={() => toggleFilter(d, v)} className={smallChip(!!filters[d]?.includes(v))}>{v}</button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className={label}>Даты:</span>
              {PRESETS.map((p) => <button key={p.id} onClick={() => setPreset(p.id)} className={smallChip(preset === p.id)}>{p.label}</button>)}
              {preset === "custom" && (
                <span className="flex items-center gap-2 ml-1">
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                    className="bg-[#111118] border border-violet-900/40 text-zinc-300 text-xs rounded-xl px-3 py-1.5 outline-none [color-scheme:dark]" />
                  <span className="text-zinc-600">—</span>
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                    className="bg-[#111118] border border-violet-900/40 text-zinc-300 text-xs rounded-xl px-3 py-1.5 outline-none [color-scheme:dark]" />
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className={label}>Строки:</span>
              {PERIODS.map((p) => <button key={p.id} onClick={() => setPeriod(p.id)} className={smallChip(period === p.id)}>{p.label}</button>)}
              <span className={`${label} ml-4`}>Разбивка:</span>
              <button onClick={() => setBy(null)} className={smallChip(by === null)}>Нет</button>
              {dims.map((d) => <button key={d} onClick={() => setBy(d)} className={smallChip(by === d)}>{DIM_LABELS[d]}</button>)}
            </div>

            <div className="flex items-center gap-2 mb-6 flex-wrap">
              <span className={label}>Вид:</span>
              {period !== "all" && <button onClick={() => setCompare((v) => !v)} className={smallChip(compare)}>▲▼ к прошлому периоду</button>}
              {by && period !== "all" && (
                <button onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.key)))} className={smallChip(allOpen)}>
                  {allOpen ? "Свернуть все" : "Развернуть все"}
                </button>
              )}
              <span className={`${label} ml-4`}>Графики:</span>
              {CHART_DEFS.map((c) => (
                <button key={c.id} className={smallChip(visibleCharts.includes(c.id))}
                  onClick={() => { const v = toggleIn(visibleCharts, c.id); setVisibleCharts(v); save(CHARTS_KEY, v); }}>
                  {visibleCharts.includes(c.id) ? "✓ " : ""}{c.label}
                </button>
              ))}
            </div>

            {groups.length >= 2 && CHART_DEFS.filter((c) => visibleCharts.includes(c.id)).map((c) => (
              <div key={c.id} className="bg-[#111118] border border-violet-900/20 rounded-2xl p-4 mb-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">{c.label}</p>
                {c.render(chartData)}
              </div>
            ))}

            <div className="bg-[#111118] border border-violet-900/20 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto max-h-[75vh]">
                <table className="w-full text-sm">
                  <thead className="bg-[#0f0d18] sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider whitespace-nowrap sticky left-0 bg-[#0f0d18] z-20 border-t-4 border-t-zinc-600">
                        {period === "all" ? DIM_LABELS[by ?? "country"] : "Период"}
                      </th>
                      {cols.map((c) => (
                        <th key={c.id} className={`px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap border-t-4 ${GROUP_BAR[c.group]} ${
                          c.key ? "text-white bg-violet-950/40" : "text-zinc-500"}`}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g: Gr4Group, i) => {
                      const prev = groups[i + 1];
                      const expandable = !!g.children?.length && period !== "all";
                      return (
                        <Fragment key={g.key}>
                          {period !== "all" && (
                            <tr onClick={() => expandable && toggleOpen(g.key)}
                              className={`border-t border-violet-900/30 bg-[#16131f] ${expandable ? "cursor-pointer hover:bg-violet-900/15" : ""}`}>
                              <td className="px-3 py-2 whitespace-nowrap font-semibold text-violet-200 sticky left-0 bg-[#16131f]">
                                {expandable && <span className="text-zinc-500 mr-1.5">{isOpen(g.key) ? "▾" : "▸"}</span>}
                                {g.label}
                              </td>
                              {renderCells(g, prev)}
                            </tr>
                          )}
                          {isOpen(g.key) && g.children?.map((c) => (
                            <tr key={c.key} className="border-t border-violet-900/10 hover:bg-violet-900/5">
                              <td className={`px-3 py-1.5 whitespace-nowrap sticky left-0 bg-[#111118] ${period === "all" ? "text-zinc-200" : "pl-8 text-zinc-400"}`}>
                                {c.label}
                              </td>
                              {renderCells(c)}
                            </tr>
                          ))}
                          {period === "all" && !g.children && (
                            <tr className="border-t border-violet-900/10">
                              <td className="px-3 py-2 sticky left-0 bg-[#111118] text-zinc-200">Все</td>
                              {renderCells(g)}
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {groups.length === 0 && (
                      <tr><td colSpan={cols.length + 1} className="px-4 py-12 text-center text-zinc-600 text-sm">Нет данных под выбранные фильтры.</td></tr>
                    )}
                  </tbody>
                  {groups.length > 0 && (
                    <tfoot className="sticky bottom-0">
                      <tr className="bg-[#0f0d18] border-t-2 border-violet-700/40 font-semibold">
                        <td className="px-3 py-3 text-xs text-violet-400 uppercase tracking-wider whitespace-nowrap sticky left-0 bg-[#0f0d18]">
                          Итого{period !== "all" ? ` (${groups.length})` : ""}
                        </td>
                        {renderCells(total)}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            <p className="text-zinc-700 text-xs mt-4 text-right">
              General Report 4.0 · {kind === "main" ? "общая таблица" : "таблица баера"} · Sheets API, кэш 5 минут
              {kind === "main" && " · депы и доход — от хэда, без баера: при фильтре по баеру дохода не будет"}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
