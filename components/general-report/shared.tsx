"use client";

// Общие куски страниц General Report 3.0 и 4.0: форматирование, пресеты дат,
// карточки итогов и графики. Вынесены из страницы 3.0 без изменений — чтобы 4.0
// не держал вторую копию.

import type { ReactNode } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Bar, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { GrTotals } from "@/lib/general-report/types";
import type { Granularity } from "@/lib/general-report/aggregate";

export type DatePreset = "all" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";

// ─── Format helpers ───────────────────────────────────────────────────────────

export function fmt(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtMoney(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return "—";
  return "$" + fmt(n, decimals);
}

export function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return (n * 100).toFixed(1) + "%";
}

export function fmtOptMoney(n: number | null): string {
  return n === null ? "—" : fmtMoney(n);
}

export function romiClass(romi: number | null): string {
  if (romi === null) return "text-zinc-600";
  if (romi >= 0.5) return "text-green-400";
  if (romi >= 0) return "text-yellow-400";
  return "text-red-400";
}

// ─── Date presets ─────────────────────────────────────────────────────────────

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function presetRange(preset: DatePreset): { from: string; to: string } | null {
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

export const PRESETS: { id: DatePreset; label: string }[] = [
  { id: "all",        label: "Всё время" },
  { id: "this_week",  label: "Эта неделя" },
  { id: "last_week",  label: "Прошлая неделя" },
  { id: "this_month", label: "Этот месяц" },
  { id: "last_month", label: "Прошлый месяц" },
  { id: "custom",     label: "Диапазон" },
];

export const GRANULARITIES: { id: Granularity; label: string }[] = [
  { id: "day",   label: "День" },
  { id: "week",  label: "Неделя" },
  { id: "month", label: "Месяц" },
];

// ─── Small components ─────────────────────────────────────────────────────────

export function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
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

export interface CardDef<T> {
  id: string;
  label: string;
  value: (t: T) => string;
  tone?: (t: T) => "good" | "bad" | undefined;
}

export const CARD_DEFS: CardDef<GrTotals>[] = [
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

// ─── Charts ───────────────────────────────────────────────────────────────────

export interface ChartPoint {
  name: string;
  spend: number;
  revenue: number;
  romiPct: number | null;
  cac: number | null;
  depCount: number;
  depAmount: number;
}

export const AXIS_TICK = { fontSize: 11, fill: "#71717a" };
export const AXIS_LINE = { stroke: "rgba(139,92,246,0.2)" };
export const GRID_STROKE = "rgba(139,92,246,0.1)";

// Themed tooltip shared by every chart — pass which dataKeys are money/percent/plain counts.
export function ChartTooltip({
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

export interface ChartDef<T> {
  id: string;
  label: string;
  render: (data: T) => ReactNode;
}

export const CHART_DEFS: ChartDef<ChartPoint[]>[] = [
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

