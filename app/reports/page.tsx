"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import type { ReportRow, ReportSummary, SourceStatus } from "@/lib/reports/types";
import LiveAutoReport from "./LiveAutoReport";

// ─── Types ────────────────────────────────────────────────────────────────────

// Only the Manual mode produces this now — Auto renders <LiveAutoReport /> instead.
interface ReportData {
  rows: ReportRow[];
  summary: ReportSummary;
  generatedAt: string;
  dataFile: { mvp: string; fbtool: string };
}

interface FilteredTotals {
  spend: number;
  clicks: number;
  impressions: number;
  pdp: number;
  dia: number;
  deposits: number;
  revenue: number;
  costPdp: number | null;
  costDia: number | null;
  romi: number | null;
}

type SortField = keyof Pick<
  ReportRow,
  "spend" | "clicks" | "impressions" | "pdp" | "dia" | "deposits" | "revenue" | "costPdp" | "costDia" | "romi"
>;
type SortDir      = "asc" | "desc";
type ActivityFilter = "all" | "active" | "paused" | "other";
type ReportMode   = "auto" | "manual";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "-";
  return "$" + fmt(n, 2);
}

function fmtOpt(n: number | null, prefix = "", suffix = "", decimals = 2): string {
  if (n === null || !Number.isFinite(n)) return "-";
  return prefix + fmt(n, decimals) + suffix;
}

const SOURCE_LABELS: Record<SourceStatus, string> = {
  matched:           "Matched",
  mvp_only:          "CRM only",
  fbtool_spend_only: "FB only",
};

const SOURCE_COLORS: Record<SourceStatus, string> = {
  matched:           "bg-violet-900/40 text-violet-300 border-violet-700/40",
  mvp_only:          "bg-blue-900/30 text-blue-300 border-blue-700/30",
  fbtool_spend_only: "bg-amber-900/30 text-amber-300 border-amber-700/30",
};

function campaignStatusClass(s: string): string {
  const u = s.toUpperCase();
  if (u === "ACTIVE")  return "bg-green-900/30 text-green-400 border-green-800/30";
  if (u === "PAUSED")  return "bg-amber-900/30 text-amber-400 border-amber-800/30";
  if (u)               return "bg-zinc-800/40 text-zinc-400 border-zinc-700/30";
  return "";
}

function matchesActivityFilter(effectiveStatus: string, filter: ActivityFilter): boolean {
  if (filter === "all") return true;
  const u = effectiveStatus.toUpperCase();
  if (filter === "active") return u === "ACTIVE";
  if (filter === "paused") return u === "PAUSED";
  return u !== "" && u !== "ACTIVE" && u !== "PAUSED"; // "other"
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, warning }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className={`bg-[#111118] border rounded-xl px-4 py-3 flex flex-col gap-1 ${
      warning ? "border-amber-700/40" : "border-violet-900/30"
    }`}>
      <div className="text-zinc-500 text-xs uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${warning ? "text-amber-300" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}

function SortIcon({ field, sortField, sortDir }: { field: string; sortField: string; sortDir: SortDir }) {
  if (field !== sortField) return <span className="text-zinc-700 ml-1">↕</span>;
  return <span className="text-violet-400 ml-1">{sortDir === "desc" ? "↓" : "↑"}</span>;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ReportMode>("auto");
  const [mvpFile, setMvpFile]       = useState<File | null>(null);
  const [fbtoolFile, setFbtoolFile] = useState<File | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SourceStatus | "all">("all");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [sortField, setSortField] = useState<SortField>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const buildManualReport = useCallback(() => {
    if (!mvpFile || !fbtoolFile) return;
    setLoading(true);
    setError(null);
    setData(null);
    const fd = new FormData();
    fd.append("mvpFile", mvpFile);
    fd.append("fbtoolFile", fbtoolFile);
    fetch("/api/reports/manual", { method: "POST", body: fd })
      .then((r) => {
        if (!r.ok) return r.json().then((b: { error?: string }) => { throw new Error(b.error ?? `HTTP ${r.status}`); });
        return r.json() as Promise<ReportData>;
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [mvpFile, fbtoolFile]);

  const handleModeSwitch = useCallback((newMode: ReportMode) => {
    if (newMode === "manual") setLoading(false);
    setMode(newMode);
    setData(null);
    setError(null);
    setMvpFile(null);
    setFbtoolFile(null);
  }, []);

  useEffect(() => {
    // Auto mode now renders <LiveAutoReport /> (Meta API + CRM), which manages
    // its own fetch/loading state — nothing to trigger here for it anymore.
    setLoading(false);
  }, [mode]);

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
        return prev;
      }
      setSortDir("desc");
      return field;
    });
  }, []);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    let rows = data.rows;

    if (statusFilter !== "all") {
      rows = rows.filter((r) => r.sourceStatus === statusFilter);
    }

    if (activityFilter !== "all") {
      rows = rows.filter((r) => matchesActivityFilter(r.effectiveStatus, activityFilter));
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.campaignName.toLowerCase().includes(q) ||
          r.campaignId.includes(q) ||
          r.accountName.toLowerCase().includes(q)
      );
    }

    return [...rows].sort((a, b) => {
      const av = typeof a[sortField] === "number" ? (a[sortField] as number) : -Infinity;
      const bv = typeof b[sortField] === "number" ? (b[sortField] as number) : -Infinity;
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [data, statusFilter, activityFilter, search, sortField, sortDir]);

  const totals = useMemo<FilteredTotals>(() => {
    const spend       = filteredRows.reduce((s, r) => s + r.spend, 0);
    const clicks      = filteredRows.reduce((s, r) => s + r.clicks, 0);
    const impressions = filteredRows.reduce((s, r) => s + r.impressions, 0);
    const pdp         = filteredRows.reduce((s, r) => s + r.pdp, 0);
    const dia         = filteredRows.reduce((s, r) => s + r.dia, 0);
    const deposits    = filteredRows.reduce((s, r) => s + r.deposits, 0);
    const revenue     = filteredRows.reduce((s, r) => s + r.revenue, 0);
    return {
      spend, clicks, impressions, pdp, dia, deposits, revenue,
      costPdp: spend > 0 && pdp > 0 ? spend / pdp : null,
      costDia: spend > 0 && dia > 0 ? spend / dia : null,
      romi:    spend > 0 ? (revenue - spend) / spend * 100 : null,
    };
  }, [filteredRows]);

  const Th = ({ label, field }: { label: string; field?: SortField }) => (
    <th
      className={`px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap ${
        field ? "cursor-pointer select-none hover:text-violet-400 transition" : ""
      }`}
      onClick={field ? () => handleSort(field) : undefined}
    >
      {label}
      {field && <SortIcon field={field} sortField={sortField} sortDir={sortDir} />}
    </th>
  );

  return (
    <main className="min-h-screen bg-[#0a080f] text-white p-8">
      <div className="max-w-[1600px] mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.png" alt="Genesis" className="h-24 md:h-32 w-auto object-contain flex-shrink-0" />
          <div className="w-px h-10 bg-violet-800/40 flex-shrink-0" />
          <span className="text-white text-4xl md:text-5xl font-semibold tracking-wide">Reports</span>
        </div>

        {/* Navigation */}
        <div className="flex gap-1 mb-8 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 w-fit">
          <Link href="/" className="px-5 py-2 rounded-xl text-sm font-semibold text-zinc-400 hover:text-violet-300 transition">
            Creatives
          </Link>
          <Link href="/check" className="px-5 py-2 rounded-xl text-sm font-semibold text-zinc-400 hover:text-violet-300 transition">
            Checks
          </Link>
          <span className="px-5 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm">
            Reports
          </span>
          <Link href="/general-report" className="px-5 py-2 rounded-xl text-sm font-semibold text-zinc-400 hover:text-violet-300 transition">
            General 3.0
          </Link>
        </div>

        {/* Mode switch */}
        <div className="flex gap-1 mb-6 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 w-fit">
          {(["auto", "manual"] as ReportMode[]).map((m) => (
            <button
              key={m}
              onClick={() => handleModeSwitch(m)}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition ${
                mode === m
                  ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm"
                  : "text-zinc-400 hover:text-violet-300"
              }`}
            >
              {m === "auto" ? "Auto Report" : "Manual Report"}
            </button>
          ))}
        </div>

        {/* Auto Report — live Meta Marketing API + CRM, replaces FBTool */}
        {mode === "auto" && <LiveAutoReport />}

        {/* Manual upload panel */}
        {mode === "manual" && !loading && (
          <div className="bg-[#111118] border border-violet-900/20 rounded-2xl p-6 mb-6">
            <div className="flex flex-col sm:flex-row gap-4 mb-5">
              <div className="flex-1">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">MVP File (XLSX)</p>
                <label className="flex items-center gap-3 bg-[#0f0d18] border border-violet-900/30 rounded-xl px-4 py-3 cursor-pointer hover:border-violet-700/50 transition">
                  <span className="text-xs text-zinc-400 truncate">{mvpFile ? mvpFile.name : "Choose file..."}</span>
                  <input
                    type="file"
                    accept=".xlsx,.csv"
                    className="hidden"
                    onChange={(e) => setMvpFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              <div className="flex-1">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">FBTool File (XLSX)</p>
                <label className="flex items-center gap-3 bg-[#0f0d18] border border-violet-900/30 rounded-xl px-4 py-3 cursor-pointer hover:border-violet-700/50 transition">
                  <span className="text-xs text-zinc-400 truncate">{fbtoolFile ? fbtoolFile.name : "Choose file..."}</span>
                  <input
                    type="file"
                    accept=".xlsx,.csv"
                    className="hidden"
                    onChange={(e) => setFbtoolFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </div>
            <button
              onClick={buildManualReport}
              disabled={!mvpFile || !fbtoolFile}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:from-violet-500 hover:to-violet-400 transition"
            >
              Build Report
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-4 animate-pulse">
              <div className="w-10 h-10 rounded-full border-2 border-violet-600/40 border-t-violet-400 animate-spin" />
              <p className="text-violet-300/50 text-sm tracking-widest uppercase">Building report...</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-5 py-4 text-red-300 text-sm">
            Failed to load report data: {error}
          </div>
        )}

        {/* Content */}
        {data && !loading && (
          <>
            {/* Meta bar */}
            <div className="flex items-center gap-4 mb-6 text-xs text-zinc-600 flex-wrap">
              <span>MVP: <span className="text-zinc-500">{data.dataFile.mvp}</span></span>
              <span>•</span>
              <span>FBTool: <span className="text-zinc-500">{data.dataFile.fbtool}</span></span>
              <span>•</span>
              <span>Generated: <span className="text-zinc-500">{new Date(data.generatedAt).toLocaleString()}</span></span>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
              <SummaryCard label="Total Spend"        value={fmtMoney(data.summary.totalSpend)} />
              <SummaryCard label="Total Clicks"       value={fmt(data.summary.totalClicks)} />
              <SummaryCard label="Total Impressions"  value={fmt(data.summary.totalImpressions)} />
              <SummaryCard label="Total PDP"          value={fmt(data.summary.totalPdp)} />
              <SummaryCard label="Total DIA"          value={fmt(data.summary.totalDia)} />
              <SummaryCard label="Total Deposits"     value={fmt(data.summary.totalDeposits)} />
              <SummaryCard label="Total Revenue"      value={fmtMoney(data.summary.totalRevenue)} />
              <SummaryCard label="Avg Cost PDP"       value={fmtOpt(data.summary.avgCostPdp, "$")} />
              <SummaryCard label="Avg Cost DIA"       value={fmtOpt(data.summary.avgCostDia, "$")} />
              <SummaryCard label="ROMI"               value={fmtOpt(data.summary.romi, "", "%", 1)} />
              <SummaryCard label="FB-only (warnings)" value={String(data.summary.warningsCount)} warning={data.summary.warningsCount > 0} />
              <SummaryCard label="Total Campaigns"    value={String(data.rows.length)} />
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap mb-4">
              <input
                type="text"
                placeholder="Search by name or campaign ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-[#111118] border border-violet-900/40 rounded-xl px-4 py-2 text-sm outline-none focus:border-violet-600/50 transition placeholder:text-zinc-600 w-72"
              />

              <div className="flex items-center gap-1">
                {(["all", "matched", "mvp_only", "fbtool_spend_only"] as const).map((s) => {
                  const labels = {
                    all:               `All (${data.rows.length})`,
                    matched:           `Matched (${data.rows.filter((r) => r.sourceStatus === "matched").length})`,
                    mvp_only:          `CRM only (${data.rows.filter((r) => r.sourceStatus === "mvp_only").length})`,
                    fbtool_spend_only: `FB only (${data.rows.filter((r) => r.sourceStatus === "fbtool_spend_only").length})`,
                  };
                  return (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        statusFilter === s
                          ? "bg-violet-600 text-white"
                          : "bg-[#111118] text-zinc-400 hover:text-violet-300 border border-violet-900/30 hover:border-violet-600/40"
                      }`}
                    >
                      {labels[s]}
                    </button>
                  );
                })}
              </div>

              {(search || statusFilter !== "all" || activityFilter !== "all") && (
                <button
                  onClick={() => { setSearch(""); setStatusFilter("all"); setActivityFilter("all"); }}
                  className="px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-violet-300 border border-violet-900/30 hover:border-violet-600/40 transition"
                >
                  Reset
                </button>
              )}

              <span className="text-zinc-600 text-xs ml-auto">
                {filteredRows.length} / {data.rows.length} campaigns
              </span>
            </div>

            {/* Activity filter */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-zinc-600 text-xs uppercase tracking-wider">Status:</span>
              {(["all", "active", "paused", "other"] as const).map((a) => {
                const actLabels: Record<ActivityFilter, string> = {
                  all:    `All`,
                  active: `Active`,
                  paused: `Paused`,
                  other:  `Other`,
                };
                const actCount: Record<ActivityFilter, number> = {
                  all:    data.rows.length,
                  active: data.rows.filter((r) => matchesActivityFilter(r.effectiveStatus, "active")).length,
                  paused: data.rows.filter((r) => matchesActivityFilter(r.effectiveStatus, "paused")).length,
                  other:  data.rows.filter((r) => matchesActivityFilter(r.effectiveStatus, "other")).length,
                };
                return (
                  <button
                    key={a}
                    onClick={() => setActivityFilter(a)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      activityFilter === a
                        ? a === "active" ? "bg-green-700/60 text-green-200"
                          : a === "paused" ? "bg-amber-700/60 text-amber-200"
                          : "bg-violet-600 text-white"
                        : "bg-[#111118] text-zinc-400 hover:text-violet-300 border border-violet-900/30 hover:border-violet-600/40"
                    }`}
                  >
                    {actLabels[a]} ({actCount[a]})
                  </button>
                );
              })}
            </div>

            {/* Table */}
            <div className="bg-[#111118] border border-violet-900/20 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#0f0d18] border-b border-violet-900/20">
                    <tr>
                      <Th label="Campaign Name" />
                      <Th label="Campaign ID" />
                      <Th label="Account" />
                      <Th label="Status" />
                      <Th label="Eff. Status" />
                      <Th label="Spend"       field="spend" />
                      <Th label="Clicks"      field="clicks" />
                      <Th label="Impr."       field="impressions" />
                      <Th label="PDP"         field="pdp" />
                      <Th label="DIA"         field="dia" />
                      <Th label="Deposits"    field="deposits" />
                      <Th label="Revenue"     field="revenue" />
                      <Th label="Cost PDP"    field="costPdp" />
                      <Th label="Cost DIA"    field="costDia" />
                      <Th label="ROMI"        field="romi" />
                      <Th label="Source" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-violet-900/10">
                    {filteredRows.map((row) => (
                      <tr key={row.campaignId} className="hover:bg-violet-900/5 transition-colors">
                        <td className="px-3 py-2.5 text-zinc-200 max-w-[240px]">
                          <span className="block truncate" title={row.campaignName}>
                            {row.campaignName || <span className="text-zinc-600 italic">—</span>}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-zinc-500 font-mono text-xs whitespace-nowrap">
                          {row.campaignId}
                        </td>
                        <td className="px-3 py-2.5 text-zinc-400 max-w-[160px]">
                          <span className="block truncate" title={row.accountName}>
                            {row.accountName || <span className="text-zinc-600">—</span>}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {row.status
                            ? <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium border ${campaignStatusClass(row.status)}`}>{row.status}</span>
                            : <span className="text-zinc-700">—</span>}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {row.effectiveStatus
                            ? <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium border ${campaignStatusClass(row.effectiveStatus)}`}>{row.effectiveStatus}</span>
                            : <span className="text-zinc-700">—</span>}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">
                          {row.spend > 0 ? <span className="text-white font-medium">${fmt(row.spend, 2)}</span> : <span className="text-zinc-700">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-zinc-300 tabular-nums whitespace-nowrap">
                          {row.clicks > 0 ? fmt(row.clicks) : <span className="text-zinc-700">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-zinc-500 tabular-nums whitespace-nowrap">
                          {row.impressions > 0 ? fmt(row.impressions) : <span className="text-zinc-700">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-zinc-300 tabular-nums">
                          {row.pdp > 0 ? fmt(row.pdp) : <span className="text-zinc-700">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-zinc-300 tabular-nums">
                          {row.dia > 0 ? fmt(row.dia) : <span className="text-zinc-700">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-zinc-300 tabular-nums">
                          {row.deposits > 0 ? fmt(row.deposits) : <span className="text-zinc-700">—</span>}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">
                          {row.revenue > 0 ? <span className="text-green-400">${fmt(row.revenue, 0)}</span> : <span className="text-zinc-700">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-zinc-400 tabular-nums whitespace-nowrap">
                          {fmtOpt(row.costPdp, "$")}
                        </td>
                        <td className="px-3 py-2.5 text-zinc-400 tabular-nums whitespace-nowrap">
                          {fmtOpt(row.costDia, "$")}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">
                          {row.romi !== null ? (
                            <span className={
                              row.romi >= 150 ? "text-green-400 font-medium" :
                              row.romi >= 0   ? "text-yellow-400" :
                                               "text-red-400"
                            }>
                              {fmt(row.romi, 1)}%
                            </span>
                          ) : (
                            <span className="text-zinc-700">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium border ${SOURCE_COLORS[row.sourceStatus]}`}>
                            {SOURCE_LABELS[row.sourceStatus]}
                          </span>
                        </td>
                      </tr>
                    ))}

                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={16} className="px-4 py-12 text-center text-zinc-600 text-sm">
                          No campaigns match the current filter.
                        </td>
                      </tr>
                    )}
                  </tbody>

                  {/* Footer totals — recalculated from filtered rows */}
                  {filteredRows.length > 0 && (
                    <tfoot>
                      <tr className="bg-[#0f0d18] border-t-2 border-violet-800/30">
                        <td className="px-3 py-3 text-xs font-semibold text-violet-400 uppercase tracking-wider whitespace-nowrap">
                          Totals ({filteredRows.length})
                        </td>
                        <td className="px-3 py-3" />
                        <td className="px-3 py-3" />
                        <td className="px-3 py-3" />
                        <td className="px-3 py-3" />
                        <td className="px-3 py-3 text-white font-semibold tabular-nums whitespace-nowrap">
                          {totals.spend > 0 ? `$${fmt(totals.spend, 2)}` : "—"}
                        </td>
                        <td className="px-3 py-3 text-zinc-300 font-semibold tabular-nums whitespace-nowrap">
                          {totals.clicks > 0 ? fmt(totals.clicks) : "—"}
                        </td>
                        <td className="px-3 py-3 text-zinc-400 font-semibold tabular-nums whitespace-nowrap">
                          {totals.impressions > 0 ? fmt(totals.impressions) : "—"}
                        </td>
                        <td className="px-3 py-3 text-zinc-300 font-semibold tabular-nums">
                          {totals.pdp > 0 ? fmt(totals.pdp) : "—"}
                        </td>
                        <td className="px-3 py-3 text-zinc-300 font-semibold tabular-nums">
                          {totals.dia > 0 ? fmt(totals.dia) : "—"}
                        </td>
                        <td className="px-3 py-3 text-zinc-300 font-semibold tabular-nums">
                          {totals.deposits > 0 ? fmt(totals.deposits) : "—"}
                        </td>
                        <td className="px-3 py-3 font-semibold tabular-nums whitespace-nowrap">
                          {totals.revenue > 0 ? <span className="text-green-400">${fmt(totals.revenue, 0)}</span> : "—"}
                        </td>
                        <td className="px-3 py-3 text-zinc-300 font-semibold tabular-nums whitespace-nowrap">
                          {fmtOpt(totals.costPdp, "$")}
                        </td>
                        <td className="px-3 py-3 text-zinc-300 font-semibold tabular-nums whitespace-nowrap">
                          {fmtOpt(totals.costDia, "$")}
                        </td>
                        <td className="px-3 py-3 font-semibold tabular-nums whitespace-nowrap">
                          {totals.romi !== null ? (
                            <span className={
                              totals.romi >= 150 ? "text-green-400" :
                              totals.romi >= 0   ? "text-yellow-400" :
                                                  "text-red-400"
                            }>
                              {fmt(totals.romi, 1)}%
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-3" />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            <p className="text-zinc-700 text-xs mt-4 text-right">
              Reports v1.1 · test-data · real API not connected
            </p>
          </>
        )}
      </div>
    </main>
  );
}
