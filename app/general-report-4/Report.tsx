"use client";

import { useEffect, useMemo, useState } from "react";
import { CHART_DEFS, PRESETS, fmt, fmtMoney, fmtOptMoney, fmtPct, presetRange, type ChartPoint, type DatePreset } from "@/components/general-report/shared";
import { applyFilters, buildGroups, computeTotals4, distinctValues, type Filters, type Period } from "@/lib/general-report-4/aggregate";
import { allocate, NO_BUYER } from "@/lib/general-report-4/allocate";
import { costTone, romiTone, toneClass, type Tone } from "@/lib/general-report-4/tone";
import { DIMENSIONS, DIM_LABELS, type Gr4Dim, type Gr4Row, type Gr4Targets, type Gr4Totals } from "@/lib/general-report-4/types";
import { DateRange } from "@/components/DatePicker";
import { mskDay } from "@/lib/day";

// Вкладка «Отчёт» (Decision 084) — как лист «Отчёт» общей таблицы, но по всей
// команде: общая таблица, выплаты разложены по баерам по их Torro
// (lib/general-report-4/allocate.ts). Ключевые цифры со сравнением с прошлым
// периодом, динамика, баеры, разбивка по любому разрезу, подсветка ячеек.

interface ReportData { main: Gr4Row[]; buyers: Gr4Row[]; targets: Gr4Targets; generatedAt: string; syncError: string | null; error?: string }

const card = "bg-[#111118] border border-violet-900/25 rounded-2xl p-4";
const smallChip = (on: boolean) => `px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${on ? "bg-violet-600 text-white" : "bg-[#111118] border border-violet-900/30 text-zinc-400 hover:text-violet-300"}`;
const label = "text-xs text-zinc-600 uppercase tracking-wider mr-1";
const GRAN: { id: Period; label: string }[] = [{ id: "day", label: "По дням" }, { id: "week", label: "По неделям" }, { id: "month", label: "По месяцам" }];

// Прошлый период той же длины — для сравнения.
function prevRange(r: { from: string; to: string }) {
  const day = 86_400_000, from = Date.parse(r.from), to = Date.parse(r.to), len = to - from + day;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { from: iso(from - len), to: iso(to - len) };
}
const lastDate = (rows: Gr4Row[]) => rows.reduce((m, r) => (r.date > m ? r.date : m), "");

function Delta({ cur, prev, lower, neutral }: { cur: number | null; prev: number | null; lower?: boolean; neutral?: boolean }) {
  if (cur === null || prev === null || prev === 0) return <span className="text-[11px] text-zinc-600">—</span>;
  const d = (cur - prev) / Math.abs(prev);
  const good = lower ? d < 0 : d > 0;
  // Спенд вырос — не хорошо и не плохо само по себе: без цвета.
  return <span className={`text-[11px] ${neutral || Math.abs(d) < 0.005 ? "text-zinc-500" : good ? "text-green-400" : "text-red-400"}`}>{d > 0 ? "▲" : "▼"} {Math.abs(d * 100).toFixed(0)}% к прошлому</span>;
}

function Kpi({ title, value, tone, goal, children }: { title: string; value: string; tone?: Tone; goal?: string; children?: React.ReactNode }) {
  return (
    <div className={`rounded-2xl px-4 py-3 border border-violet-900/25 ${tone ? toneClass(tone) : "bg-[#111118]"}`}>
      <p className="text-[11px] text-zinc-500 uppercase tracking-wider">{title}</p>
      <p className="text-xl font-semibold text-white mt-0.5">{value}</p>
      <div className="flex gap-2 items-center flex-wrap mt-0.5">{children}{goal && <span className="text-[11px] text-zinc-500">цель {goal}</span>}</div>
    </div>
  );
}

// Строка таблицы баеров и разбивки: деньги, цены, конверсии — с подсветкой.
function Line({ name, t, g, spendShare, torro }: { name: string; t: Gr4Totals; g: Gr4Targets; spendShare: number; torro?: number }) {
  const td = "px-3 py-2 whitespace-nowrap tabular-nums";
  return (
    <tr className="border-t border-violet-900/15 hover:bg-violet-900/5">
      <td className={`${td} text-zinc-200 sticky left-0 bg-[#111118]`}>{name}</td>
      <td className={`${td} text-white`}>{fmtMoney(t.budget, 0)}</td>
      <td className={td}>
        <div className="flex items-center gap-2"><div className="h-1.5 rounded bg-violet-500/60" style={{ width: `${Math.max(2, spendShare * 60)}px` }} /><span className="text-zinc-500 text-xs">{fmtPct(spendShare)}</span></div>
      </td>
      {torro !== undefined && <td className={`${td} text-zinc-400`}>{torro ? fmtMoney(torro, 0) : "—"}</td>}
      <td className={`${td} text-green-300`}>{t.revenue ? fmtMoney(t.revenue, 0) : "—"}</td>
      <td className={`${td} ${t.netProfit >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtMoney(t.netProfit, 0)}</td>
      <td className={`${td} font-semibold ${toneClass(romiTone(t.romi))}`}>{fmtPct(t.romi)}</td>
      <td className={`${td} ${toneClass(costTone(t.costPerSub, g.costPerSub))}`}>{fmtOptMoney(t.costPerSub)}</td>
      <td className={`${td} ${toneClass(costTone(t.costPerDialog, g.costPerDialog))}`}>{fmtOptMoney(t.costPerDialog)}</td>
      <td className={`${td} text-zinc-300`}>{fmt(t.registrations)}</td>
      <td className={`${td} text-zinc-300`}>{fmt(t.dialogs)}</td>
      <td className={`${td} text-zinc-300`}>{fmtPct(t.crDialogToDep)}</td>
      <td className={`${td} text-zinc-300`}>{fmt(t.depCountCpa + t.depCountIb, 1).replace(/,0$/, "")}</td>
      <td className={`${td} text-zinc-400`}>{fmtOptMoney(t.cacPayouts ?? t.cac)}</td>
    </tr>
  );
}
const HEAD = ["Спенд", "Доля спенда", "Доход", "Net Profit", "ROMI", "Цена подписки", "Цена диалога", "Подписки", "Диалоги", "CR диалог → деп", "Депы", "CAC"];

export default function Report() {
  const [d, setD] = useState<ReportData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [preset, setPreset] = useState<DatePreset>("this_month");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [by, setBy] = useState<Gr4Dim>("country");
  const [gran, setGran] = useState<Period>("day");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const load = (fresh = false) =>
    fetch(`/api/general-report-4?report=1${fresh ? "&refresh=1" : ""}`).then((r) => r.json()).then((x: ReportData) => {
      if (x.error) throw new Error(x.error);
      setD(x); setErr(null);
    }).catch((e: Error) => setErr(e.message)).finally(() => setRefreshing(false));
  useEffect(() => { load(); }, []);

  // Без дат «Весь период» = по последний день данных; для сравнения нужен конец.
  const range = useMemo(() => {
    if (preset === "custom") return from && to ? { from, to } : null;
    const r = presetRange(preset);
    return r ?? (d ? { from: "2000-01-01", to: lastDate(d.main) || "2000-01-01" } : null);
  }, [preset, from, to, d]);

  const view = useMemo(() => {
    if (!d || !range) return null;
    const now = allocate(d.main, d.buyers, filters, range);
    const rows = applyFilters(now.rows, filters, range);
    const pr = preset === "all" ? null : prevRange(range);
    const prev = pr ? computeTotals4(applyFilters(allocate(d.main, d.buyers, filters, pr).rows, filters, pr)) : null;
    const total = computeTotals4(rows);
    const groupBy = (dim: Gr4Dim) => {
      const m = new Map<string, Gr4Row[]>();
      for (const r of rows) { const k = r[dim] || "—"; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
      return [...m].map(([k, rs]) => ({ k, t: computeTotals4(rs) })).filter((x) => x.t.budget > 0 || x.t.revenue > 0)
        .sort((a, b) => b.t.budget - a.t.budget || b.t.revenue - a.t.revenue);
    };
    const chart: ChartPoint[] = [...buildGroups(rows, gran, null)].reverse().map((g) => ({
      name: g.label, spend: g.budget, revenue: g.revenue, romiPct: g.romi === null ? null : g.romi * 100,
      cac: g.cacPayouts, depCount: g.depCountCpa + g.depCountIb, depAmount: g.depAmountCpa + g.depAmountIb,
    }));
    return { total, prev, buyers: groupBy("buyer"), split: groupBy(by), chart, torro: now.torro, coef: now.coef };
  }, [d, range, filters, preset, by, gran]);

  const options = useMemo(() => Object.fromEntries(DIMENSIONS.map((x) => [x, d ? distinctValues(d.main, x) : []])) as Record<Gr4Dim, string[]>, [d]);
  const toggle = (dim: Gr4Dim, v: string | null) => setFilters((f) => ({ ...f, [dim]: v === null ? [] : (f[dim] ?? []).includes(v) ? f[dim]!.filter((x) => x !== v) : [...(f[dim] ?? []), v] }));

  if (err) return <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-5 py-4 text-red-300 text-sm">Не удалось загрузить отчёт: {err}</div>;
  if (!d || !view) return <div className="py-16 text-center text-zinc-500 text-sm">Собираю отчёт…</div>;
  const { total: t, prev: p } = view, g = d.targets;
  const deps = t.depCountCpa + t.depCountIb;
  const coefs = [...view.coef].filter(([, v]) => v !== null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-xs text-zinc-600 flex-wrap">
        <span>Из таблиц: <span className="text-zinc-500">{new Date(d.generatedAt).toLocaleString("ru-RU")}</span> · сами обновляются раз в 15 минут</span>
        <button onClick={() => { setRefreshing(true); load(true); }} disabled={refreshing} className="text-violet-300 hover:text-violet-200 disabled:opacity-50">{refreshing ? "обновляю…" : "↻ Обновить из таблиц"}</button>
        {d.syncError && <span className="text-amber-300/80">Не прочиталось: {d.syncError}</span>}
      </div>

      <div data-tour="gr4-report-filters" className={card}>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className={label}>Период:</span>
          {PRESETS.map((x) => <button key={x.id} onClick={() => setPreset(x.id)} className={smallChip(preset === x.id)}>{x.label}</button>)}
          {preset === "custom" && (
            <span className="flex items-center gap-2">
              <DateRange since={from || to || mskDay()} until={to || from || mskDay()} max="" onChange={(a, b) => { setFrom(a); setTo(b); }} />
            </span>
          )}
          {range && <span className="text-xs text-zinc-500">{range.from.slice(8)}.{range.from.slice(5, 7)} — {range.to.slice(8)}.{range.to.slice(5, 7)}</span>}
        </div>
        <button onClick={() => setFiltersOpen((v) => !v)} className="text-sm text-zinc-300 flex items-center gap-2 mt-1">
          <span className="text-zinc-500">{filtersOpen ? "▾" : "▸"}</span>Фильтры
          {DIMENSIONS.some((x) => filters[x]?.length) && (
            <span className="text-xs text-violet-300">{DIMENSIONS.filter((x) => filters[x]?.length).map((x) => `${DIM_LABELS[x]}: ${filters[x]!.join(", ")}`).join(" · ")}</span>
          )}
        </button>
        {DIMENSIONS.some((x) => filters[x]?.length) && <button onClick={() => setFilters({})} className="text-xs text-zinc-500 hover:text-red-300 ml-3">сбросить</button>}
        {filtersOpen && DIMENSIONS.filter((x) => options[x].length > 1).map((x) => (
          <div key={x} className="flex items-center gap-1.5 flex-wrap mt-1.5">
            <span className={`${label} w-20`}>{DIM_LABELS[x]}</span>
            <button onClick={() => toggle(x, null)} className={smallChip(!filters[x]?.length)}>Все</button>
            {options[x].map((v) => <button key={v} onClick={() => toggle(x, v)} className={smallChip(!!filters[x]?.includes(v))}>{v}</button>)}
          </div>
        ))}
      </div>

      <div data-tour="gr4-report-kpi" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi title="Доход" value={fmtMoney(t.revenue, 0)}><Delta cur={t.revenue} prev={p?.revenue ?? null} /></Kpi>
        <Kpi title="Спенд" value={fmtMoney(t.budget, 0)}><Delta cur={t.budget} prev={p?.budget ?? null} neutral /></Kpi>
        <Kpi title="Net Profit" value={fmtMoney(t.netProfit, 0)}><Delta cur={t.netProfit} prev={p?.netProfit ?? null} /></Kpi>
        <Kpi title="ROMI" value={fmtPct(t.romi)} tone={romiTone(t.romi)} goal="130%"><Delta cur={t.romi} prev={p?.romi ?? null} /></Kpi>
        <Kpi title="Депы" value={fmt(deps)}><Delta cur={deps} prev={p ? p.depCountCpa + p.depCountIb : null} /></Kpi>
        <Kpi title="Цена подписки" value={fmtOptMoney(t.costPerSub)} tone={costTone(t.costPerSub, g.costPerSub)} goal={g.costPerSub ? fmtMoney(g.costPerSub, 0) : undefined}><Delta cur={t.costPerSub} prev={p?.costPerSub ?? null} lower /></Kpi>
        <Kpi title="Цена диалога" value={fmtOptMoney(t.costPerDialog)} tone={costTone(t.costPerDialog, g.costPerDialog)} goal={g.costPerDialog ? fmtMoney(g.costPerDialog, 0) : undefined}><Delta cur={t.costPerDialog} prev={p?.costPerDialog ?? null} lower /></Kpi>
        <Kpi title="CR в диалог" value={fmtPct(t.crToDialog)} goal={g.crToDialog ? fmtPct(g.crToDialog) : undefined}><Delta cur={t.crToDialog} prev={p?.crToDialog ?? null} /></Kpi>
        <Kpi title="CR диалог → деп" value={fmtPct(t.crDialogToDep)} goal={g.crDialogToDep ? fmtPct(g.crDialogToDep) : undefined}><Delta cur={t.crDialogToDep} prev={p?.crDialogToDep ?? null} /></Kpi>
        <Kpi title="CAC" value={fmtOptMoney(t.cacPayouts)}><Delta cur={t.cacPayouts} prev={p?.cacPayouts ?? null} lower /></Kpi>
      </div>

      {view.chart.length >= 2 && (
        <div data-tour="gr4-report-chart" className={card}>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mr-2">Динамика: спенд и доход</p>
            {GRAN.map((x) => <button key={x.id} onClick={() => setGran(x.id)} className={smallChip(gran === x.id)}>{x.label}</button>)}
          </div>
          {CHART_DEFS.find((c) => c.id === "spendRevenue")!.render(view.chart)}
        </div>
      )}

      <div data-tour="gr4-report-buyers" className={`${card} overflow-x-auto`}>
        <p className="text-sm font-semibold text-white mb-1">Баеры</p>
        <p className="text-[11px] text-zinc-500 mb-3">
          Доход — выплаты общей таблицы, разложенные по Torro баеров внутри направления (лицо + регион), как «Факт выплат» финансовой таблицы.
          {coefs.length > 0 && ` Коэффициент факт / Torro: ${coefs.map(([k, v]) => `${k.replace("|", " · ")} ${v!.toFixed(2)}`).join(", ")}.`}
        </p>
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] text-zinc-500 uppercase tracking-wider">
            <th className="px-3 py-2 text-left sticky left-0 bg-[#111118]">Баер</th>
            {HEAD.slice(0, 2).map((h) => <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>)}
            <th className="px-3 py-2 text-left whitespace-nowrap">Torro</th>
            {HEAD.slice(2).map((h) => <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h === "Доход" ? "Доход (факт)" : h}</th>)}
          </tr></thead>
          <tbody>
            {view.buyers.map((b) => <Line key={b.k} name={b.k === NO_BUYER ? "Без баера (нет Torro в направлении)" : b.k} t={b.t} g={g} spendShare={t.budget ? b.t.budget / t.budget : 0} torro={view.torro.get(b.k) ?? 0} />)}
          </tbody>
        </table>
      </div>

      <div data-tour="gr4-report-split" className={`${card} overflow-x-auto`}>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <p className="text-sm font-semibold text-white mr-2">Разбивка</p>
          {DIMENSIONS.filter((x) => x !== "buyer").map((x) => <button key={x} onClick={() => setBy(x)} className={smallChip(by === x)}>{DIM_LABELS[x]}</button>)}
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] text-zinc-500 uppercase tracking-wider">
            <th className="px-3 py-2 text-left sticky left-0 bg-[#111118]">{DIM_LABELS[by]}</th>
            {HEAD.map((h) => <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {view.split.map((b) => <Line key={b.k} name={b.k} t={b.t} g={g} spendShare={t.budget ? b.t.budget / t.budget : 0} />)}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-zinc-600">
        Подсветка: ROMI от 130% — зелёный, 100–129% — жёлтый, 100% и ниже — красный. Цены подписки и диалога — к цели из листа «Настройки»: не дороже цели — зелёный, до +20% — жёлтый, дороже — красный.
      </p>
    </div>
  );
}
