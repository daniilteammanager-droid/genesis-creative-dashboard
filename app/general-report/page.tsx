"use client";

import { useEffect, useState, useMemo, useCallback, type ReactNode } from "react";
import Link from "next/link";
import {
  ResponsiveContainer, ComposedChart, Area, Bar, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { GrDayRow, GrSource, GrPeriodRow, GrTotals } from "@/lib/general-report/types";
import { computeTotals, groupByPeriod } from "@/lib/general-report/aggregate";
import type { Granularity } from "@/lib/general-report/aggregate";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GrApiResponse {
  source: GrSource;
  rows: GrDayRow[];
  countries: string[];
  generatedAt: string;
  fetchedFrom: "api" | "cache";
  error?: string;
}

type DatePreset = "all" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";

const SOURCES: { id: GrSource; label: string }[] = [
  { id: "summary", label: "Саммари (баеры)" },
  { id: "main",    label: "Главная" },
  { id: "artem",   label: "Артём" },
  { id: "matvey",  label: "Матвей" },
  { id: "andrey",  label: "Андрей" },
];

// ─── Format helpers ───────────────────────────────────────────────────────────

function fmt(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtMoney(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return "—";
  return "$" + fmt(n, decimals);
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return (n * 100).toFixed(1) + "%";
}

function fmtOptMoney(n: number | null): string {
  return n === null ? "—" : fmtMoney(n);
}

function romiClass(romi: number | null): string {
  if (romi === null) return "text-zinc-600";
  if (romi >= 0.5) return "text-green-400";
  if (romi >= 0) return "text-yellow-400";
  return "text-red-400";
}

// ─── Date presets ─────────────────────────────────────────────────────────────

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRange(preset: DatePreset): { from: string; to: string } | null {
  if (preset === "all" || preset === "custom") return null;
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dow = today.getUTCDay() || 7;

  if (preset === "this_week") {
    const monday = new Date(today);
    monday.setUTCDate(today.getUTCDate() - dow + 1);
    return { from: isoDay(monday), to: isoDay(today) };
  }
  if (preset === "last_week") {
    const monday = new Date(today);
    monday.setUTCDate(today.getUTCDate() - dow + 1 - 7);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return { from: isoDay(monday), to: isoDay(sunday) };
  }
  if (preset === "this_month") {
    return { from: isoDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: isoDay(today) };
  }
  // last_month
  const firstPrev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const lastPrev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  return { from: isoDay(firstPrev), to: isoDay(lastPrev) };
}

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: "all",        label: "Всё время" },
  { id: "this_week",  label: "Эта неделя" },
  { id: "last_week",  label: "Прошлая неделя" },
  { id: "this_month", label: "Этот месяц" },
  { id: "last_month", label: "Прошлый месяц" },
  { id: "custom",     label: "Диапазон" },
];

const GRANULARITIES: { id: Granularity; label: string }[] = [
  { id: "day",   label: "День" },
  { id: "week",  label: "Неделя" },
  { id: "month", label: "Месяц" },
];

// ─── Small components ─────────────────────────────────────────────────────────

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="bg-[#111118] border border-violet-900/20 rounded-2xl px-4 py-3.5">
      <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${
        tone === "good" ? "text-green-400" : tone === "bad" ? "text-red-400" : "text-white"
      }`}>{value}</p>
    </div>
  );
}

// ─── Configurable total cards ─────────────────────────────────────────────────

interface CardDef {
  id: string;
  label: string;
  value: (t: GrTotals) => string;
  tone?: (t: GrTotals) => "good" | "bad" | undefined;
}

const CARD_DEFS: CardDef[] = [
  { id: "spend",       label: "Spend",         value: (t) => fmtMoney(t.budget, 0) },
  { id: "revenue",     label: "Revenue",       value: (t) => fmtMoney(t.revenue, 0), tone: (t) => (t.revenue > 0 ? "good" : undefined) },
  { id: "netProfit",   label: "Net Profit",    value: (t) => fmtMoney(t.netProfit, 0), tone: (t) => (t.netProfit >= 0 ? "good" : "bad") },
  { id: "romi",        label: "ROMI",          value: (t) => fmtPct(t.romi), tone: (t) => (t.romi === null ? undefined : t.romi >= 0 ? "good" : "bad") },
  { id: "roas",        label: "ROAS",          value: (t) => (t.roas === null ? "—" : t.roas.toFixed(2)) },
  { id: "deposits",    label: "Депозиты",      value: (t) => `${fmt(t.depCountCpa + t.depCountIb)} · ${fmtMoney(t.depAmountCpa + t.depAmountIb, 0)}` },
  { id: "depositsCpa", label: "Депозиты CPA",  value: (t) => `${fmt(t.depCountCpa)} · ${fmtMoney(t.depAmountCpa, 0)}` },
  { id: "depositsIb",  label: "Депозиты IB",   value: (t) => `${fmt(t.depCountIb)} · ${fmtMoney(t.depAmountIb, 0)}` },
  { id: "cac",         label: "CAC",           value: (t) => fmtOptMoney(t.cac) },
  { id: "adClicks",    label: "Клики",         value: (t) => fmt(t.adClicks) },
  { id: "websiteClicks", label: "Клики на сайт", value: (t) => fmt(t.websiteClicks) },
  { id: "impressions", label: "Показы",        value: (t) => fmt(t.impressions) },
  { id: "cpm",         label: "CPM",           value: (t) => fmtOptMoney(t.cpm) },
  { id: "cpc",         label: "CPC",           value: (t) => fmtOptMoney(t.cpc) },
  { id: "ctr",         label: "CTR",           value: (t) => fmtPct(t.ctr) },
  { id: "registrations", label: "Подписчики",  value: (t) => fmt(t.registrations) },
  { id: "costPerSub",  label: "Цена подписчика", value: (t) => fmtOptMoney(t.costPerSub) },
  { id: "dialogs",     label: "Диалоги",       value: (t) => fmt(t.dialogs) },
  { id: "costPerDialog", label: "Цена диалога", value: (t) => fmtOptMoney(t.costPerDialog) },
  { id: "crDialogToDep", label: "CR% диа → деп", value: (t) => fmtPct(t.crDialogToDep) },
  { id: "payouts",     label: "Выплаты",       value: (t) => `${fmt(t.payoutsCpa)} + ${fmt(t.payoutsIb)}` },
];

const DEFAULT_CARDS = ["spend", "revenue", "netProfit", "romi", "deposits", "cac"];
const CARDS_STORAGE_KEY = "gr3.totalCards";

// ─── Charts ───────────────────────────────────────────────────────────────────

interface ChartPoint {
  name: string;
  spend: number;
  revenue: number;
  romiPct: number | null;
  cac: number | null;
  depCount: number;
  depAmount: number;
}

const AXIS_TICK = { fontSize: 11, fill: "#71717a" };
const AXIS_LINE = { stroke: "rgba(139,92,246,0.2)" };
const GRID_STROKE = "rgba(139,92,246,0.1)";

// Themed tooltip shared by every chart — pass which dataKeys are money/percent/plain counts.
function ChartTooltip({
  active, payload, label, money = [], percent = [], plain = [],
}: TooltipContentProps & { money?: string[]; percent?: string[]; plain?: string[] }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-[#151320] border border-violet-900/40 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-zinc-500 mb-1">{label}</p>
      {payload.map((entry) => {
        const key = String(entry.dataKey);
        const v = typeof entry.value === "number" ? entry.value : null;
        const text = v === null ? "—"
          : money.includes(key) ? fmtMoney(v, 0)
          : percent.includes(key) ? v.toFixed(1) + "%"
          : plain.includes(key) ? fmt(v)
          : String(v);
        return <p key={key} style={{ color: entry.color }} className="font-medium">{entry.name}: {text}</p>;
      })}
    </div>
  );
}

interface ChartDef {
  id: string;
  label: string;
  render: (data: ChartPoint[]) => ReactNode;
}

const CHART_DEFS: ChartDef[] = [
  {
    id: "spendRevenue",
    label: "Spend vs Revenue",
    render: (data) => (
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gr3-revenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4ade80" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gr3-spend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} minTickGap={24} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + fmt(v)} width={64} />
          <Tooltip content={(props) => <ChartTooltip {...props} money={["revenue", "spend"]} />} />
          <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
          <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#4ade80" strokeWidth={2} fill="url(#gr3-revenue)" />
          <Area type="monotone" dataKey="spend" name="Spend" stroke="#8b5cf6" strokeWidth={2} fill="url(#gr3-spend)" />
        </ComposedChart>
      </ResponsiveContainer>
    ),
  },
  {
    id: "romi",
    label: "ROMI %",
    render: (data) => (
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} minTickGap={24} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => v + "%"} width={48} />
          <Tooltip content={(props) => <ChartTooltip {...props} percent={["romiPct"]} />} />
          <Bar dataKey="romiPct" name="ROMI" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.romiPct === null ? "#3f3f46" : d.romiPct >= 0 ? "#4ade80" : "#f87171"} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    ),
  },
  {
    id: "cac",
    label: "CAC",
    render: (data) => (
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} minTickGap={24} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + fmt(v)} width={64} />
          <Tooltip content={(props) => <ChartTooltip {...props} money={["cac"]} />} />
          <Line type="monotone" dataKey="cac" name="CAC" stroke="#facc15" strokeWidth={2} dot={{ r: 2 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    ),
  },
  {
    id: "deposits",
    label: "Депозиты",
    render: (data) => (
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} minTickGap={24} />
          <YAxis yAxisId="count" tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
          <YAxis yAxisId="amount" orientation="right" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + fmt(v)} width={64} />
          <Tooltip content={(props) => <ChartTooltip {...props} money={["depAmount"]} plain={["depCount"]} />} />
          <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
          <Bar yAxisId="count" dataKey="depCount" name="Кол-во" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
          <Line yAxisId="amount" type="monotone" dataKey="depAmount" name="Сумма" stroke="#4ade80" strokeWidth={2} dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    ),
  },
];

const DEFAULT_CHARTS = ["spendRevenue"];
const CHARTS_STORAGE_KEY = "gr3.visibleCharts";

// ─── Table columns ────────────────────────────────────────────────────────────
// Order is the one Daniil specified directly (26.08.2026), matching the exact
// column names from the source sheet (see parseCountrySheet.ts).

interface ColDef {
  id: string;
  label: string;
  cell: (p: GrPeriodRow) => ReactNode;
}

// No field in GrTotals for this one — cheap enough to derive inline.
const overallCrLp = (p: GrPeriodRow) => (p.adClicks > 0 ? p.registrations / p.adClicks : null);

const COLUMNS: ColDef[] = [
  { id: "period", label: "Ad Date",
    cell: (p) => <span className="text-zinc-200 font-medium">{p.periodLabel}</span> },
  { id: "revenue", label: "Revenue",
    cell: (p) => p.revenue > 0 ? <span className="text-green-400">{fmtMoney(p.revenue, 0)}</span> : <span className="text-zinc-700">—</span> },
  { id: "netProfit", label: "Net Profit",
    cell: (p) => <span className={p.netProfit >= 0 ? "text-green-400" : "text-red-400"}>{fmtMoney(p.netProfit, 0)}</span> },
  { id: "romiTotal", label: "ROMI TOTAL",
    cell: (p) => <span className={`font-medium ${romiClass(p.romi)}`}>{fmtPct(p.romi)}</span> },
  { id: "roas", label: "ROAS",
    cell: (p) => <span className="text-zinc-300">{p.roas === null ? "—" : p.roas.toFixed(2)}</span> },
  { id: "spend", label: "Ad Budget",
    cell: (p) => <span className="text-white">{p.budget > 0 ? fmtMoney(p.budget) : "—"}</span> },
  { id: "adClicks", label: "Ad Clicks",
    cell: (p) => <span className="text-zinc-300">{p.adClicks > 0 ? fmt(p.adClicks) : "—"}</span> },
  { id: "websiteClicks", label: "Website Clicks",
    cell: (p) => <span className="text-zinc-300">{p.websiteClicks > 0 ? fmt(p.websiteClicks) : "—"}</span> },
  { id: "impressions", label: "Impressions",
    cell: (p) => <span className="text-zinc-500">{p.impressions > 0 ? fmt(p.impressions) : "—"}</span> },
  { id: "cpm", label: "CPM",
    cell: (p) => <span className="text-zinc-400">{fmtOptMoney(p.cpm)}</span> },
  { id: "cpc", label: "CPC",
    cell: (p) => <span className="text-zinc-400">{fmtOptMoney(p.cpc)}</span> },
  { id: "ctr", label: "CTR %",
    cell: (p) => <span className="text-zinc-300">{fmtPct(p.ctr)}</span> },
  { id: "crAdToLp", label: "CR% Ad to LP",
    cell: (p) => <span className="text-zinc-300">{fmtPct(p.crAdToLp)}</span> },
  { id: "crLpToChannel", label: "CR% LP to Channel",
    cell: (p) => <span className="text-zinc-300">{fmtPct(p.crLpToChannel)}</span> },
  { id: "registrations", label: "Subscribers",
    cell: (p) => <span className="text-zinc-300">{p.registrations > 0 ? fmt(p.registrations) : "—"}</span> },
  { id: "overallCrLp", label: "Общая CR LP %",
    cell: (p) => <span className="text-zinc-300">{fmtPct(overallCrLp(p))}</span> },
  { id: "costPerSub", label: "Cost per Subscriber",
    cell: (p) => <span className="text-zinc-400">{fmtOptMoney(p.costPerSub)}</span> },
  { id: "dialogs", label: "Dialog MVP",
    cell: (p) => <span className="text-zinc-300">{p.dialogs > 0 ? fmt(p.dialogs) : "—"}</span> },
  { id: "crToDialog", label: "CR% Conversion to Dialog",
    cell: (p) => <span className="text-zinc-300">{fmtPct(p.crToDialog)}</span> },
  { id: "costPerDialog", label: "Total Cost per Dialog",
    cell: (p) => <span className="text-zinc-400">{fmtOptMoney(p.costPerDialog)}</span> },
  { id: "deposits", label: "Number of Deposits",
    cell: (p) => <span className="text-zinc-300">{p.depCountCpa + p.depCountIb > 0 ? fmt(p.depCountCpa + p.depCountIb) : "—"}</span> },
  { id: "depAmount", label: "Total Deposit Amount",
    cell: (p) => p.depAmountCpa + p.depAmountIb > 0 ? <span className="text-green-400">{fmtMoney(p.depAmountCpa + p.depAmountIb, 0)}</span> : <span className="text-zinc-700">—</span> },
  { id: "crDialogToDep", label: "CR% Dialog to Deposit",
    cell: (p) => <span className="text-zinc-300">{fmtPct(p.crDialogToDep)}</span> },
  { id: "payoutsCpa", label: "Number of CPA Payouts",
    cell: (p) => <span className="text-zinc-300">{p.payoutsCpa > 0 ? fmt(p.payoutsCpa) : "—"}</span> },
  { id: "revenueCpa", label: "Revenue from CPA Payouts",
    cell: (p) => p.revenueCpa > 0 ? <span className="text-green-400">{fmtMoney(p.revenueCpa, 0)}</span> : <span className="text-zinc-700">—</span> },
  { id: "cac", label: "CAC",
    cell: (p) => <span className="text-zinc-400">{fmtOptMoney(p.cac)}</span> },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GeneralReportPage() {
  const [source, setSource] = useState<GrSource>("summary");
  const [data, setData] = useState<GrApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [country, setCountry] = useState<string>("all");
  const [preset, setPreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [granularity, setGranularity] = useState<Granularity>("week");

  // Which total cards to show — persisted in localStorage, loaded after mount
  // to avoid SSR/hydration mismatch.
  const [visibleCards, setVisibleCards] = useState<string[]>(DEFAULT_CARDS);
  const [cardsSettingsOpen, setCardsSettingsOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CARDS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        const valid = parsed.filter((id) => CARD_DEFS.some((c) => c.id === id));
        if (valid.length > 0) setVisibleCards(valid);
      }
    } catch { /* corrupted value — keep defaults */ }
  }, []);

  const toggleCard = useCallback((id: string) => {
    setVisibleCards((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      if (next.length === 0) return prev; // keep at least one card
      localStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Which chart panels to show — same persisted-checkbox pattern as visibleCards.
  const [visibleCharts, setVisibleCharts] = useState<string[]>(DEFAULT_CHARTS);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CHARTS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        const valid = parsed.filter((id) => CHART_DEFS.some((c) => c.id === id));
        setVisibleCharts(valid); // valid to be empty — "no charts" is a legitimate choice here
      }
    } catch { /* corrupted value — keep defaults */ }
  }, []);

  const toggleChart = useCallback((id: string) => {
    setVisibleCharts((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      localStorage.setItem(CHARTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const fetchData = useCallback((src: GrSource) => {
    setLoading(true);
    setError(null);
    fetch(`/api/general-report?source=${src}`)
      .then((r) => r.json() as Promise<GrApiResponse>)
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setCountry("all");
    fetchData(source);
  }, [source, fetchData]);

  // Countries that actually have data (26 sheets exist, most are empty)
  const activeCountries = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.rows.map((r) => r.country))].sort((a, b) => a.localeCompare(b, "ru"));
  }, [data]);

  const countryRows = useMemo(() => {
    if (!data) return [];
    return country === "all" ? data.rows : data.rows.filter((r) => r.country === country);
  }, [data, country]);

  // All-time total: respects country filter, ignores date filter — never disappears
  const allTimeTotals = useMemo(() => computeTotals(countryRows), [countryRows]);

  const rangeRows = useMemo(() => {
    const range = preset === "custom"
      ? (customFrom && customTo ? { from: customFrom, to: customTo } : null)
      : presetRange(preset);
    if (!range) return countryRows;
    return countryRows.filter((r) => r.date >= range.from && r.date <= range.to);
  }, [countryRows, preset, customFrom, customTo]);

  const periods = useMemo(() => groupByPeriod(rangeRows, granularity), [rangeRows, granularity]);
  const rangeTotals = useMemo(() => computeTotals(rangeRows), [rangeRows]);

  const chartData: ChartPoint[] = useMemo(() => [...periods].reverse().map((p) => ({
    name: p.periodLabel,
    spend: p.budget,
    revenue: p.revenue,
    romiPct: p.romi === null ? null : p.romi * 100,
    cac: p.cac,
    depCount: p.depCountCpa + p.depCountIb,
    depAmount: p.depAmountCpa + p.depAmountIb,
  })), [periods]);

  const chip = (active: boolean) =>
    `px-4 py-2 rounded-xl text-sm font-semibold transition ${
      active
        ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm"
        : "text-zinc-400 hover:text-violet-300"
    }`;

  const smallChip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
      active
        ? "bg-violet-600 text-white"
        : "bg-[#111118] border border-violet-900/30 text-zinc-400 hover:text-violet-300 hover:border-violet-700/50"
    }`;

  return (
    <main className="min-h-screen bg-[#0a080f] text-white p-8">
      <div className="max-w-[1600px] mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.png" alt="Genesis" className="h-24 md:h-32 w-auto object-contain flex-shrink-0" />
          <div className="w-px h-10 bg-violet-800/40 flex-shrink-0" />
          <span className="text-white text-4xl md:text-5xl font-semibold tracking-wide">General Report 3.0</span>
        </div>

        {/* Navigation */}
        <div className="flex gap-1 mb-6 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 w-fit">
          <Link href="/" className="px-5 py-2 rounded-xl text-sm font-semibold text-zinc-400 hover:text-violet-300 transition">
            Creatives
          </Link>
          <Link href="/check" className="px-5 py-2 rounded-xl text-sm font-semibold text-zinc-400 hover:text-violet-300 transition">
            Checks
          </Link>
          <Link href="/reports" className="px-5 py-2 rounded-xl text-sm font-semibold text-zinc-400 hover:text-violet-300 transition">
            Reports
          </Link>
          <span className="px-5 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm">
            General 3.0
          </span>
        </div>

        {/* Source switcher */}
        <div className="flex gap-1 mb-6 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 w-fit flex-wrap">
          {SOURCES.map((s) => (
            <button key={s.id} onClick={() => setSource(s.id)} className={chip(source === s.id)}>
              {s.label}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-4 animate-pulse">
              <div className="w-10 h-10 rounded-full border-2 border-violet-600/40 border-t-violet-400 animate-spin" />
              <p className="text-violet-300/50 text-sm tracking-widest uppercase">Loading report...</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-5 py-4 text-red-300 text-sm">
            Не удалось загрузить данные: {error}
          </div>
        )}

        {/* Content */}
        {data && !loading && !error && (
          <>
            {/* Meta */}
            <div className="flex items-center gap-4 mb-6 text-xs text-zinc-600 flex-wrap">
              <span>Источник: <span className="text-violet-400 font-medium">Google Sheets API</span></span>
              <span>•</span>
              <span>Строк с данными: <span className="text-zinc-500">{data.rows.length}</span></span>
              <span>•</span>
              <span>Обновлено: <span className="text-zinc-500">{new Date(data.generatedAt).toLocaleString()}</span>{data.fetchedFrom === "cache" ? " (кэш)" : ""}</span>
            </div>

            {/* All-time totals — never affected by date filter; card set is configurable */}
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">
                Тотал за всё время{country !== "all" ? ` · ${country}` : ""}
              </p>
              <button
                onClick={() => setCardsSettingsOpen((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                  cardsSettingsOpen
                    ? "bg-violet-600 text-white border-violet-600"
                    : "bg-[#111118] border-violet-900/30 text-zinc-400 hover:text-violet-300 hover:border-violet-700/50"
                }`}
                title="Настроить карточки"
              >
                <span className="text-sm leading-none">⚙</span>
                Настроить
              </button>
            </div>

            {cardsSettingsOpen && (
              <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-4 mb-4">
                <p className="text-xs text-zinc-600 uppercase tracking-wider mb-3">Какие карточки показывать</p>
                <div className="flex flex-wrap gap-2">
                  {CARD_DEFS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => toggleCard(c.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        visibleCards.includes(c.id)
                          ? "bg-violet-600 text-white"
                          : "bg-[#0f0d18] border border-violet-900/30 text-zinc-500 hover:text-violet-300 hover:border-violet-700/50"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-600 mt-3">Сохраняется в этом браузере. Порядок — как в списке выше.</p>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
              {CARD_DEFS.filter((c) => visibleCards.includes(c.id)).map((c) => (
                <SummaryCard
                  key={c.id}
                  label={c.label}
                  value={c.value(allTimeTotals)}
                  tone={c.tone?.(allTimeTotals)}
                />
              ))}
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-xs text-zinc-600 uppercase tracking-wider mr-1">Период:</span>
              {PRESETS.map((p) => (
                <button key={p.id} onClick={() => setPreset(p.id)} className={smallChip(preset === p.id)}>
                  {p.label}
                </button>
              ))}
              {preset === "custom" && (
                <span className="flex items-center gap-2 ml-1">
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                    className="bg-[#111118] border border-violet-900/40 text-zinc-300 text-xs rounded-xl px-3 py-1.5 outline-none focus:border-violet-600/50 [color-scheme:dark]" />
                  <span className="text-zinc-600">—</span>
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                    className="bg-[#111118] border border-violet-900/40 text-zinc-300 text-xs rounded-xl px-3 py-1.5 outline-none focus:border-violet-600/50 [color-scheme:dark]" />
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-xs text-zinc-600 uppercase tracking-wider mr-1">Группировка:</span>
              {GRANULARITIES.map((g) => (
                <button key={g.id} onClick={() => setGranularity(g.id)} className={smallChip(granularity === g.id)}>
                  {g.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 mb-6 flex-wrap">
              <span className="text-xs text-zinc-600 uppercase tracking-wider mr-1">Страна:</span>
              <button onClick={() => setCountry("all")} className={smallChip(country === "all")}>
                Все ({activeCountries.length})
              </button>
              {activeCountries.map((c) => (
                <button key={c} onClick={() => setCountry(c)} className={smallChip(country === c)}>
                  {c}
                </button>
              ))}
            </div>

            {/* Charts */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-xs text-zinc-600 uppercase tracking-wider mr-1">Графики:</span>
              {CHART_DEFS.map((c) => (
                <button key={c.id} onClick={() => toggleChart(c.id)} className={smallChip(visibleCharts.includes(c.id))}>
                  {visibleCharts.includes(c.id) ? "✓ " : ""}{c.label}
                </button>
              ))}
            </div>

            {chartData.length >= 2 && CHART_DEFS.filter((c) => visibleCharts.includes(c.id)).map((c) => (
              <div key={c.id} className="bg-[#111118] border border-violet-900/20 rounded-2xl p-4 mb-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">{c.label}</p>
                {c.render(chartData)}
              </div>
            ))}

            {/* Table */}
            <div className="bg-[#111118] border border-violet-900/20 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#0f0d18] border-b border-violet-900/20">
                    <tr>
                      {COLUMNS.map((c) => (
                        <th key={c.id} className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-violet-900/10">
                    {periods.map((p) => (
                      <tr key={p.periodKey} className="hover:bg-violet-900/5 transition-colors">
                        {COLUMNS.map((c) => (
                          <td key={c.id} className="px-3 py-2.5 tabular-nums whitespace-nowrap">{c.cell(p)}</td>
                        ))}
                      </tr>
                    ))}
                    {periods.length === 0 && (
                      <tr>
                        <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-zinc-600 text-sm">
                          Нет данных за выбранный период.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {periods.length > 0 && (
                    <tfoot>
                      <tr className="bg-[#0f0d18] border-t-2 border-violet-800/30">
                        {COLUMNS.map((c, i) => (
                          <td key={c.id} className="px-3 py-3 tabular-nums font-semibold whitespace-nowrap">
                            {i === 0
                              ? <span className="text-xs text-violet-400 uppercase tracking-wider">Итог ({periods.length})</span>
                              : c.cell({ ...rangeTotals, periodKey: "total", periodLabel: `Итог (${periods.length})` })}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            <p className="text-zinc-700 text-xs mt-4 text-right">
              General Report 3.0 · v1 · чтение через Sheets API, кэш 5 минут
            </p>
          </>
        )}
      </div>
    </main>
  );
}
