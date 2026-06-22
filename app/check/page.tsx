"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import {
  parseFB, parseMVP, aggregateFBItems, aggregateMVPItems,
  formatMoney, formatPlainNumber, formatBudget,
} from "@/lib/forex-check/parse";
import { buildCheckFromItems, buildRows, filterRows, sumField, uniqueValues } from "@/lib/forex-check/analysis";
import type { CheckRow, EntityMode, BuildResult } from "@/lib/forex-check/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type AppStatus = "idle" | "loading" | "ready" | "error";
type CheckTab = "check" | "sum" | "mismatch";
type SortState = { col: keyof CheckRow; dir: "asc" | "desc" } | null;

interface ColDef {
  key: keyof CheckRow;
  label: string;
  fmt?: (v: unknown) => string;
}

// ─── Column definitions ───────────────────────────────────────────────────────

const fmtMoney = (v: unknown) => v !== null && v !== undefined ? formatMoney(Number(v)) : "—";
const fmtNum = (v: unknown) => v !== null && v !== undefined ? formatPlainNumber(v) : "—";
const fmtRow = (v: unknown) => v !== null && v !== undefined ? String(v) : "—";

const SUM_COLS: ColDef[] = [
  { key: "status", label: "Статус" },
  { key: "title", label: "Название" },
  { key: "geo", label: "Гео" },
  { key: "date", label: "Дата" },
  { key: "cabinet", label: "Кабинет/T2A" },
  { key: "budget", label: "Бюджет" },
  { key: "spend", label: "Расход", fmt: fmtMoney },
  { key: "sub", label: "ПДП", fmt: fmtNum },
  { key: "chat", label: "Диа", fmt: fmtNum },
  { key: "deposits", label: "Депозиты", fmt: fmtMoney },
  { key: "websiteClicks", label: "Клики сайт", fmt: fmtNum },
  { key: "costPerSub", label: "Цена ПДП", fmt: fmtMoney },
  { key: "costPerChat", label: "Цена диа", fmt: fmtMoney },
  { key: "fbClicks", label: "Клики FB", fmt: fmtNum },
  { key: "views", label: "Просмотры", fmt: fmtNum },
];

const MISMATCH_COLS: ColDef[] = [
  { key: "status", label: "Статус" },
  { key: "title", label: "Название" },
  { key: "geo", label: "Гео" },
  { key: "date", label: "Дата" },
  { key: "spend", label: "Расход", fmt: fmtMoney },
  { key: "sub", label: "ПДП", fmt: fmtNum },
  { key: "chat", label: "Диа", fmt: fmtNum },
  { key: "deposits", label: "Депозиты", fmt: fmtMoney },
  { key: "websiteClicks", label: "Клики сайт", fmt: fmtNum },
  { key: "fbRow", label: "FB строка", fmt: fmtRow },
  { key: "mvpRow", label: "MVP строка", fmt: fmtRow },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readSheets(file: File) {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  return wb.SheetNames.map((name) => ({
    sheetName: name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1, raw: true, defval: null, blankrows: false,
    }) as unknown[][],
  }));
}

function sortRows(rows: CheckRow[], sort: SortState): CheckRow[] {
  if (!sort) return rows;
  const { col, dir } = sort;
  const d = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[col], bv = b[col];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * d;
    return String(av).localeCompare(String(bv), "ru", { numeric: true }) * d;
  });
}

function rowHighlight(status: string): string {
  if (status.includes("ФБ, нет в MVP")) return "border-l-2 border-l-yellow-500/60 bg-yellow-500/5";
  if (status.includes("MVP, нет в ФБ")) return "border-l-2 border-l-red-500/60 bg-red-500/5";
  return "";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FileBox({
  id, label, optional, onChange, fileName,
}: {
  id: string; label: string; optional?: boolean; onChange: (f: File | null) => void; fileName: string | null;
}) {
  return (
    <label
      htmlFor={id}
      className="flex flex-col gap-2 p-4 rounded-xl border border-dashed border-violet-800/50 bg-[#18181f] hover:border-violet-600/70 cursor-pointer transition group"
    >
      <span className="text-xs text-zinc-400 font-medium">
        {label}
        {optional && <span className="ml-1 text-zinc-600">(опционально)</span>}
      </span>
      <input id={id} type="file" accept=".xlsx,.xls" className="sr-only" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      <span className="text-sm text-violet-300 group-hover:text-violet-200 truncate">
        {fileName ?? (optional ? "можно не выбирать" : "файл не выбран")}
      </span>
    </label>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 p-3 rounded-xl bg-[#18181f] border border-violet-900/30">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-base font-semibold text-white">{value}</span>
    </div>
  );
}

function DataTable({
  cols, rows, sort, onSort,
}: {
  cols: ColDef[];
  rows: CheckRow[];
  sort: SortState;
  onSort: (col: keyof CheckRow) => void;
}) {
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  if (!sorted.length) {
    return <p className="text-zinc-500 text-sm py-6 text-center">Нет данных</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-violet-900/30">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-[#18181f]">
            {cols.map((col) => {
              const active = sort?.col === col.key;
              return (
                <th
                  key={col.key}
                  onClick={() => onSort(col.key)}
                  className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wide whitespace-nowrap cursor-pointer hover:text-violet-300 select-none border-b border-violet-900/30"
                >
                  {col.label}
                  <span className="ml-1 text-zinc-600">
                    {active ? (sort!.dir === "asc" ? "↑" : "↓") : "↕"}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className={`border-b border-violet-900/20 hover:bg-violet-900/10 ${rowHighlight(row.status)}`}>
              {cols.map((col) => {
                const raw = row[col.key];
                const display = col.fmt ? col.fmt(raw) : raw !== null && raw !== undefined ? String(raw) : "—";
                return (
                  <td key={col.key} className="px-3 py-2 text-zinc-300 whitespace-nowrap max-w-[280px] truncate">
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MultiSelect({
  label, options, value, onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  if (!options.length) return null;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-500">{label}</span>
      <select
        multiple
        size={Math.min(options.length, 5)}
        value={value}
        onChange={(e) => onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}
        className="rounded-lg border border-violet-900/40 bg-[#18181f] text-zinc-300 text-sm px-2 py-1 focus:outline-none focus:border-violet-500/60"
      >
        {options.map((o) => (
          <option key={o} value={o} className="py-0.5">{o}</option>
        ))}
      </select>
    </label>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CheckPage() {
  // Files
  const [fbFile, setFbFile] = useState<File | null>(null);
  const [mvpFile, setMvpFile] = useState<File | null>(null);
  const [mvpAdsFile, setMvpAdsFile] = useState<File | null>(null);
  const [adsFile, setAdsFile] = useState<File | null>(null);

  // Settings
  const [entityMode, setEntityMode] = useState<EntityMode>("auto");
  const [warnMvpOnly, setWarnMvpOnly] = useState(true);

  // App state
  const [appStatus, setAppStatus] = useState<AppStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [data, setData] = useState<BuildResult | null>(null);

  // Tab
  const [activeTab, setActiveTab] = useState<CheckTab>("check");

  // Sum tab filters
  const [pinnedNames, setPinnedNames] = useState<string[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [selGeos, setSelGeos] = useState<string[]>([]);
  const [selDates, setSelDates] = useState<string[]>([]);
  const [selCabinets, setSelCabinets] = useState<string[]>([]);

  // Sort states per tab
  const [sumSort, setSumSort] = useState<SortState>(null);
  const [mismatchSort, setMismatchSort] = useState<SortState>(null);

  // Copy button feedback
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Build ──────────────────────────────────────────────────────────────────

  const handleBuild = useCallback(async () => {
    if (!fbFile) { setErrorMsg("Сначала загрузи основной FB-файл."); return; }
    setAppStatus("loading");
    setErrorMsg(null);
    try {
      const fbSheets = await readSheets(fbFile);
      const fbParsed = parseFB(fbSheets, { entity: entityMode, includeZeroSpend: false });
      const fbItems = aggregateFBItems(fbParsed.items);
      const resolvedEntity = fbParsed.resolvedEntity;

      let mvpItems = aggregateMVPItems([]);
      let checkText = "MVP-файл не загружен — готовый чек пока не сформирован.";

      if (mvpFile) {
        const mvpSheets = await readSheets(mvpFile);
        mvpItems = aggregateMVPItems(parseMVP(mvpSheets, { entity: resolvedEntity }));
        checkText = buildCheckFromItems(fbItems, mvpItems);
      }

      const rows = buildRows(fbItems, mvpItems, warnMvpOnly);
      setData({ rows, checkText, resolvedEntity, fbCount: fbItems.length, mvpCount: mvpItems.length });
      setAppStatus("ready");
      setPinnedNames([]);
      setSelGeos([]);
      setSelDates([]);
      setSelCabinets([]);
      setSumSort(null);
      setMismatchSort(null);
      setActiveTab("check");
    } catch (err) {
      setAppStatus("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [fbFile, mvpFile, entityMode, warnMvpOnly]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const mismatches = useMemo(
    () => (data?.rows ?? []).filter((r) => r.status !== "✅ OK"),
    [data]
  );

  const filteredRows = useMemo(() => {
    if (!data) return [];
    return filterRows({ rows: data.rows, names: pinnedNames, geos: selGeos, dates: selDates, cabinets: selCabinets });
  }, [data, pinnedNames, selGeos, selDates, selCabinets]);

  const geoOptions = useMemo(() => uniqueValues(data?.rows ?? [], "geo"), [data]);
  const dateOptions = useMemo(() => uniqueValues(data?.rows ?? [], "date").filter(Boolean), [data]);
  const cabinetOptions = useMemo(() => uniqueValues(data?.rows ?? [], "cabinet").filter(Boolean), [data]);

  // ── Sum metrics ────────────────────────────────────────────────────────────

  const metrics = useMemo(() => {
    const r = filteredRows;
    const spend = sumField(r, "spend") ?? 0;
    const sub = sumField(r, "sub") ?? 0;
    const chat = sumField(r, "chat") ?? 0;
    const deposits = sumField(r, "deposits") ?? 0;
    return [
      { label: "Строк", value: String(r.length) },
      { label: "Расход", value: formatMoney(spend) },
      { label: "ПДП", value: String(sub) },
      { label: "Диа", value: String(chat) },
      { label: "Депозиты", value: formatMoney(deposits) },
      { label: "Цена ПДП", value: sub ? formatMoney(spend / sub) : "—" },
      { label: "Цена диа", value: chat ? formatMoney(spend / chat) : "—" },
    ];
  }, [filteredRows]);

  // ── Sort handlers ──────────────────────────────────────────────────────────

  const handleSumSort = useCallback((col: keyof CheckRow) => {
    setSumSort((prev) => prev?.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" });
  }, []);

  const handleMismatchSort = useCallback((col: keyof CheckRow) => {
    setMismatchSort((prev) => prev?.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" });
  }, []);

  // ── Copy check ─────────────────────────────────────────────────────────────

  const handleCopy = useCallback(() => {
    if (!data?.checkText) return;
    navigator.clipboard?.writeText(data.checkText).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = data.checkText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
    setCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }, [data]);

  const handleDownloadTxt = useCallback(() => {
    if (!data?.checkText) return;
    const blob = new Blob([data.checkText + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "check.txt";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }, [data]);

  // ── Chip input ─────────────────────────────────────────────────────────────

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const val = nameInput.trim();
    if (val && !pinnedNames.includes(val)) setPinnedNames((prev) => [...prev, val]);
    setNameInput("");
  }, [nameInput, pinnedNames]);

  const removeChip = useCallback((idx: number) => {
    setPinnedNames((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // ── Nav ────────────────────────────────────────────────────────────────────

  const NAV_TABS: { id: CheckTab; label: string }[] = [
    { id: "check", label: "Чек" },
    { id: "sum", label: "Сумма" },
    { id: "mismatch", label: `Несовпадения${data ? ` (${mismatches.length})` : ""}` },
  ];

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0a080f] text-white">
      <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-8">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <img src="/logo-dark.png" alt="Genesis Trade Academy" className="h-24 md:h-32 w-auto object-contain flex-shrink-0" />
          <div className="w-px h-10 bg-violet-800/40 flex-shrink-0" />
          <span className="text-white text-4xl md:text-5xl font-semibold tracking-wide">Creative Dashboard</span>
        </div>

        {/* Top-level nav */}
        <div className="flex gap-1 mb-8 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 w-fit">
          {(["creatives", "analytics"] as const).map((t) => (
            <Link
              key={t}
              href={t === "analytics" ? "/?tab=analytics" : "/"}
              className="px-5 py-2 rounded-xl text-sm font-semibold text-zinc-400 hover:text-violet-300 transition"
            >
              {t === "creatives" ? "Creatives" : "Analytics"}
            </Link>
          ))}
          <span className="px-5 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm">
            Checks
          </span>
        </div>

        {/* Upload card */}
        <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Загрузи выгрузки</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
            <FileBox id="fbFile" label="FB / Статистика аккаунтов" fileName={fbFile?.name ?? null} onChange={setFbFile} />
            <FileBox id="mvpFile" label="MVP / data" fileName={mvpFile?.name ?? null} onChange={setMvpFile} optional />
            <FileBox id="mvpAdsFile" label="MVP объявления ID / для крео" fileName={mvpAdsFile?.name ?? null} onChange={setMvpAdsFile} optional />
            <FileBox id="adsFile" label="FB объявления / для крео" fileName={adsFile?.name ?? null} onChange={setAdsFile} optional />
          </div>

          <div className="flex flex-wrap items-center gap-4 mb-5">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Уровень расчёта</span>
              <select
                value={entityMode}
                onChange={(e) => setEntityMode(e.target.value as EntityMode)}
                className="rounded-lg border border-violet-900/40 bg-[#18181f] text-zinc-300 text-sm px-3 py-1.5 focus:outline-none focus:border-violet-500/60"
              >
                <option value="auto">Auto: объявления, если есть</option>
                <option value="campaign">Кампании</option>
                <option value="ad">Объявления</option>
              </select>
            </label>
            <label className="flex items-center gap-2 mt-4 cursor-pointer">
              <input
                type="checkbox"
                checked={warnMvpOnly}
                onChange={(e) => setWarnMvpOnly(e.target.checked)}
                className="w-4 h-4 accent-violet-500"
              />
              <span className="text-sm text-zinc-400">Показывать строки только в MVP</span>
            </label>
          </div>

          <button
            onClick={handleBuild}
            disabled={appStatus === "loading" || !fbFile}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 text-white font-semibold text-sm hover:from-violet-700 hover:to-violet-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {appStatus === "loading" ? "Обрабатываю..." : "Собрать чек"}
          </button>

          {errorMsg && (
            <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm whitespace-pre-wrap">
              ⚠️ {errorMsg}
            </div>
          )}
        </div>

        {/* Results */}
        {data && (
          <>
            {/* Summary strip */}
            <div className="flex flex-wrap gap-3 mb-6">
              {[
                { label: "Уровень", value: data.resolvedEntity === "ad" ? "объявления" : "кампании" },
                { label: "FB строк", value: String(data.fbCount) },
                { label: "MVP строк", value: String(data.mvpCount) },
                { label: "Несовпадений", value: String(mismatches.length) },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-0.5 px-4 py-2.5 rounded-xl bg-[#111118] border border-violet-900/30 min-w-[100px]">
                  <span className="text-xs text-zinc-500">{label}</span>
                  <span className="text-sm font-semibold text-white">{value}</span>
                </div>
              ))}
            </div>

            {/* Tab nav */}
            <div className="flex gap-1 mb-5 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 w-fit">
              {NAV_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
                    activeTab === t.id
                      ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm"
                      : "text-zinc-400 hover:text-violet-300"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── Чек tab ── */}
            {activeTab === "check" && (
              <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-white">Готовый чек</h2>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCopy}
                      className="px-4 py-1.5 rounded-lg bg-[#18181f] border border-violet-800/40 text-violet-300 text-sm hover:border-violet-600/60 transition"
                    >
                      {copied ? "Скопировано ✓" : "Скопировать"}
                    </button>
                    <button
                      onClick={handleDownloadTxt}
                      className="px-4 py-1.5 rounded-lg bg-[#18181f] border border-violet-800/40 text-violet-300 text-sm hover:border-violet-600/60 transition"
                    >
                      Скачать TXT
                    </button>
                  </div>
                </div>
                <textarea
                  readOnly
                  value={data.checkText}
                  spellCheck={false}
                  className="w-full h-[60vh] bg-[#18181f] border border-violet-900/30 rounded-xl p-4 text-sm text-zinc-200 font-mono resize-none focus:outline-none focus:border-violet-500/50"
                />
              </div>
            )}

            {/* ── Сумма tab ── */}
            {activeTab === "sum" && (
              <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
                <h2 className="text-base font-semibold text-white mb-4">Сумма по фильтру</h2>

                {/* Name chip input */}
                <div className="mb-4">
                  <label className="text-xs text-zinc-500 block mb-1">Название (Enter — закрепить)</label>
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={handleNameKeyDown}
                    placeholder="например EDIT4 или SPAIN"
                    className="w-full max-w-sm rounded-lg border border-violet-900/40 bg-[#18181f] text-zinc-300 text-sm px-3 py-1.5 focus:outline-none focus:border-violet-500/60 placeholder-zinc-600"
                  />
                  {pinnedNames.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {pinnedNames.map((name, idx) => (
                        <span key={idx} className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-800/30 border border-violet-700/40 text-violet-200 text-xs">
                          {name}
                          <button onClick={() => removeChip(idx)} className="text-violet-400 hover:text-white">×</button>
                        </span>
                      ))}
                      <button
                        onClick={() => setPinnedNames([])}
                        className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300"
                      >
                        очистить
                      </button>
                    </div>
                  )}
                </div>

                {/* Multi-select filters */}
                <div className="flex flex-wrap gap-4 mb-5">
                  <MultiSelect label="Гео" options={geoOptions} value={selGeos} onChange={setSelGeos} />
                  {dateOptions.length > 0 && (
                    <MultiSelect label="Дата" options={dateOptions} value={selDates} onChange={setSelDates} />
                  )}
                  {cabinetOptions.length > 0 && (
                    <MultiSelect label="Кабинет/T2A" options={cabinetOptions} value={selCabinets} onChange={setSelCabinets} />
                  )}
                  {(selGeos.length || selDates.length || selCabinets.length) ? (
                    <button
                      onClick={() => { setSelGeos([]); setSelDates([]); setSelCabinets([]); }}
                      className="self-end mb-1 text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      сбросить фильтры
                    </button>
                  ) : null}
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
                  {metrics.map(({ label, value }) => (
                    <MetricCard key={label} label={label} value={value} />
                  ))}
                </div>

                <DataTable cols={SUM_COLS} rows={filteredRows} sort={sumSort} onSort={handleSumSort} />
              </div>
            )}

            {/* ── Несовпадения tab ── */}
            {activeTab === "mismatch" && (
              <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
                <h2 className="text-base font-semibold text-white mb-4">
                  Несовпадения FB / MVP
                  {mismatches.length === 0 && (
                    <span className="ml-2 text-sm text-green-400 font-normal">— всё сошлось ✅</span>
                  )}
                </h2>
                <DataTable cols={MISMATCH_COLS} rows={mismatches} sort={mismatchSort} onSort={handleMismatchSort} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
