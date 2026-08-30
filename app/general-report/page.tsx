"use client";

import { useEffect, useState, useMemo, useCallback, type ReactNode } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Bar, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type {
  GrDayRow, GrSource, GrKind, GrPeriodRow, GrTotals,
  WaDayRow, WaPeriodRow, WaTotals,
} from "@/lib/general-report/types";
import { computeTotals, groupByPeriod, computeWaTotals, groupWaByPeriod } from "@/lib/general-report/aggregate";
import type { Granularity } from "@/lib/general-report/aggregate";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GrApiResponse {
  source: GrSource;
  // Что доступно этому человеку — решает сервер по роли, страница только рисует.
  sources?: { id: GrSource; label: string; group: "common" | "buyers"; kind: GrKind }[];
  kind: GrKind;
  rows: GrDayRow[] | WaDayRow[];
  countries: string[];
  generatedAt: string;
  fetchedFrom: "api" | "cache";
  error?: string;
}

type DatePreset = "all" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";

// Список источников приезжает от сервера вместе с данными: он зависит от роли
// и от того, какие таблицы подключены, а не от зашитого здесь перечня. Раньше
// восемь кнопок были прибиты в коде, и новая таблица означала деплой.

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

interface CardDef<T> {
  id: string;
  label: string;
  value: (t: T) => string;
  tone?: (t: T) => "good" | "bad" | undefined;
}

const CARD_DEFS: CardDef<GrTotals>[] = [
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

const WA_CARD_DEFS: CardDef<WaTotals>[] = [
  { id: "spend",         label: "Spend",             value: (t) => fmtMoney(t.budget, 0) },
  { id: "registrations", label: "Регистрации",       value: (t) => fmt(t.registrations) },
  { id: "costPerReg",    label: "Цена регистрации",  value: (t) => fmtOptMoney(t.costPerReg) },
  { id: "applications",  label: "Заявки",            value: (t) => fmt(t.applications) },
  { id: "payments",      label: "Оплаты",            value: (t) => fmt(t.payments), tone: (t) => (t.payments > 0 ? "good" : undefined) },
  { id: "cac",           label: "CAC",               value: (t) => fmtOptMoney(t.cac) },
  { id: "clicks",        label: "Клики",             value: (t) => fmt(t.clicks) },
  { id: "impressions",   label: "Показы",            value: (t) => fmt(t.impressions) },
  { id: "cpm",           label: "CPM",               value: (t) => fmtOptMoney(t.cpm) },
  { id: "cpc",           label: "CPC",               value: (t) => fmtOptMoney(t.cpc) },
  { id: "ctr",           label: "CTR",               value: (t) => fmtPct(t.ctr) },
  { id: "siteCr",        label: "Конверсия сайта",   value: (t) => fmtPct(t.siteCr) },
  { id: "wroteForBonus", label: "Написали за бонусом", value: (t) => fmt(t.wroteForBonus) },
  { id: "enteredBot",    label: "Зашли в бота",      value: (t) => fmt(t.enteredBot) },
  { id: "costPerActivation", label: "Цена активации", value: (t) => fmtOptMoney(t.costPerActivation) },
  { id: "opened1",       label: "Открыли 1 статью",  value: (t) => fmt(t.opened1) },
  { id: "opened2",       label: "Открыли 2 статью",  value: (t) => fmt(t.opened2) },
  { id: "filledForm",    label: "Заполнили анкету",  value: (t) => fmt(t.filledForm) },
  { id: "enteredWeb",    label: "Зашли на веб",      value: (t) => fmt(t.enteredWeb) },
  { id: "costPerWeb",    label: "Стоимость участника", value: (t) => fmtOptMoney(t.costPerWeb) },
  { id: "costPerApp",    label: "Стоимость заявки",  value: (t) => fmtOptMoney(t.costPerApp) },
  { id: "crAppToPay",    label: "CR% заявка → оплата", value: (t) => fmtPct(t.crAppToPay) },
];

const DEFAULT_CARDS = ["spend", "revenue", "netProfit", "romi", "deposits", "cac"];
const WA_DEFAULT_CARDS = ["spend", "registrations", "costPerReg", "applications", "payments", "cac"];
const CARDS_STORAGE_KEY = "gr3.totalCards";
const WA_CARDS_STORAGE_KEY = "gr3.waTotalCards";

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

interface ChartDef<T> {
  id: string;
  label: string;
  render: (data: T) => ReactNode;
}

const CHART_DEFS: ChartDef<ChartPoint[]>[] = [
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

// ─── WA charts ────────────────────────────────────────────────────────────────

interface WaChartPoint {
  name: string;
  spend: number;
  registrations: number;
  costPerReg: number | null;
  applications: number;
  payments: number;
  cac: number | null;
}

// The funnel chart is a snapshot of the selected range rather than a time
// series, so the WA charts get both shapes.
interface WaChartData {
  points: WaChartPoint[];
  totals: WaTotals;
}

const WA_CHART_DEFS: ChartDef<WaChartData>[] = [
  {
    id: "spendRegs",
    label: "Spend vs Регистрации",
    render: ({ points }) => (
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="wa-spend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} minTickGap={24} />
          <YAxis yAxisId="money" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + fmt(v)} width={64} />
          <YAxis yAxisId="count" orientation="right" tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={(props) => <ChartTooltip {...props} money={["spend"]} plain={["registrations"]} />} />
          <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
          <Area yAxisId="money" type="monotone" dataKey="spend" name="Spend" stroke="#8b5cf6" strokeWidth={2} fill="url(#wa-spend)" />
          <Line yAxisId="count" type="monotone" dataKey="registrations" name="Регистрации" stroke="#4ade80" strokeWidth={2} dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    ),
  },
  {
    id: "funnel",
    label: "Воронка за период",
    render: ({ totals }) => {
      const stages = [
        { name: "Клики", value: totals.clicks, fill: "#8b5cf6" },
        { name: "Регистрации", value: totals.registrations, fill: "#a78bfa" },
        { name: "Написали/бот", value: totals.wroteForBonus + totals.enteredBot, fill: "#c4b5fd" },
        { name: "Анкета", value: totals.filledForm, fill: "#818cf8" },
        { name: "Зашли на веб", value: totals.enteredWeb, fill: "#38bdf8" },
        { name: "Заявка", value: totals.applications, fill: "#facc15" },
        { name: "Оплата", value: totals.payments, fill: "#4ade80" },
      ];
      return (
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={stages} layout="vertical" margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_STROKE} horizontal={false} />
            <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} width={110} />
            <Tooltip content={(props) => <ChartTooltip {...props} plain={["value"]} />} />
            <Bar dataKey="value" name="Кол-во" radius={[0, 3, 3, 0]}>
              {stages.map((s, i) => <Cell key={i} fill={s.fill} />)}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      );
    },
  },
  {
    id: "costPerReg",
    label: "Цена регистрации",
    render: ({ points }) => (
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} minTickGap={24} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + fmt(v)} width={64} />
          <Tooltip content={(props) => <ChartTooltip {...props} money={["costPerReg"]} />} />
          <Line type="monotone" dataKey="costPerReg" name="Цена рег." stroke="#38bdf8" strokeWidth={2} dot={{ r: 2 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    ),
  },
  {
    id: "waCac",
    label: "Заявки и оплаты",
    render: ({ points }) => (
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} minTickGap={24} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={(props) => <ChartTooltip {...props} plain={["applications", "payments"]} />} />
          <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
          <Bar dataKey="applications" name="Заявки" fill="#facc15" radius={[3, 3, 0, 0]} />
          <Bar dataKey="payments" name="Оплаты" fill="#4ade80" radius={[3, 3, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    ),
  },
];

const WA_DEFAULT_CHARTS = ["spendRegs", "funnel"];
const WA_CHARTS_STORAGE_KEY = "gr3.waVisibleCharts";

// ─── Table columns ────────────────────────────────────────────────────────────
// Order is the one Daniil specified directly (26.08.2026), matching the exact
// column names from the source sheet (see parseCountrySheet.ts).

interface ColDef<T> {
  id: string;
  label: string;
  cell: (p: T) => ReactNode;
}

// No field in GrTotals for this one — cheap enough to derive inline.
const overallCrLp = (p: GrPeriodRow) => (p.adClicks > 0 ? p.registrations / p.adClicks : null);

const COLUMNS: ColDef<GrPeriodRow>[] = [
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

// WA table columns — the union of both funnel sheets, each in its source
// position. A column belonging to only one sheet reads "—" for the other.
const count = (v: number) => <span className="text-zinc-300">{v > 0 ? fmt(v) : "—"}</span>;
const pct = (v: number | null) => <span className="text-zinc-300">{fmtPct(v)}</span>;
const money = (v: number | null) => <span className="text-zinc-400">{fmtOptMoney(v)}</span>;

const WA_COLUMNS: ColDef<WaPeriodRow>[] = [
  { id: "period", label: "AD DATE",
    cell: (p) => <span className="text-zinc-200 font-medium">{p.periodLabel}</span> },
  { id: "budget", label: "Ad Budget",
    cell: (p) => <span className="text-white">{p.budget > 0 ? fmtMoney(p.budget) : "—"}</span> },
  { id: "clicks", label: "Ad Clicks", cell: (p) => count(p.clicks) },
  { id: "impressions", label: "Impressions",
    cell: (p) => <span className="text-zinc-500">{p.impressions > 0 ? fmt(p.impressions) : "—"}</span> },
  { id: "cpm", label: "CPM", cell: (p) => money(p.cpm) },
  { id: "cpc", label: "CPC", cell: (p) => money(p.cpc) },
  { id: "ctr", label: "CTR %", cell: (p) => pct(p.ctr) },
  { id: "siteCr", label: "% конверсия сайта", cell: (p) => pct(p.siteCr) },
  { id: "registrations", label: "Регистраций",
    cell: (p) => <span className="text-green-400">{p.registrations > 0 ? fmt(p.registrations) : "—"}</span> },
  { id: "costPerReg", label: "Цена регистрации", cell: (p) => money(p.costPerReg) },
  { id: "crRegToWrote", label: "CV % рега - написали", cell: (p) => pct(p.crRegToWrote) },
  { id: "wroteForBonus", label: "Написали за бонусом", cell: (p) => count(p.wroteForBonus) },
  { id: "crRegToBot", label: "CV % рега - зашли в бота", cell: (p) => pct(p.crRegToBot) },
  { id: "enteredBot", label: "Зашли в бота", cell: (p) => count(p.enteredBot) },
  { id: "costPerActivation", label: "Стоимость активации", cell: (p) => money(p.costPerActivation) },
  { id: "crRegToOpen1", label: "CV % рега - открыли 1 статью", cell: (p) => pct(p.crRegToOpen1) },
  { id: "opened1", label: "Открыли 1 статью", cell: (p) => count(p.opened1) },
  { id: "crRegToOpen2", label: "CV % рега - открыли 2 статью", cell: (p) => pct(p.crRegToOpen2) },
  { id: "opened2", label: "Открыли 2 статью", cell: (p) => count(p.opened2) },
  { id: "filledForm", label: "Заполнили анкету", cell: (p) => count(p.filledForm) },
  { id: "crRegToWeb", label: "CV % из регистрации - зашли на веб", cell: (p) => pct(p.crRegToWeb) },
  { id: "enteredWeb", label: "Зашли на веб", cell: (p) => count(p.enteredWeb) },
  { id: "costPerWeb", label: "Стоимость участника", cell: (p) => money(p.costPerWeb) },
  { id: "crWebToApp", label: "CV % зашли на веб - заявка", cell: (p) => pct(p.crWebToApp) },
  { id: "applications", label: "Заявка", cell: (p) => count(p.applications) },
  { id: "costPerApp", label: "Стоимость заявки", cell: (p) => money(p.costPerApp) },
  { id: "crAppToPay", label: "CV % из заявки - оплата", cell: (p) => pct(p.crAppToPay) },
  { id: "payments", label: "Оплат",
    cell: (p) => <span className="text-green-400">{p.payments > 0 ? fmt(p.payments) : "—"}</span> },
  { id: "cac", label: "CAC", cell: (p) => money(p.cac) },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

type AnyPeriodRow = GrPeriodRow | WaPeriodRow;

// Country sheets are labelled by country, WA sheets by funnel name.
const groupLabelOf = (r: GrDayRow | WaDayRow): string => ("country" in r ? r.country : r.funnel);

export default function GeneralReportPage() {
  // "" — «пусть сервер выберет сам». Какой источник оказался активным, видно из
  // ответа: держать это ещё и в состоянии значит получить второй запрос на старте.
  const [source, setSource] = useState<GrSource>("");
  const [data, setData] = useState<GrApiResponse | null>(null);
  // Отдельно от data: список источников обязан пережить ошибку загрузки, иначе
  // из упавшего отчёта нечем переключиться на рабочую таблицу.
  const [sources, setSources] = useState<NonNullable<GrApiResponse["sources"]>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [country, setCountry] = useState<string>("all");
  const [preset, setPreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [granularity, setGranularity] = useState<Granularity>("week");

  // WA has its own metrics, so its cards/charts/columns and their saved
  // selections are kept separate from the country-sheet ones.
  const isWa = data?.kind === "wa";
  // Подсвечено то, по чему кликнули, а не то, что успело загрузиться: иначе
  // кнопка отзывается только после ответа, а при ошибке не отзывается вовсе.
  // Пустая строка на старте — значит выбор ещё за сервером.
  const activeSource = source || data?.source || "";
  const chartDefs = isWa ? WA_CHART_DEFS : CHART_DEFS;
  const cardsKey = isWa ? WA_CARDS_STORAGE_KEY : CARDS_STORAGE_KEY;
  const chartsKey = isWa ? WA_CHARTS_STORAGE_KEY : CHARTS_STORAGE_KEY;

  // Which total cards to show — persisted in localStorage, loaded after mount
  // to avoid SSR/hydration mismatch.
  const [visibleCards, setVisibleCards] = useState<string[]>(DEFAULT_CARDS);
  const [cardsSettingsOpen, setCardsSettingsOpen] = useState(false);

  useEffect(() => {
    const fallback = isWa ? WA_DEFAULT_CARDS : DEFAULT_CARDS;
    const defs = isWa ? WA_CARD_DEFS : CARD_DEFS;
    try {
      const saved = localStorage.getItem(isWa ? WA_CARDS_STORAGE_KEY : CARDS_STORAGE_KEY);
      const parsed = saved ? (JSON.parse(saved) as string[]) : [];
      const valid = parsed.filter((id) => defs.some((c) => c.id === id));
      setVisibleCards(valid.length > 0 ? valid : fallback);
    } catch { setVisibleCards(fallback); }
  }, [isWa]);

  const toggleCard = useCallback((id: string) => {
    setVisibleCards((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      if (next.length === 0) return prev; // keep at least one card
      localStorage.setItem(cardsKey, JSON.stringify(next));
      return next;
    });
  }, [cardsKey]);

  // Which chart panels to show — same persisted-checkbox pattern as visibleCards.
  const [visibleCharts, setVisibleCharts] = useState<string[]>(DEFAULT_CHARTS);

  useEffect(() => {
    const fallback = isWa ? WA_DEFAULT_CHARTS : DEFAULT_CHARTS;
    const defs = isWa ? WA_CHART_DEFS : CHART_DEFS;
    try {
      const saved = localStorage.getItem(isWa ? WA_CHARTS_STORAGE_KEY : CHARTS_STORAGE_KEY);
      // No saved value at all → defaults; a saved empty list is a real "no charts" choice.
      setVisibleCharts(saved ? (JSON.parse(saved) as string[]).filter((id) => defs.some((c) => c.id === id)) : fallback);
    } catch { setVisibleCharts(fallback); }
  }, [isWa]);

  const toggleChart = useCallback((id: string) => {
    setVisibleCharts((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      localStorage.setItem(chartsKey, JSON.stringify(next));
      return next;
    });
  }, [chartsKey]);

  const fetchData = useCallback((src: GrSource) => {
    setLoading(true);
    setError(null);
    fetch(`/api/general-report${src ? `?source=${encodeURIComponent(src)}` : ""}`)
      .then((r) => r.json() as Promise<GrApiResponse>)
      .then((d) => {
        // Сначала список, потом ошибка: роут кладёт источники и в неудачный ответ.
        if (d.sources?.length) setSources(d.sources);
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

  // Country sheets group by country, WA sheets by funnel — one filter drives both.
  const activeCountries = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.rows.map(groupLabelOf))].sort((a, b) => a.localeCompare(b, "ru"));
  }, [data]);

  const countryRows = useMemo(() => {
    if (!data) return [];
    const rows: (GrDayRow | WaDayRow)[] = data.rows;
    return country === "all" ? rows : rows.filter((r) => groupLabelOf(r) === country);
  }, [data, country]);

  const rangeRows = useMemo(() => {
    const range = preset === "custom"
      ? (customFrom && customTo ? { from: customFrom, to: customTo } : null)
      : presetRange(preset);
    if (!range) return countryRows;
    return countryRows.filter((r) => r.date >= range.from && r.date <= range.to);
  }, [countryRows, preset, customFrom, customTo]);

  // isWa gates which of these two parallel sets is real; the other stays empty.
  const grAll  = useMemo(() => (isWa ? [] : (countryRows as GrDayRow[])), [isWa, countryRows]);
  const waAll  = useMemo(() => (isWa ? (countryRows as WaDayRow[]) : []), [isWa, countryRows]);
  const grRange = useMemo(() => (isWa ? [] : (rangeRows as GrDayRow[])), [isWa, rangeRows]);
  const waRange = useMemo(() => (isWa ? (rangeRows as WaDayRow[]) : []), [isWa, rangeRows]);

  // All-time total: respects the country filter, ignores the date filter — never disappears
  const allTimeTotals = useMemo(() => computeTotals(grAll), [grAll]);
  const waAllTimeTotals = useMemo(() => computeWaTotals(waAll), [waAll]);

  const periods = useMemo(() => groupByPeriod(grRange, granularity), [grRange, granularity]);
  const waPeriods = useMemo(() => groupWaByPeriod(waRange, granularity), [waRange, granularity]);
  const rangeTotals = useMemo(() => computeTotals(grRange), [grRange]);
  const waRangeTotals = useMemo(() => computeWaTotals(waRange), [waRange]);

  const chartData: ChartPoint[] = useMemo(() => [...periods].reverse().map((p) => ({
    name: p.periodLabel,
    spend: p.budget,
    revenue: p.revenue,
    romiPct: p.romi === null ? null : p.romi * 100,
    cac: p.cac,
    depCount: p.depCountCpa + p.depCountIb,
    depAmount: p.depAmountCpa + p.depAmountIb,
  })), [periods]);

  const waChartData: WaChartData = useMemo(() => ({
    points: [...waPeriods].reverse().map((p) => ({
      name: p.periodLabel,
      spend: p.budget,
      registrations: p.registrations,
      costPerReg: p.costPerReg,
      applications: p.applications,
      payments: p.payments,
      cac: p.cac,
    })),
    totals: waRangeTotals,
  }), [waPeriods, waRangeTotals]);

  // View models — one shape for the JSX regardless of which kind is loaded.
  // The casts are safe because isWa picks the row type and the defs together.
  const periodRows = (isWa ? waPeriods : periods) as AnyPeriodRow[];
  const activeColumns = (isWa ? WA_COLUMNS : COLUMNS) as unknown as ColDef<AnyPeriodRow>[];
  const activeCards = (isWa ? WA_CARD_DEFS : CARD_DEFS) as unknown as CardDef<GrTotals | WaTotals>[];
  const cardTotals: GrTotals | WaTotals = isWa ? waAllTimeTotals : allTimeTotals;
  const footTotals = {
    ...(isWa ? waRangeTotals : rangeTotals),
    periodKey: "total",
    periodLabel: `Итог (${periodRows.length})`,
  } as AnyPeriodRow;

  const chartPanels = (isWa ? WA_CHART_DEFS : CHART_DEFS)
    .filter((c) => visibleCharts.includes(c.id))
    .map((c) => ({
      id: c.id,
      label: c.label,
      node: isWa
        ? (c as ChartDef<WaChartData>).render(waChartData)
        : (c as ChartDef<ChartPoint[]>).render(chartData),
    }));

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

        <h1 className="text-white text-3xl font-semibold tracking-wide mb-6">General Report 3.0</h1>

        {/* Переключатель источников. Что в нём есть — решает сервер по роли. */}
        <div className="flex flex-col gap-3 mb-6">
          {([
            ["common", "Таблицы"],
            ["buyers", "Баеры"],
          ] as const).map(([group, label]) => {
            const groupSources = sources.filter((s) => s.group === group);
            if (groupSources.length === 0) return null;
            return (
              <div key={group} className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-zinc-600 uppercase tracking-wider w-20">{label}</span>
                <div className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 w-fit flex-wrap">
                  {groupSources.map((s) => (
                    <button key={s.id} onClick={() => setSource(s.id)} className={chip(activeSource === s.id)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
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
                  {activeCards.map((c) => (
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
              {activeCards.filter((c) => visibleCards.includes(c.id)).map((c) => (
                <SummaryCard
                  key={c.id}
                  label={c.label}
                  value={c.value(cardTotals)}
                  tone={c.tone?.(cardTotals)}
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
              <span className="text-xs text-zinc-600 uppercase tracking-wider mr-1">{isWa ? "Воронка:" : "Страна:"}</span>
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
              {chartDefs.map((c) => (
                <button key={c.id} onClick={() => toggleChart(c.id)} className={smallChip(visibleCharts.includes(c.id))}>
                  {visibleCharts.includes(c.id) ? "✓ " : ""}{c.label}
                </button>
              ))}
            </div>

            {periodRows.length >= 2 && chartPanels.map((c) => (
              <div key={c.id} className="bg-[#111118] border border-violet-900/20 rounded-2xl p-4 mb-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">{c.label}</p>
                {c.node}
              </div>
            ))}

            {/* Table */}
            <div className="bg-[#111118] border border-violet-900/20 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#0f0d18] border-b border-violet-900/20">
                    <tr>
                      {activeColumns.map((c) => (
                        <th key={c.id} className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-violet-900/10">
                    {periodRows.map((p) => (
                      <tr key={p.periodKey} className="hover:bg-violet-900/5 transition-colors">
                        {activeColumns.map((c) => (
                          <td key={c.id} className="px-3 py-2.5 tabular-nums whitespace-nowrap">{c.cell(p)}</td>
                        ))}
                      </tr>
                    ))}
                    {periodRows.length === 0 && (
                      <tr>
                        <td colSpan={activeColumns.length} className="px-4 py-12 text-center text-zinc-600 text-sm">
                          Нет данных за выбранный период.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {periodRows.length > 0 && (
                    <tfoot>
                      <tr className="bg-[#0f0d18] border-t-2 border-violet-800/30">
                        {activeColumns.map((c, i) => (
                          <td key={c.id} className="px-3 py-3 tabular-nums font-semibold whitespace-nowrap">
                            {i === 0
                              ? <span className="text-xs text-violet-400 uppercase tracking-wider">Итог ({periodRows.length})</span>
                              : c.cell(footTotals)}
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
