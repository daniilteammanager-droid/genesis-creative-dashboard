"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import {
  parseFB, parseFBDetailed, parseMVP, aggregateFBItems, aggregateMVPItems,
  formatMoney, formatPlainNumber, formatBudget,
} from "@/lib/forex-check/parse";
import {
  buildCheckFromItems, buildRows, filterRows, sumField, uniqueValues,
  buildAdCreativeAnalysis,
} from "@/lib/forex-check/analysis";
import type {
  CheckRow, EntityMode, BuildResult, CreativeSummaryRow,
} from "@/lib/forex-check/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type AppStatus = "idle" | "loading" | "ready" | "error";
type CheckTab = "check" | "sum" | "search" | "creos" | "link" | "mismatch";
type SortState = { col: keyof CheckRow; dir: "asc" | "desc" } | null;
type GenericSortState = { col: string; dir: "asc" | "desc" } | null;

interface ColDef {
  key: keyof CheckRow;
  label: string;
  fmt?: (v: unknown) => string;
}

interface GenericColDef {
  key: string;
  label: string;
  fmt?: (v: unknown) => string;
}

// ─── Column definitions ───────────────────────────────────────────────────────

const fmtMoney = (v: unknown) => (v !== null && v !== undefined ? formatMoney(Number(v)) : "—");
const fmtNum = (v: unknown) => (v !== null && v !== undefined ? formatPlainNumber(v) : "—");
const fmtRow = (v: unknown) => (v !== null && v !== undefined ? String(v) : "—");

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

const SEARCH_COLS: ColDef[] = [
  { key: "status", label: "Статус" },
  { key: "title", label: "Название" },
  { key: "geo", label: "Гео" },
  { key: "date", label: "Дата" },
  { key: "cabinet", label: "Кабинет/T2A" },
  { key: "spend", label: "Расход", fmt: fmtMoney },
  { key: "sub", label: "ПДП", fmt: fmtNum },
  { key: "chat", label: "Диа", fmt: fmtNum },
  { key: "deposits", label: "Депозиты", fmt: fmtMoney },
  { key: "websiteClicks", label: "Клики сайт", fmt: fmtNum },
  { key: "costPerSub", label: "Цена ПДП", fmt: fmtMoney },
  { key: "costPerChat", label: "Цена диа", fmt: fmtMoney },
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

const CREO_SUMMARY_COLS: GenericColDef[] = [
  { key: "geo", label: "Гео" },
  { key: "creative", label: "Крео" },
  { key: "spendTotal", label: "Spend", fmt: fmtMoney },
  { key: "fbClicks", label: "Клики FB", fmt: fmtNum },
  { key: "views", label: "Просмотры", fmt: fmtNum },
  { key: "websiteClicks", label: "Клики сайт", fmt: fmtNum },
  { key: "sub", label: "ПДП", fmt: fmtNum },
  { key: "chat", label: "Диа", fmt: fmtNum },
  { key: "deposits", label: "Депозиты", fmt: fmtMoney },
  { key: "costPerSub", label: "Цена ПДП", fmt: fmtMoney },
  { key: "costPerChat", label: "Цена диа", fmt: fmtMoney },
  { key: "adsCount", label: "Объявлений" },
  { key: "campaignsCount", label: "Кампаний" },
];

const CREO_DETAIL_COLS: GenericColDef[] = [
  { key: "geo", label: "Гео" },
  { key: "creative", label: "Крео" },
  { key: "adName", label: "Название объявления" },
  { key: "spendTotal", label: "Spend", fmt: fmtMoney },
  { key: "fbClicks", label: "Клики FB", fmt: fmtNum },
  { key: "views", label: "Просмотры", fmt: fmtNum },
  { key: "websiteClicks", label: "Клики сайт", fmt: fmtNum },
  { key: "sub", label: "ПДП", fmt: fmtNum },
  { key: "chat", label: "Диа", fmt: fmtNum },
  { key: "deposits", label: "Депозиты", fmt: fmtMoney },
  { key: "costPerSub", label: "Цена ПДП", fmt: fmtMoney },
  { key: "costPerChat", label: "Цена диа", fmt: fmtMoney },
  { key: "adsCount", label: "Объявлений" },
  { key: "campaignsCount", label: "Кампаний" },
];

const LINK_COLS: GenericColDef[] = [
  { key: "linkStatus", label: "Связка" },
  { key: "geo", label: "Гео" },
  { key: "creative", label: "Крео" },
  { key: "adTitle", label: "Объявление" },
  { key: "adId", label: "Ad ID" },
  { key: "mvpId", label: "MVP ID" },
  { key: "campaign", label: "Кампания" },
  { key: "spendAd", label: "Spend", fmt: fmtMoney },
  { key: "adStatus", label: "Статус объявления" },
  { key: "accountStatus", label: "Статус кабинета" },
  { key: "date", label: "Дата" },
  { key: "cabinet", label: "Кабинет/T2A" },
  { key: "fbClicks", label: "Клики FB", fmt: fmtNum },
  { key: "views", label: "Просмотры", fmt: fmtNum },
  { key: "websiteClicks", label: "Клики сайт", fmt: fmtNum },
  { key: "sub", label: "ПДП", fmt: fmtNum },
  { key: "chat", label: "Диа", fmt: fmtNum },
  { key: "deposits", label: "Депозиты", fmt: fmtMoney },
  { key: "metricsFrom", label: "Метрики из" },
  { key: "fbAdRow", label: "FB AD строка" },
  { key: "mvpAdRow", label: "MVP AD строка" },
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

function sortGenericRows(rows: Record<string, unknown>[], sort: GenericSortState): Record<string, unknown>[] {
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

function downloadCsv(filename: string, rows: Record<string, unknown>[], cols: GenericColDef[]) {
  const esc = (v: unknown) => {
    const t = String(v ?? "");
    return /[";\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
  };
  const header = cols.map((c) => esc(c.label)).join(";");
  const body = rows
    .map((row) =>
      cols.map((c) => {
        const raw = row[c.key];
        return esc(c.fmt ? c.fmt(raw) : raw != null ? String(raw) : "");
      }).join(";")
    )
    .join("\n");
  const blob = new Blob(["﻿" + header + "\n" + body + "\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function buildCreoText(rows: CreativeSummaryRow[]): string {
  if (!rows.length) return "Нет данных по крео.";
  const byGeo = new Map<string, CreativeSummaryRow[]>();
  for (const row of rows) {
    if (!byGeo.has(row.geo)) byGeo.set(row.geo, []);
    byGeo.get(row.geo)!.push(row);
  }
  const lines: string[] = [];
  for (const [geo, items] of byGeo) {
    lines.push(geo, "");
    for (const item of [...items].sort((a, b) => b.spendTotal - a.spendTotal)) {
      lines.push(
        `${item.creative}: ${formatMoney(item.spendTotal)} за всё время / ПДП: ${formatPlainNumber(item.sub)} / диа: ${formatPlainNumber(item.chat)} / депозиты: ${formatMoney(item.deposits)}`
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
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
                  <span className="ml-1 text-zinc-600">{active ? (sort!.dir === "asc" ? "↑" : "↓") : "↕"}</span>
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

function GenericTable({
  cols, rows, sort, onSort,
}: {
  cols: GenericColDef[];
  rows: Record<string, unknown>[];
  sort: GenericSortState;
  onSort: (col: string) => void;
}) {
  const sorted = useMemo(() => sortGenericRows(rows, sort), [rows, sort]);

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
                  <span className="ml-1 text-zinc-600">{active ? (sort!.dir === "asc" ? "↑" : "↓") : "↕"}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className="border-b border-violet-900/20 hover:bg-violet-900/10">
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
  label: string; options: string[]; value: string[]; onChange: (v: string[]) => void;
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

  // Active tab
  const [activeTab, setActiveTab] = useState<CheckTab>("check");

  // Sum tab
  const [pinnedNames, setPinnedNames] = useState<string[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [selGeos, setSelGeos] = useState<string[]>([]);
  const [selDates, setSelDates] = useState<string[]>([]);
  const [selCabinets, setSelCabinets] = useState<string[]>([]);
  const [sumSort, setSumSort] = useState<SortState>(null);

  // Search tab
  const [quickSearch, setQuickSearch] = useState("");
  const [searchSort, setSearchSort] = useState<SortState>(null);

  // Creos tab
  const [creoGeos, setCreoGeos] = useState<string[]>([]);
  const [creoSearch, setCreoSearch] = useState("");
  const [creoSummarySort, setCreoSummarySort] = useState<GenericSortState>(null);
  const [creoDetailSort, setCreoDetailSort] = useState<GenericSortState>(null);
  const [creosCopied, setCreosCopied] = useState(false);
  const creosCopyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Link tab
  const [linkSort, setLinkSort] = useState<GenericSortState>(null);

  // Mismatch tab
  const [mismatchSort, setMismatchSort] = useState<SortState>(null);

  // Check tab
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

      // Creative analysis — try adsFile first, fall back to main FB file
      let adItemsRaw: import("@/lib/forex-check/types").FBDetailedItem[] = [];
      const adsSheets = adsFile ? await readSheets(adsFile) : fbSheets;
      try {
        adItemsRaw = parseFBDetailed(adsSheets, {
          entity: "ad",
          includeZeroSpend: true,
          fileLabel: adsFile ? "FB ad-файле" : "основном FB-файле",
        }).items;
      } catch {
        if (adsFile) throw new Error("Не удалось прочитать файл FB объявлений.");
        adItemsRaw = [];
      }

      let mvpAdItemsRaw: import("@/lib/forex-check/types").MVPItem[] = [];
      if (mvpAdsFile) {
        const mvpAdsSheets = await readSheets(mvpAdsFile);
        mvpAdItemsRaw = parseMVP(mvpAdsSheets, { entity: "ad" });
      }

      const creativeAnalysis = buildAdCreativeAnalysis({ adItemsRaw, mvpAdItemsRaw, metricRows: rows });

      setData({ rows, checkText, resolvedEntity, fbCount: fbItems.length, mvpCount: mvpItems.length, creativeAnalysis });
      setAppStatus("ready");
      setPinnedNames([]); setSelGeos([]); setSelDates([]); setSelCabinets([]);
      setSumSort(null); setMismatchSort(null); setSearchSort(null);
      setCreoGeos([]); setCreoSearch(""); setCreoSummarySort(null); setCreoDetailSort(null);
      setLinkSort(null); setQuickSearch("");
      setActiveTab("check");
    } catch (err) {
      setAppStatus("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [fbFile, mvpFile, adsFile, mvpAdsFile, entityMode, warnMvpOnly]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const mismatches = useMemo(
    () => (data?.rows ?? []).filter((r) => r.status !== "✅ OK"),
    [data]
  );

  const filteredRows = useMemo(() => {
    if (!data) return [];
    return filterRows({ rows: data.rows, names: pinnedNames, geos: selGeos, dates: selDates, cabinets: selCabinets });
  }, [data, pinnedNames, selGeos, selDates, selCabinets]);

  const searchRows = useMemo(() => {
    if (!data) return [];
    if (!quickSearch.trim()) return data.rows.slice(0, 200);
    return filterRows({ rows: data.rows, searchText: quickSearch });
  }, [data, quickSearch]);

  const geoOptions = useMemo(() => uniqueValues(data?.rows ?? [], "geo"), [data]);
  const dateOptions = useMemo(() => uniqueValues(data?.rows ?? [], "date").filter(Boolean), [data]);
  const cabinetOptions = useMemo(() => uniqueValues(data?.rows ?? [], "cabinet").filter(Boolean), [data]);

  const creoGeoOptions = useMemo(() => {
    if (!data?.creativeAnalysis) return [];
    return [...new Set(data.creativeAnalysis.summaryRows.map((r) => r.geo).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "ru")
    );
  }, [data]);

  const creoFilteredSummary = useMemo(() => {
    if (!data?.creativeAnalysis) return [];
    return data.creativeAnalysis.summaryRows.filter((row) => {
      if (creoGeos.length && !creoGeos.includes(row.geo)) return false;
      if (creoSearch) {
        const q = creoSearch.toUpperCase();
        if (!`${row.creative} ${row.adNames}`.toUpperCase().includes(q)) return false;
      }
      return true;
    });
  }, [data, creoGeos, creoSearch]);

  const creoFilteredDetail = useMemo(() => {
    if (!data?.creativeAnalysis) return [];
    return data.creativeAnalysis.detailRows.filter((row) => {
      if (creoGeos.length && !creoGeos.includes(row.geo)) return false;
      if (creoSearch) {
        const q = creoSearch.toUpperCase();
        if (!`${row.creative} ${row.adName}`.toUpperCase().includes(q)) return false;
      }
      return true;
    });
  }, [data, creoGeos, creoSearch]);

  // ── Sum metrics ────────────────────────────────────────────────────────────

  const metrics = useMemo(() => {
    const r = filteredRows;
    const spend = sumField(r, "spend") ?? 0;
    const sub = sumField(r, "sub") ?? 0;
    const chat = sumField(r, "chat") ?? 0;
    const deposits = sumField(r, "deposits") ?? 0;
    const fbClicks = sumField(r, "fbClicks") ?? 0;
    const views = sumField(r, "views") ?? 0;
    const websiteClicks = sumField(r, "websiteClicks") ?? 0;
    return [
      { label: "Строк", value: String(r.length) },
      { label: "Расход", value: formatMoney(spend) },
      { label: "Клики FB", value: formatPlainNumber(fbClicks) },
      { label: "Просмотры", value: formatPlainNumber(views) },
      { label: "Клики сайт", value: formatPlainNumber(websiteClicks) },
      { label: "ПДП", value: String(sub) },
      { label: "Диа", value: String(chat) },
      { label: "Депозиты", value: formatMoney(deposits) },
      { label: "Цена ПДП", value: sub ? formatMoney(spend / sub) : "—" },
      { label: "Цена диа", value: chat ? formatMoney(spend / chat) : "—" },
    ];
  }, [filteredRows]);

  const creoMetrics = useMemo(() => {
    const r = creoFilteredSummary;
    const spend = r.reduce((s, x) => s + x.spendTotal, 0);
    const sub = r.reduce((s, x) => s + x.sub, 0);
    const chat = r.reduce((s, x) => s + x.chat, 0);
    const deposits = r.reduce((s, x) => s + x.deposits, 0);
    const fbClicks = r.reduce((s, x) => s + (x.fbClicks || 0), 0);
    const views = r.reduce((s, x) => s + (x.views || 0), 0);
    const websiteClicks = r.reduce((s, x) => s + x.websiteClicks, 0);
    return [
      { label: "Строк", value: String(creoFilteredDetail.length) },
      { label: "Расход", value: formatMoney(spend) },
      { label: "Клики FB", value: formatPlainNumber(fbClicks) },
      { label: "Просмотры", value: formatPlainNumber(views) },
      { label: "Клики сайт", value: formatPlainNumber(websiteClicks) },
      { label: "ПДП", value: String(sub) },
      { label: "Диа", value: String(chat) },
      { label: "Депозиты", value: formatMoney(deposits) },
      { label: "Цена ПДП", value: sub ? formatMoney(spend / sub) : "—" },
      { label: "Цена диа", value: chat ? formatMoney(spend / chat) : "—" },
    ];
  }, [creoFilteredSummary, creoFilteredDetail]);

  // ── Sort handlers ──────────────────────────────────────────────────────────

  const mkSort = <T extends string>(setter: React.Dispatch<React.SetStateAction<{ col: T; dir: "asc" | "desc" } | null>>) =>
    (col: T) => setter((prev) => prev?.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" });

  const handleSumSort = useCallback(mkSort<keyof CheckRow>(setSumSort), []);
  const handleSearchSort = useCallback(mkSort<keyof CheckRow>(setSearchSort), []);
  const handleMismatchSort = useCallback(mkSort<keyof CheckRow>(setMismatchSort), []);
  const handleCreoSummarySort = useCallback(mkSort<string>(setCreoSummarySort), []);
  const handleCreoDetailSort = useCallback(mkSort<string>(setCreoDetailSort), []);
  const handleLinkSort = useCallback(mkSort<string>(setLinkSort), []);

  // ── Copy / download ────────────────────────────────────────────────────────

  const handleCopy = useCallback(() => {
    if (!data?.checkText) return;
    navigator.clipboard?.writeText(data.checkText).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = data.checkText;
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    });
    setCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }, [data]);

  const handleDownloadTxt = useCallback(() => {
    if (!data?.checkText) return;
    const blob = new Blob([data.checkText + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "check.txt";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }, [data]);

  const handleCopyCreos = useCallback(() => {
    const text = buildCreoText(creoFilteredSummary);
    navigator.clipboard?.writeText(text).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    });
    setCreosCopied(true);
    if (creosCopyRef.current) clearTimeout(creosCopyRef.current);
    creosCopyRef.current = setTimeout(() => setCreosCopied(false), 2000);
  }, [creoFilteredSummary]);

  const handleDownloadCreosCsv = useCallback(() => {
    downloadCsv("creos_by_country.csv", creoFilteredSummary as unknown as Record<string, unknown>[], CREO_SUMMARY_COLS);
  }, [creoFilteredSummary]);

  const handleDownloadLinkCsv = useCallback(() => {
    if (!data?.creativeAnalysis) return;
    downloadCsv("campaign_ad_link.csv", data.creativeAnalysis.linkRows as unknown as Record<string, unknown>[], LINK_COLS);
  }, [data]);

  // ── Chip input ─────────────────────────────────────────────────────────────

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const val = nameInput.trim();
    if (val && !pinnedNames.includes(val)) setPinnedNames((prev) => [...prev, val]);
    setNameInput("");
  }, [nameInput, pinnedNames]);

  const removeChip = useCallback((idx: number) => setPinnedNames((prev) => prev.filter((_, i) => i !== idx)), []);

  // ── Nav ────────────────────────────────────────────────────────────────────

  const NAV_TABS: { id: CheckTab; label: string }[] = [
    { id: "check", label: "Чек" },
    { id: "sum", label: "Сумма" },
    { id: "search", label: "Поиск" },
    { id: "creos", label: "Крео по странам" },
    { id: "link", label: "FB/MVP Ads" },
    { id: "mismatch", label: `Несовпадения${data ? ` (${mismatches.length})` : ""}` },
  ];

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0a080f] text-white">
      <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-8">

        <h1 className="text-white text-3xl font-semibold tracking-wide mb-6">Checks</h1>

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
            <div className="flex flex-wrap gap-1 mb-5 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 w-fit">
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

            {/* ── Чек ── */}
            {activeTab === "check" && (
              <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-white">Готовый чек</h2>
                  <div className="flex gap-2">
                    <button onClick={handleCopy} className="px-4 py-1.5 rounded-lg bg-[#18181f] border border-violet-800/40 text-violet-300 text-sm hover:border-violet-600/60 transition">
                      {copied ? "Скопировано ✓" : "Скопировать"}
                    </button>
                    <button onClick={handleDownloadTxt} className="px-4 py-1.5 rounded-lg bg-[#18181f] border border-violet-800/40 text-violet-300 text-sm hover:border-violet-600/60 transition">
                      Скачать TXT
                    </button>
                  </div>
                </div>
                <textarea
                  readOnly value={data.checkText} spellCheck={false}
                  className="w-full h-[60vh] bg-[#18181f] border border-violet-900/30 rounded-xl p-4 text-sm text-zinc-200 font-mono resize-none focus:outline-none focus:border-violet-500/50"
                />
              </div>
            )}

            {/* ── Сумма ── */}
            {activeTab === "sum" && (
              <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
                <h2 className="text-base font-semibold text-white mb-4">Сумма по фильтру</h2>

                <div className="mb-4">
                  <label className="text-xs text-zinc-500 block mb-1">Название (Enter — закрепить)</label>
                  <input
                    type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={handleNameKeyDown} placeholder="например EDIT4 или SPAIN"
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
                      <button onClick={() => setPinnedNames([])} className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300">очистить</button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-4 mb-5">
                  <MultiSelect label="Гео" options={geoOptions} value={selGeos} onChange={setSelGeos} />
                  {dateOptions.length > 0 && <MultiSelect label="Дата" options={dateOptions} value={selDates} onChange={setSelDates} />}
                  {cabinetOptions.length > 0 && <MultiSelect label="Кабинет/T2A" options={cabinetOptions} value={selCabinets} onChange={setSelCabinets} />}
                  {(selGeos.length || selDates.length || selCabinets.length) ? (
                    <button onClick={() => { setSelGeos([]); setSelDates([]); setSelCabinets([]); }} className="self-end mb-1 text-xs text-zinc-500 hover:text-zinc-300">
                      сбросить фильтры
                    </button>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-10 gap-3 mb-5">
                  {metrics.map(({ label, value }) => <MetricCard key={label} label={label} value={value} />)}
                </div>

                <DataTable cols={SUM_COLS} rows={filteredRows} sort={sumSort} onSort={handleSumSort} />
              </div>
            )}

            {/* ── Поиск ── */}
            {activeTab === "search" && (
              <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
                <h2 className="text-base font-semibold text-white mb-4">Быстрый поиск</h2>
                <input
                  type="text" value={quickSearch}
                  onChange={(e) => setQuickSearch(e.target.value)}
                  placeholder="часть названия / гео / кабинет"
                  className="w-full max-w-lg rounded-xl border border-violet-900/40 bg-[#18181f] text-zinc-200 text-sm px-4 py-2.5 mb-5 focus:outline-none focus:border-violet-500/60 placeholder-zinc-600"
                />
                <p className="text-xs text-zinc-600 mb-4">
                  {quickSearch.trim() ? `Найдено: ${searchRows.length}` : `Показаны первые 200 строк`}
                </p>
                <DataTable cols={SEARCH_COLS} rows={searchRows} sort={searchSort} onSort={handleSearchSort} />
              </div>
            )}

            {/* ── Крео по странам ── */}
            {activeTab === "creos" && (
              <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                  <div>
                    <h2 className="text-base font-semibold text-white mb-1">Крео по странам</h2>
                    <p className="text-xs text-zinc-500 max-w-xl">
                      Какие крео крутились по каждому гео, суммарный spend и метрики. ПДП/диа/депозиты берутся из MVP объявлений по ID (если загружены) или из основного чека.
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={handleCopyCreos} className="px-4 py-1.5 rounded-lg bg-[#18181f] border border-violet-800/40 text-violet-300 text-sm hover:border-violet-600/60 transition">
                      {creosCopied ? "Скопировано ✓" : "Скопировать сводку"}
                    </button>
                    <button onClick={handleDownloadCreosCsv} className="px-4 py-1.5 rounded-lg bg-[#18181f] border border-violet-800/40 text-violet-300 text-sm hover:border-violet-600/60 transition">
                      Скачать CSV
                    </button>
                  </div>
                </div>

                {!data.creativeAnalysis.hasAdData ? (
                  <p className="text-zinc-500 text-sm py-6">Нет данных по объявлениям. Загрузи FB объявления (4-й файл) или убедись, что основной FB-файл содержит колонку объявлений.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-4 mb-5">
                      <MultiSelect label="Гео" options={creoGeoOptions} value={creoGeos} onChange={setCreoGeos} />
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-zinc-500">Крео / EDIT</span>
                        <input
                          type="text" value={creoSearch}
                          onChange={(e) => setCreoSearch(e.target.value)}
                          placeholder="например EDIT4 или static"
                          className="rounded-lg border border-violet-900/40 bg-[#18181f] text-zinc-300 text-sm px-3 py-1.5 focus:outline-none focus:border-violet-500/60 placeholder-zinc-600"
                        />
                      </label>
                      {(creoGeos.length || creoSearch) ? (
                        <button onClick={() => { setCreoGeos([]); setCreoSearch(""); }} className="self-end mb-1 text-xs text-zinc-500 hover:text-zinc-300">
                          сбросить
                        </button>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-10 gap-3 mb-6">
                      {creoMetrics.map(({ label, value }) => <MetricCard key={label} label={label} value={value} />)}
                    </div>

                    <h3 className="text-sm font-semibold text-zinc-300 mb-3">Сводка</h3>
                    <div className="mb-6">
                      <GenericTable
                        cols={CREO_SUMMARY_COLS}
                        rows={creoFilteredSummary as unknown as Record<string, unknown>[]}
                        sort={creoSummarySort}
                        onSort={handleCreoSummarySort}
                      />
                    </div>

                    <h3 className="text-sm font-semibold text-zinc-300 mb-3">Сводка по названиям объявлений</h3>
                    <GenericTable
                      cols={CREO_DETAIL_COLS}
                      rows={creoFilteredDetail as unknown as Record<string, unknown>[]}
                      sort={creoDetailSort}
                      onSort={handleCreoDetailSort}
                    />
                  </>
                )}
              </div>
            )}

            {/* ── FB/MVP Ads ── */}
            {activeTab === "link" && (
              <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-base font-semibold text-white mb-1">Связка FB объявлений и MVP объявлений</h2>
                    <p className="text-xs text-zinc-500 max-w-xl">
                      Нашли ли мы для FB объявления строку в MVP объявлениях. Строки, которые есть в MVP ID но отсутствуют в FB, выводятся отдельно.
                    </p>
                  </div>
                  <button onClick={handleDownloadLinkCsv} className="px-4 py-1.5 rounded-lg bg-[#18181f] border border-violet-800/40 text-violet-300 text-sm hover:border-violet-600/60 transition shrink-0">
                    Скачать CSV
                  </button>
                </div>
                <GenericTable
                  cols={LINK_COLS}
                  rows={data.creativeAnalysis.linkRows as unknown as Record<string, unknown>[]}
                  sort={linkSort}
                  onSort={handleLinkSort}
                />
              </div>
            )}

            {/* ── Несовпадения ── */}
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
