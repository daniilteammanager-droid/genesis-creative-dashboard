"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { supabase, isSupabaseConfigured, type CreativeNote } from "@/lib/supabase";

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSr4-3RDwlc7vXIbnBBkZVO9UY8QOxzqSYLceOCU-aHAHM3ETMQP9g7LMtDZORuyafkvAvm4TmCEawl/pub?gid=1832093387&single=true&output=csv";

type CreativeRow = {
  creative: string;
  spend: string;
  revenue: string;
  deposits: string;
  pdp: string;
  dia: string;
  romi: string;
  text: string;
};

type MediaFile = {
  key: string;
  url: string;
  posterUrl?: string; // thumbnail из папки thumbnails/, только для видео
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

type CreativeCardProps = {
  item: CreativeRow;
  itemMedia: MediaFile | undefined;
  itemApproach: string;
  itemNote: CreativeNote | undefined;
  onSelect: (item: CreativeRow) => void;
  onToggleFavorite: (code: string) => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\.(mov|mp4|jpg|jpeg|png|webp)$/i, "");
}

function getFileBaseName(key: string) {
  const fileName = key.split("/").pop() || "";
  return normalize(fileName);
}

function isVideo(url: string) {
  return /\.(mov|mp4)$/i.test(url);
}

function isImage(url: string) {
  return /\.(jpg|jpeg|png|webp)$/i.test(url);
}

function findMedia(creative: string, media: MediaFile[]) {
  const creativeKey = normalize(creative);
  return media.find((file) => getFileBaseName(file.key) === creativeKey);
}

function parseNumber(value: string): number {
  const s = value.replace(/[^0-9.,-]/g, "").trim();
  if (!s || s === "-") return NaN;
  if (s.includes(",") && !s.includes(".")) return parseFloat(s.replace(",", "."));
  return parseFloat(s.replace(/,/g, ""));
}

function getApproach(key: string): string {
  const slash = key.indexOf("/");
  return slash > 0 ? key.slice(0, slash) : "unknown";
}

function formatSummaryNumber(n: number): string {
  if (isNaN(n) || !isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function formatRomiPct(n: number): string {
  if (isNaN(n) || !isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

// ─── Estimated row heights for virtual scroll ─────────────────────────────────
// Desktop (≥3 cols): media square ~230px + header ~70px + metrics ~100px + padding = ~420px
// Mobile (1 col): no top media, header + thumb-row ≈ 208px
const EST_ROW_H_DESKTOP = 420;
const EST_ROW_H_MOBILE  = 208;

// ─── Home ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [rows,       setRows]       = useState<CreativeRow[]>([]);
  const [media,      setMedia]      = useState<MediaFile[]>([]);
  const [search,     setSearch]     = useState("");
  const [selected,   setSelected]   = useState<CreativeRow | null>(null);
  const [csvLoading, setCsvLoading] = useState(true);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [csvError,   setCsvError]   = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [activeTab,  setActiveTab]  = useState<"all" | "win" | "lose" | "test" | "favorites">("all");
  const [activeApproach, setActiveApproach] = useState("all");
  const [activeSort, setActiveSort] = useState<"none" | "romi" | "spend" | "deposits">("none");
  const [topTab,     setTopTab]     = useState<"creatives" | "analytics">("creatives");
  const [notes,      setNotes]      = useState<Record<string, CreativeNote>>({});
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesError, setNotesError] = useState<string | null>(null);

  // JS-driven column count (mirrors Tailwind responsive breakpoints)
  const [columnCount, setColumnCount] = useState(1);

  // Offset of the virtual grid container from the document top (for scrollMargin)
  const [listTop, setListTop] = useState(0);

  // Stable ref to latest notes — lets toggleFavorite avoid stale closure
  const notesRef = useRef<Record<string, CreativeNote>>({});
  const listRef  = useRef<HTMLDivElement>(null);

  // Keep notesRef current
  useEffect(() => { notesRef.current = notes; }, [notes]);

  // Detect column count from window width
  useEffect(() => {
    function updateCols() {
      const w = window.innerWidth;
      if      (w >= 1280) setColumnCount(5);
      else if (w >= 1024) setColumnCount(4);
      else if (w >= 768)  setColumnCount(3);
      else                setColumnCount(1);
    }
    updateCols();
    window.addEventListener("resize", updateCols);
    return () => window.removeEventListener("resize", updateCols);
  }, []);

  // Re-measure grid container offset whenever layout might shift
  useLayoutEffect(() => {
    if (listRef.current) {
      const { top } = listRef.current.getBoundingClientRect();
      setListTop(top + window.scrollY);
    }
  }, [topTab]); // re-run when tab switches (grid mounts/unmounts)

  // ─── Stable callbacks ────────────────────────────────────────────────────

  const toggleFavorite = useCallback(async (creativeCode: string) => {
    if (!isSupabaseConfigured) {
      console.warn("Supabase не настроен — toggle favorite недоступен");
      return;
    }
    const existing   = notesRef.current[creativeCode];
    const newFavorite = !(existing?.favorite ?? false);

    const updated: CreativeNote = existing
      ? { ...existing, favorite: newFavorite, updated_at: new Date().toISOString() }
      : { creative_code: creativeCode, favorite: newFavorite, note: null, transcription_ru: null, updated_at: new Date().toISOString() };

    setNotes((prev) => ({ ...prev, [creativeCode]: updated }));

    try {
      const { error } = await supabase
        .from("creative_notes")
        .upsert(
          {
            creative_code:    creativeCode,
            favorite:         newFavorite,
            note:             existing?.note ?? null,
            transcription_ru: existing?.transcription_ru ?? null,
            updated_at:       new Date().toISOString(),
          },
          { onConflict: "creative_code" }
        );
      if (error) throw error;
    } catch (e) {
      console.error("Ошибка сохранения favorite:", e);
      setNotes((prev) => {
        const reverted = { ...prev };
        if (existing) reverted[creativeCode] = existing;
        else          delete reverted[creativeCode];
        return reverted;
      });
    }
  }, []); // stable — reads latest notes from notesRef

  const handleSetSelected = useCallback((item: CreativeRow) => setSelected(item), []);

  // ─── Data loading ────────────────────────────────────────────────────────

  useEffect(() => {
    async function loadCSV() {
      try {
        const res = await fetch(CSV_URL);
        if (!res.ok) throw new Error(`CSV: ошибка сети ${res.status}`);
        const text = await res.text();

        const result = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
        const allRows = result.data;

        const headerIndex = allRows.findIndex((row) =>
          row.some((cell) => cell.trim() === "Creative Code")
        );
        if (headerIndex === -1) throw new Error("CSV: строка с заголовком 'Creative Code' не найдена");

        const headers  = allRows[headerIndex].map((h) => h.trim());
        const dataRows = allRows.slice(headerIndex + 1);

        const get = (row: string[], name: string) => {
          const i = headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
          return i >= 0 ? (row[i] ?? "").trim() : "";
        };

        const formatted = dataRows
          .map((row) => ({
            creative: get(row, "Creative Code"),
            spend:    get(row, "Spend"),
            revenue:  get(row, "Revenue"),
            deposits: get(row, "Deposits"),
            pdp:      get(row, "Цена пдп"),
            dia:      get(row, "Цена Диа"),
            romi:     get(row, "ROMI"),
            text:     get(row, "TEXT"),
          }))
          .filter((item) => item.creative);

        setRows(formatted);
      } catch (e) {
        setCsvError(e instanceof Error ? e.message : "Не удалось загрузить данные");
      } finally {
        setCsvLoading(false);
      }
    }

    async function loadMedia() {
      try {
        const res = await fetch("/api/media");
        if (!res.ok) throw new Error(`Media: ошибка сети ${res.status}`);
        const data = await res.json();
        setMedia(Array.isArray(data) ? data : []);
      } catch (e) {
        setMediaError(e instanceof Error ? e.message : "Не удалось загрузить медиа");
      } finally {
        setMediaLoading(false);
      }
    }

    async function loadNotes() {
      if (!isSupabaseConfigured) { setNotesLoading(false); return; }
      try {
        const { data, error } = await supabase.from("creative_notes").select("*");
        if (error) throw error;
        const map: Record<string, CreativeNote> = {};
        for (const row of (data ?? []) as CreativeNote[]) map[row.creative_code] = row;
        setNotes(map);
      } catch (e) {
        setNotesError(e instanceof Error ? e.message : "Не удалось загрузить заметки");
      } finally {
        setNotesLoading(false);
      }
    }

    loadCSV();
    loadMedia();
    loadNotes();
  }, []);

  // ─── Derived state ───────────────────────────────────────────────────────

  const loading = csvLoading || mediaLoading || notesLoading;
  const error   = csvError  || mediaError  || notesError;

  const approaches = useMemo(() => {
    const set = new Set(media.map((f) => getApproach(f.key)));
    return Array.from(set).sort();
  }, [media]);

  const tabCounts = useMemo(() => {
    const base = rows
      .filter((item) => item.creative.toLowerCase().includes(search.toLowerCase()))
      .filter((item) => {
        if (activeApproach === "all") return true;
        const file = findMedia(item.creative, media);
        return (file ? getApproach(file.key) : "unknown") === activeApproach;
      });
    return {
      all:       base.length,
      win:       base.filter((item) => parseNumber(item.romi) >= 150).length,
      lose:      base.filter((item) => parseNumber(item.romi) < 0 && parseNumber(item.spend) > 1000).length,
      test:      base.filter((item) => parseNumber(item.spend) < 1000).length,
      favorites: base.filter((item) => notes[item.creative]?.favorite === true).length,
    };
  }, [rows, search, activeApproach, media, notes]);

  const filtered = useMemo(() => {
    const sortFn = (a: CreativeRow, b: CreativeRow) => {
      if (activeSort === "none") return 0;
      const get = (item: CreativeRow) => {
        if (activeSort === "romi")     return parseNumber(item.romi);
        if (activeSort === "spend")    return parseNumber(item.spend);
        if (activeSort === "deposits") return parseNumber(item.deposits);
        return 0;
      };
      const aVal = get(a), bVal = get(b);
      if (isNaN(aVal) && isNaN(bVal)) return 0;
      if (isNaN(aVal)) return 1;
      if (isNaN(bVal)) return -1;
      return bVal - aVal;
    };

    return rows
      .filter((item) => item.creative.toLowerCase().includes(search.toLowerCase()))
      .filter((item) => {
        if (activeTab === "all") return true;
        const romi = parseNumber(item.romi), spend = parseNumber(item.spend);
        if (activeTab === "win")       return romi >= 150;
        if (activeTab === "lose")      return romi < 0 && spend > 1000;
        if (activeTab === "test")      return spend < 1000;
        if (activeTab === "favorites") return notes[item.creative]?.favorite === true;
        return true;
      })
      .filter((item) => {
        if (activeApproach === "all") return true;
        const file = findMedia(item.creative, media);
        return (file ? getApproach(file.key) : "unknown") === activeApproach;
      })
      .sort(sortFn);
  }, [rows, search, activeTab, activeApproach, activeSort, media, notes]);

  const summary = useMemo(() => {
    const validSpend    = filtered.map((r) => parseNumber(r.spend)).filter(isFinite);
    const validRevenue  = filtered.map((r) => parseNumber(r.revenue)).filter(isFinite);
    const validDeposits = filtered.map((r) => parseNumber(r.deposits)).filter(isFinite);
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    return {
      total:         filtered.length,
      totalSpend:    sum(validSpend),
      totalRevenue:  sum(validRevenue),
      totalDeposits: sum(validDeposits),
      totalRomi:     sum(validSpend) > 0 ? (sum(validRevenue) - sum(validSpend)) / sum(validSpend) * 100 : 0,
      winners:       filtered.filter((r) => parseNumber(r.romi) >= 150).length,
      losers:        filtered.filter((r) => parseNumber(r.romi) < 0 && parseNumber(r.spend) > 1000).length,
      tests:         filtered.filter((r) => parseNumber(r.spend) < 1000).length,
    };
  }, [filtered]);

  // ─── Virtualizer ─────────────────────────────────────────────────────────

  // Group filtered items into rows of `columnCount`
  const gridRows = useMemo(() => {
    const result: CreativeRow[][] = [];
    for (let i = 0; i < filtered.length; i += columnCount) {
      result.push(filtered.slice(i, i + columnCount));
    }
    return result;
  }, [filtered, columnCount]);

  const virtualizer = useWindowVirtualizer({
    count:        gridRows.length,
    estimateSize: () => columnCount === 1 ? EST_ROW_H_MOBILE : EST_ROW_H_DESKTOP,
    overscan:     3,
    scrollMargin: listTop,
  });

  // ─── JSX ─────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#0a080f] text-white p-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-dark.png"
            alt="Genesis Trade Academy"
            className="h-24 md:h-32 w-auto object-contain flex-shrink-0"
          />
          <div className="w-px h-10 bg-violet-800/40 flex-shrink-0" />
          <span className="text-white text-4xl md:text-5xl font-semibold tracking-wide">
            Creative Dashboard
          </span>
        </div>

        {/* Top-level navigation */}
        <div className="flex gap-1 mb-6 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 w-fit">
          {(["creatives", "analytics"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTopTab(t)}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition ${
                topTab === t
                  ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm"
                  : "text-zinc-400 hover:text-violet-300"
              }`}
            >
              {t === "creatives" ? "Creatives" : "Analytics"}
            </button>
          ))}
        </div>

        {topTab === "creatives" && (
          <>
            {/* Sticky controls */}
            <div className="sticky top-0 z-20 -mx-8 px-8 pt-4 pb-4 mb-6 bg-[#0a080f]/90 backdrop-blur-md border-b border-violet-900/30">
              <input
                type="text"
                placeholder="Поиск крео..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-[#111118] border border-violet-900/40 rounded-xl px-4 py-3 mb-3 outline-none focus:border-violet-600/50 transition placeholder:text-zinc-600"
              />

              <div className="flex items-center gap-2 flex-wrap">
                {(["all", "win", "lose", "test", "favorites"] as const).map((tab) => {
                  const labels: Record<typeof tab, string> = {
                    all: "All", win: "Win", lose: "Lose", test: "Test", favorites: "★ Fav",
                  };
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-1.5 ${
                        activeTab === tab
                          ? "bg-violet-600 text-white shadow-sm"
                          : "bg-[#111118] text-zinc-400 hover:text-violet-300 border border-violet-900/30 hover:border-violet-600/40"
                      }`}
                    >
                      {labels[tab]}
                      <span className={`text-xs font-normal tabular-nums ${
                        activeTab === tab ? "text-white/60" : "text-zinc-600"
                      }`}>
                        {tabCounts[tab]}
                      </span>
                    </button>
                  );
                })}

                <div className="ml-auto flex items-center gap-2 flex-wrap">
                  <select
                    value={activeSort}
                    onChange={(e) => setActiveSort(e.target.value as typeof activeSort)}
                    className="bg-[#111118] border border-violet-900/40 text-zinc-300 text-sm rounded-xl px-3 py-2 outline-none cursor-pointer hover:border-violet-600/50 transition"
                  >
                    <option value="none">Sort: default</option>
                    <option value="romi">ROMI ↓</option>
                    <option value="spend">Spend ↓</option>
                    <option value="deposits">Deposits ↓</option>
                  </select>

                  <select
                    value={activeApproach}
                    onChange={(e) => setActiveApproach(e.target.value)}
                    className="bg-[#111118] border border-violet-900/40 text-zinc-300 text-sm rounded-xl px-3 py-2 outline-none cursor-pointer hover:border-violet-600/50 transition"
                  >
                    <option value="all">All approaches</option>
                    {approaches.map((ap) => (
                      <option key={ap} value={ap}>{ap}</option>
                    ))}
                  </select>

                  {(search !== "" || activeTab !== "all" || activeApproach !== "all" || activeSort !== "none") && (
                    <button
                      onClick={() => { setSearch(""); setActiveTab("all"); setActiveApproach("all"); setActiveSort("none"); }}
                      className="px-3 py-2 rounded-xl text-sm text-zinc-400 border border-violet-900/30 hover:text-violet-300 hover:border-violet-600/40 transition"
                    >
                      ✕ Сбросить
                    </button>
                  )}
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl px-4 py-3 mb-8">
                ⚠ {error}
              </div>
            )}

            {loading ? (
              /* Skeleton */
              <div className="flex flex-col gap-3 md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 md:gap-4">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="bg-[#111118] border border-violet-900/20 rounded-2xl overflow-hidden animate-pulse">
                    <div className="hidden md:block aspect-square bg-violet-900/10" />
                    <div className="flex items-center justify-between px-4 pt-4 pb-3 gap-3">
                      <div className="h-4 bg-violet-900/20 rounded w-2/5" />
                      <div className="h-5 w-14 bg-violet-900/20 rounded-full" />
                    </div>
                    <div className="flex gap-3 px-4 pb-4 md:hidden">
                      <div className="w-24 h-24 flex-shrink-0 rounded-xl bg-violet-900/10" />
                      <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-3 content-start">
                        {Array.from({ length: 5 }).map((_, j) => (
                          <div key={j} className="h-3 bg-violet-900/20 rounded" />
                        ))}
                      </div>
                    </div>
                    <div className="hidden md:block px-4 pb-4">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                        {Array.from({ length: 5 }).map((_, j) => (
                          <div key={j} className="h-3 bg-violet-900/20 rounded" />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <SummaryPanel summary={summary} />

                {/* Virtual grid — only visible rows are rendered */}
                <div
                  ref={listRef}
                  style={{ position: "relative", height: `${virtualizer.getTotalSize()}px` }}
                >
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const rowItems = gridRows[virtualRow.index];
                    const gap = columnCount === 1 ? 12 : 16;
                    return (
                      <div
                        key={virtualRow.key}
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        style={{
                          position:              "absolute",
                          top:                   0,
                          left:                  0,
                          width:                 "100%",
                          transform:             `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                          display:               "grid",
                          gridTemplateColumns:   `repeat(${columnCount}, 1fr)`,
                          gap:                   `${gap}px`,
                          paddingBottom:         `${gap}px`,
                        }}
                      >
                        {rowItems.map((item) => (
                          <CreativeCard
                            key={item.creative}
                            item={item}
                            itemMedia={findMedia(item.creative, media)}
                            itemApproach={(() => {
                              const f = findMedia(item.creative, media);
                              return f ? getApproach(f.key) : "unknown";
                            })()}
                            itemNote={notes[item.creative]}
                            onSelect={handleSetSelected}
                            onToggleFavorite={toggleFavorite}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {topTab === "analytics" && (
          <AnalyticsView rows={rows} media={media} loading={loading} />
        )}
      </div>

      {selected && (
        <CreativeModal
          item={selected}
          mediaFile={findMedia(selected.creative, media)}
          note={notes[selected.creative]}
          onClose={() => setSelected(null)}
          onToggleFavorite={toggleFavorite}
          onNotesUpdated={(updated) =>
            setNotes((prev) => ({ ...prev, [updated.creative_code]: updated }))
          }
        />
      )}
    </main>
  );
}

// ─── CreativeCard — memoized to skip re-renders when props haven't changed ────

const CreativeCard = memo(function CreativeCard({
  item,
  itemMedia,
  itemApproach,
  itemNote,
  onSelect,
  onToggleFavorite,
}: CreativeCardProps) {
  return (
    <div
      onClick={() => onSelect(item)}
      className="bg-[#111118] border border-violet-900/30 rounded-2xl overflow-hidden cursor-pointer hover:border-violet-500/50 hover:shadow-[0_4px_24px_rgb(109_40_217/0.12)] transition"
    >
      {/* Desktop: full-width media at top */}
      <div className="hidden md:block">
        <MediaWide file={itemMedia} />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 gap-3 border-b border-violet-900/20">
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold text-white truncate">{item.creative}</div>
          {itemApproach !== "unknown" && (
            <span className="inline-block text-[10px] font-medium bg-violet-800/35 text-violet-100 border border-violet-700/40 px-1.5 py-0.5 rounded-full mt-1 truncate max-w-full">
              {itemApproach}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(item.creative); }}
            className={`text-base leading-none transition-colors ${
              itemNote?.favorite ? "text-yellow-400" : "text-zinc-700 hover:text-yellow-400"
            }`}
            title={itemNote?.favorite ? "Убрать из избранного" : "В избранное"}
          >
            ★
          </button>
          <RomiBadge value={item.romi} />
        </div>
      </div>

      {/* Mobile: square preview + metrics */}
      <div className="flex gap-4 p-4 md:hidden">
        <MediaSquare file={itemMedia} />
        <MetricsGrid item={item} />
      </div>

      {/* Desktop: metrics below header */}
      <div className="hidden md:block px-4 pt-3 pb-4">
        <MetricsGrid item={item} />
      </div>
    </div>
  );
});

// ─── RomiBadge ────────────────────────────────────────────────────────────────

function RomiBadge({ value }: { value: string }) {
  const num = parseNumber(value);
  const colorClass = isNaN(num)
    ? "bg-zinc-800 text-zinc-400"
    : num >= 150
    ? "bg-green-900/60 text-green-300 border border-green-700"
    : num >= 0
    ? "bg-yellow-900/60 text-yellow-300 border border-yellow-700"
    : "bg-red-900/60 text-red-300 border border-red-700";

  return (
    <span className={`inline-block text-xs font-bold px-2.5 py-0.5 rounded-full ${colorClass}`}>
      {value || "—"}
    </span>
  );
}

// ─── Media components ─────────────────────────────────────────────────────────

function MediaSquare({ file }: { file?: MediaFile }) {
  const wrapCls  = "w-24 h-24 flex-shrink-0 rounded-xl overflow-hidden bg-zinc-900";
  const mediaCls = "w-full h-full object-cover";

  if (!file) {
    return (
      <div className="w-24 h-24 flex-shrink-0 rounded-xl overflow-hidden flex items-center justify-center bg-gradient-to-br from-violet-900/25 to-[#0d0a1f]">
        <span className="text-2xl opacity-55">📷</span>
      </div>
    );
  }
  if (isVideo(file.url)) {
    // Если есть poster — показываем лёгкую картинку, видео не грузим
    if (file.posterUrl) {
      return (
        <div className={wrapCls}>
          <img src={file.posterUrl} alt="" loading="lazy" className={mediaCls} />
        </div>
      );
    }
    return (
      <div className={wrapCls}>
        <video src={file.url} muted loop playsInline preload="none" className={mediaCls} />
      </div>
    );
  }
  if (isImage(file.url)) {
    return (
      <div className={wrapCls}>
        <img src={file.url} alt="" loading="lazy" className={mediaCls} />
      </div>
    );
  }
  return (
    <div className="w-24 h-24 flex-shrink-0 rounded-xl overflow-hidden flex items-center justify-center bg-gradient-to-br from-violet-900/25 to-[#0d0a1f]">
      <span className="text-2xl opacity-55">📷</span>
    </div>
  );
}

function MediaWide({ file }: { file?: MediaFile }) {
  const wrapCls  = "w-full aspect-square bg-zinc-900";
  const mediaCls = "w-full h-full object-cover";

  if (!file) {
    return (
      <div className="w-full aspect-square flex items-center justify-center bg-gradient-to-br from-violet-900/20 to-[#0a080f]">
        <span className="text-5xl opacity-40">📷</span>
      </div>
    );
  }
  if (isVideo(file.url)) {
    // Если есть poster — показываем лёгкую картинку, видео не грузим
    if (file.posterUrl) {
      return (
        <div className={wrapCls}>
          <img src={file.posterUrl} alt="" loading="lazy" className={mediaCls} />
        </div>
      );
    }
    return (
      <div className={wrapCls}>
        <video src={file.url} muted loop playsInline preload="none" className={mediaCls} />
      </div>
    );
  }
  if (isImage(file.url)) {
    return (
      <div className={wrapCls}>
        <img src={file.url} alt="" loading="lazy" className={mediaCls} />
      </div>
    );
  }
  return (
    <div className="w-full aspect-square flex items-center justify-center bg-gradient-to-br from-violet-900/20 to-[#0a080f]">
      <span className="text-5xl opacity-40">📷</span>
    </div>
  );
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

function MetricsGrid({ item }: { item: CreativeRow }) {
  return (
    <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-4 gap-y-2 content-start">
      <MetricCell label="Spend"    value={item.spend}    emphasis />
      <MetricCell label="Revenue"  value={item.revenue} />
      <MetricCell label="Deposits" value={item.deposits} />
      <MetricCell label="Цена PDP" value={item.pdp} />
      <MetricCell label="Цена DIA" value={item.dia} />
    </div>
  );
}

function MetricCell({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <div className="text-zinc-500 text-xs leading-none mb-0.5">{label}</div>
      <div className={`text-sm font-semibold truncate ${emphasis ? "text-white" : "text-zinc-200"}`}>
        {value || "—"}
      </div>
    </div>
  );
}

// ─── CreativeModal ────────────────────────────────────────────────────────────

function CreativeModal({
  item,
  mediaFile,
  note,
  onClose,
  onToggleFavorite,
  onNotesUpdated,
}: {
  item: CreativeRow;
  mediaFile?: MediaFile;
  note?: CreativeNote;
  onClose: () => void;
  onToggleFavorite: (code: string) => void;
  onNotesUpdated: (updated: CreativeNote) => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const [noteText,            setNoteText]            = useState(note?.note ?? "");
  const [noteStatus,          setNoteStatus]          = useState<SaveStatus>("idle");
  const [noteEditing,         setNoteEditing]         = useState(false);
  const [noteDraft,           setNoteDraft]           = useState("");
  const [transcriptionText,   setTranscriptionText]   = useState(note?.transcription_ru || item.text);
  const [transcriptionStatus, setTranscriptionStatus] = useState<SaveStatus>("idle");
  const [transcriptionEditing,setTranscriptionEditing]= useState(false);
  const [transcriptionDraft,  setTranscriptionDraft]  = useState("");

  async function saveField(
    field: "note" | "transcription_ru",
    value: string,
    setStatus: (s: SaveStatus) => void,
    onSuccess?: () => void
  ) {
    if (!isSupabaseConfigured) { console.warn("Supabase не настроен — сохранение недоступно"); return; }
    setStatus("saving");
    const payload: CreativeNote = {
      creative_code:    item.creative,
      favorite:         note?.favorite ?? false,
      note:             field === "note" ? (value.trim() || null) : (note?.note ?? null),
      transcription_ru: field === "transcription_ru" ? (value.trim() || null) : (note?.transcription_ru ?? null),
      updated_at:       new Date().toISOString(),
    };
    try {
      const { error } = await supabase.from("creative_notes").upsert(payload, { onConflict: "creative_code" });
      if (error) throw error;
      onNotesUpdated(payload);
      onSuccess?.();
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      console.error("Ошибка сохранения:", e);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  const approach = mediaFile ? getApproach(mediaFile.key) : "unknown";
  const romiNum  = parseNumber(item.romi);

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 overflow-y-auto flex items-start md:items-center justify-center p-4 md:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[1200px] bg-[#0d0b14] border border-violet-900/40 rounded-2xl md:rounded-3xl overflow-hidden my-4 md:my-0 md:max-h-[88vh] flex flex-col md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* LEFT: media */}
        <div className="bg-[#080710] flex items-center justify-center flex-shrink-0 min-h-[220px] md:min-h-0 md:w-[55%] md:self-stretch">
          {mediaFile ? (
            isVideo(mediaFile.url) ? (
              <video src={mediaFile.url} controls autoPlay loop poster={mediaFile.posterUrl} className="w-full h-full object-contain" />
            ) : (
              <img src={mediaFile.url} alt={item.creative} className="w-full h-full object-contain" />
            )
          ) : (
            <div className="w-full h-full min-h-[220px] flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-violet-900/30 to-[#080710]">
              <span className="text-5xl opacity-40">🎬</span>
              <p className="text-white/75 text-sm font-semibold text-center px-6">
                Крео отошел на дейлик 😄
              </p>
            </div>
          )}
        </div>

        {/* RIGHT: analytics panel */}
        <div className="flex flex-col flex-1 min-w-0 overflow-y-auto md:max-h-[88vh]">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 p-5 border-b border-violet-900/30 flex-shrink-0">
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-bold text-white leading-tight truncate">{item.creative}</h2>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <RomiBadge value={item.romi} />
                {approach !== "unknown" && (
                  <span className="text-xs font-medium text-violet-100 bg-violet-800/35 px-2.5 py-0.5 rounded-full border border-violet-600/40">
                    {approach}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => onToggleFavorite(item.creative)}
                className={`w-9 h-9 flex items-center justify-center rounded-xl transition text-xl ${
                  note?.favorite
                    ? "text-yellow-400 bg-yellow-900/30 hover:bg-yellow-900/50"
                    : "text-zinc-600 bg-[#1a1826] hover:text-yellow-400 hover:bg-[#221e35]"
                }`}
                title={note?.favorite ? "Убрать из избранного" : "В избранное"}
              >
                {note?.favorite ? "★" : "☆"}
              </button>
              <button
                onClick={onClose}
                className="flex-shrink-0 text-zinc-400 hover:text-white bg-[#1a1826] hover:bg-[#221e35] rounded-xl w-9 h-9 flex items-center justify-center transition text-lg"
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-5 space-y-5">
            {/* Metrics */}
            <div>
              <div className="text-violet-400/50 text-xs uppercase tracking-widest mb-3">Метрики</div>
              <div className="grid grid-cols-2 gap-3">
                <ModalMetric label="Spend"    value={item.spend} />
                <ModalMetric label="Revenue"  value={item.revenue} />
                <ModalMetric label="Deposits" value={item.deposits} />
                <ModalMetric label="ROMI"     value={item.romi} romiValue={romiNum} />
                <ModalMetric label="Цена PDP" value={item.pdp} />
                <ModalMetric label="Цена DIA" value={item.dia} />
              </div>
            </div>

            {/* Расшифровка */}
            <div className="bg-[#0f0d18] border border-violet-900/20 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-violet-400/50 text-xs uppercase tracking-widest">Расшифровка</div>
                {!transcriptionEditing && (
                  <button
                    onClick={() => { setTranscriptionDraft(transcriptionText); setTranscriptionEditing(true); }}
                    className="text-xs text-violet-400/60 hover:text-violet-300 transition"
                  >
                    Редактировать
                  </button>
                )}
              </div>
              {transcriptionEditing ? (
                <>
                  <textarea
                    value={transcriptionDraft}
                    onChange={(e) => setTranscriptionDraft(e.target.value)}
                    rows={6} autoFocus placeholder="Расшифровка пока не добавлена"
                    className="w-full bg-[#1a1826] border border-violet-900/30 rounded-lg px-3 py-2 text-sm text-zinc-300 resize-none outline-none focus:border-violet-600/50 transition placeholder:text-zinc-600 mb-3"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => saveField("transcription_ru", transcriptionDraft, setTranscriptionStatus, () => { setTranscriptionText(transcriptionDraft); setTranscriptionEditing(false); })}
                      disabled={!isSupabaseConfigured || transcriptionStatus === "saving"}
                      className="px-3 py-1.5 text-xs font-semibold bg-violet-600 text-white hover:bg-violet-500 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {transcriptionStatus === "saving" ? "Saving..." : "Save"}
                    </button>
                    <button onClick={() => setTranscriptionEditing(false)} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition">Отмена</button>
                    {transcriptionStatus === "error" && <span className="text-red-400 text-xs">Ошибка сохранения</span>}
                  </div>
                </>
              ) : (
                <>
                  {transcriptionText
                    ? <p className="text-zinc-300 text-sm whitespace-pre-wrap leading-relaxed">{transcriptionText}</p>
                    : <p className="text-zinc-600 text-sm italic">Расшифровка пока не добавлена</p>
                  }
                  {transcriptionStatus === "saved" && <p className="text-green-400 text-xs mt-2">✓ Сохранено</p>}
                </>
              )}
            </div>

            {/* Заметки */}
            <div className="bg-[#0f0d18] border border-violet-900/20 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-violet-400/50 text-xs uppercase tracking-widest">Заметки</div>
                {!noteEditing && (
                  <button
                    onClick={() => { setNoteDraft(noteText); setNoteEditing(true); }}
                    className="text-xs text-violet-400/60 hover:text-violet-300 transition"
                  >
                    Редактировать
                  </button>
                )}
              </div>
              {noteEditing ? (
                <>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={4} autoFocus placeholder="Добавьте заметку..."
                    className="w-full bg-[#1a1826] border border-violet-900/30 rounded-lg px-3 py-2 text-sm text-zinc-300 resize-none outline-none focus:border-violet-600/50 transition placeholder:text-zinc-600 mb-3"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => saveField("note", noteDraft, setNoteStatus, () => { setNoteText(noteDraft); setNoteEditing(false); })}
                      disabled={!isSupabaseConfigured || noteStatus === "saving"}
                      className="px-3 py-1.5 text-xs font-semibold bg-violet-600 text-white hover:bg-violet-500 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {noteStatus === "saving" ? "Saving..." : "Save"}
                    </button>
                    <button onClick={() => setNoteEditing(false)} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition">Отмена</button>
                    {noteStatus === "error" && <span className="text-red-400 text-xs">Ошибка сохранения</span>}
                  </div>
                </>
              ) : (
                <>
                  {noteText
                    ? <p className="text-zinc-300 text-sm whitespace-pre-wrap leading-relaxed">{noteText}</p>
                    : <p className="text-zinc-600 text-sm italic">Заметка пока не добавлена</p>
                  }
                  {noteStatus === "saved" && <p className="text-green-400 text-xs mt-2">✓ Сохранено</p>}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ModalMetric ──────────────────────────────────────────────────────────────

function ModalMetric({ label, value, romiValue }: { label: string; value: string; romiValue?: number }) {
  const isRomi = romiValue !== undefined;
  const valueColor = isRomi
    ? isNaN(romiValue) ? "text-zinc-300" : romiValue >= 150 ? "text-green-300" : romiValue >= 0 ? "text-yellow-300" : "text-red-300"
    : "text-white";
  const borderColor = isRomi
    ? isNaN(romiValue) ? "border-violet-900/20" : romiValue >= 150 ? "border-green-800/50" : romiValue >= 0 ? "border-yellow-800/50" : "border-red-800/50"
    : "border-violet-900/20";

  return (
    <div className={`bg-[#111118]/60 border rounded-xl p-4 ${borderColor}`}>
      <div className="text-zinc-500 text-xs mb-1.5">{label}</div>
      <div className={`text-lg font-bold truncate ${valueColor}`}>{value || "—"}</div>
    </div>
  );
}

// ─── Summary panel ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, colorClass = "text-white" }: { label: string; value: string; colorClass?: string }) {
  return (
    <div className="bg-[#111118] border border-violet-900/30 rounded-xl px-4 py-3">
      <div className="text-zinc-500 text-xs mb-1 truncate">{label}</div>
      <div className={`text-lg font-bold tabular-nums truncate ${colorClass}`}>{value}</div>
    </div>
  );
}

function SummaryPanel({ summary }: {
  summary: { total: number; totalSpend: number; totalRevenue: number; totalDeposits: number; totalRomi: number; winners: number; losers: number; tests: number; };
}) {
  const romiColor = summary.totalRomi >= 150 ? "text-green-300" : summary.totalRomi >= 0 ? "text-yellow-300" : "text-red-300";
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <SummaryCard label="Всего крео"     value={String(summary.total)} />
      <SummaryCard label="Total ROMI"     value={formatRomiPct(summary.totalRomi)}         colorClass={romiColor} />
      <SummaryCard label="Winners"        value={String(summary.winners)}                  colorClass="text-green-300" />
      <SummaryCard label="Losers"         value={String(summary.losers)}                   colorClass="text-red-300" />
      <SummaryCard label="Total Spend"    value={formatSummaryNumber(summary.totalSpend)} />
      <SummaryCard label="Total Revenue"  value={formatSummaryNumber(summary.totalRevenue)} />
      <SummaryCard label="Total Deposits" value={formatSummaryNumber(summary.totalDeposits)} />
      <SummaryCard label="Tests"          value={String(summary.tests)}                    colorClass="text-purple-300" />
    </div>
  );
}

// ─── Analytics view ───────────────────────────────────────────────────────────

function AnalyticsView({ rows, media, loading }: { rows: CreativeRow[]; media: MediaFile[]; loading: boolean }) {
  const analytics = useMemo(() => {
    if (rows.length === 0) return null;

    const romiDist = [
      { label: "< 0%",       color: "bg-red-500/70",     count: 0 },
      { label: "0 – 50%",    color: "bg-yellow-500/70",  count: 0 },
      { label: "50 – 150%",  color: "bg-orange-400/70",  count: 0 },
      { label: "150 – 300%", color: "bg-green-500/70",   count: 0 },
      { label: "300%+",      color: "bg-emerald-400/70", count: 0 },
    ];
    let romiWithData = 0;
    for (const item of rows) {
      const romi = parseNumber(item.romi);
      if (isNaN(romi)) continue;
      romiWithData++;
      if      (romi < 0)   romiDist[0].count++;
      else if (romi < 50)  romiDist[1].count++;
      else if (romi < 150) romiDist[2].count++;
      else if (romi < 300) romiDist[3].count++;
      else                 romiDist[4].count++;
    }

    const spendMap = new Map<string, number>();
    for (const item of rows) {
      const spend = parseNumber(item.spend);
      if (isNaN(spend) || spend <= 0) continue;
      const file     = findMedia(item.creative, media);
      const approach = file ? getApproach(file.key) : "unknown";
      spendMap.set(approach, (spendMap.get(approach) ?? 0) + spend);
    }
    const spendByApproach = [...spendMap.entries()].sort((a, b) => b[1] - a[1]);

    const winnersMap = new Map<string, number>();
    for (const item of rows) {
      if (parseNumber(item.romi) < 150) continue;
      const file     = findMedia(item.creative, media);
      const approach = file ? getApproach(file.key) : "unknown";
      winnersMap.set(approach, (winnersMap.get(approach) ?? 0) + 1);
    }
    const winnersByApproach = [...winnersMap.entries()].sort((a, b) => b[1] - a[1]);

    const top10Romi = [...rows]
      .filter((r) => !isNaN(parseNumber(r.romi)) && parseNumber(r.spend) > 0)
      .sort((a, b) => parseNumber(b.romi) - parseNumber(a.romi))
      .slice(0, 10);

    const top10Deposits = [...rows]
      .filter((r) => parseNumber(r.deposits) > 0)
      .sort((a, b) => parseNumber(b.deposits) - parseNumber(a.deposits))
      .slice(0, 10);

    return { romiDist, romiWithData, spendByApproach, winnersByApproach, top10Romi, top10Deposits };
  }, [rows, media]);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-52 bg-[#111118] border border-violet-900/20 rounded-2xl" />
        <div className="grid md:grid-cols-2 gap-6">
          <div className="h-64 bg-[#111118] border border-violet-900/20 rounded-2xl" />
          <div className="h-64 bg-[#111118] border border-violet-900/20 rounded-2xl" />
        </div>
        <div className="h-72 bg-[#111118] border border-violet-900/20 rounded-2xl" />
        <div className="h-72 bg-[#111118] border border-violet-900/20 rounded-2xl" />
      </div>
    );
  }

  if (!analytics) return <p className="text-zinc-500 text-sm mt-8">Нет данных для аналитики.</p>;

  const { romiDist, romiWithData, spendByApproach, winnersByApproach, top10Romi, top10Deposits } = analytics;
  const maxRomiCount = Math.max(...romiDist.map((b) => b.count), 1);
  const maxSpend     = Math.max(...spendByApproach.map(([, v]) => v), 1);
  const maxWinners   = Math.max(...winnersByApproach.map(([, v]) => v), 1);

  return (
    <div className="space-y-6 pb-8">
      {/* ROMI Distribution */}
      <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
        <h2 className="text-base font-bold mb-1">ROMI Distribution</h2>
        <p className="text-zinc-500 text-xs mb-5">{romiWithData} из {rows.length} крео с данными ROMI</p>
        <div className="space-y-3">
          {romiDist.map((bucket) => (
            <div key={bucket.label} className="flex items-center gap-3">
              <div className="w-24 text-xs text-zinc-400 text-right flex-shrink-0">{bucket.label}</div>
              <div className="flex-1 h-6 bg-violet-900/15 rounded-lg overflow-hidden">
                <div
                  className={`h-full ${bucket.color} rounded-lg transition-all`}
                  style={{ width: bucket.count === 0 ? "0%" : `${Math.max((bucket.count / maxRomiCount) * 100, 2)}%` }}
                />
              </div>
              <div className="w-8 text-xs text-zinc-300 tabular-nums text-right">{bucket.count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Spend + Winners by Approach */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
          <h2 className="text-base font-bold mb-5">Spend by Approach</h2>
          <div className="space-y-3">
            {spendByApproach.map(([approach, spend]) => (
              <div key={approach} className="flex items-center gap-3">
                <div className="w-24 text-xs text-zinc-400 text-right truncate flex-shrink-0">{approach}</div>
                <div className="flex-1 h-5 bg-violet-900/15 rounded-lg overflow-hidden">
                  <div className="h-full bg-violet-500/60 rounded-lg" style={{ width: `${(spend / maxSpend) * 100}%` }} />
                </div>
                <div className="w-20 text-xs text-zinc-300 tabular-nums text-right">{formatSummaryNumber(spend)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
          <h2 className="text-base font-bold mb-5">Winners by Approach</h2>
          <div className="space-y-3">
            {winnersByApproach.map(([approach, count]) => (
              <div key={approach} className="flex items-center gap-3">
                <div className="w-24 text-xs text-zinc-400 text-right truncate flex-shrink-0">{approach}</div>
                <div className="flex-1 h-5 bg-violet-900/15 rounded-lg overflow-hidden">
                  <div className="h-full bg-green-500/60 rounded-lg" style={{ width: `${(count / maxWinners) * 100}%` }} />
                </div>
                <div className="w-8 text-xs text-zinc-300 tabular-nums text-right">{count}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top 10 by ROMI */}
      <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
        <h2 className="text-base font-bold mb-5">Top 10 by ROMI</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-zinc-500 text-xs border-b border-violet-900/30">
                <th className="text-left font-medium pb-3 pr-4">Creative</th>
                <th className="text-right font-medium pb-3 px-4 w-20">ROMI</th>
                <th className="text-right font-medium pb-3 px-4 w-24">Spend</th>
                <th className="text-right font-medium pb-3 w-24">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {top10Romi.map((item, i) => {
                const romi    = parseNumber(item.romi);
                const romiCls = romi >= 150 ? "text-green-300" : romi >= 0 ? "text-yellow-300" : "text-red-300";
                return (
                  <tr key={item.creative} className="border-b border-violet-900/15 hover:bg-violet-900/10 transition-colors">
                    <td className="py-2.5 pr-4">
                      <span className="text-zinc-600 text-xs tabular-nums mr-2">{i + 1}</span>
                      <span className="text-zinc-200">{item.creative}</span>
                    </td>
                    <td className={`py-2.5 px-4 text-right font-bold tabular-nums ${romiCls}`}>{item.romi || "—"}</td>
                    <td className="py-2.5 px-4 text-right text-zinc-300 tabular-nums">{item.spend || "—"}</td>
                    <td className="py-2.5 text-right text-zinc-300 tabular-nums">{item.revenue || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top 10 by Deposits */}
      <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
        <h2 className="text-base font-bold mb-5">Top 10 by Deposits</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-zinc-500 text-xs border-b border-violet-900/30">
                <th className="text-left font-medium pb-3 pr-4">Creative</th>
                <th className="text-right font-medium pb-3 px-4 w-24">Deposits</th>
                <th className="text-right font-medium pb-3 px-4 w-24">Spend</th>
                <th className="text-right font-medium pb-3 w-20">ROMI</th>
              </tr>
            </thead>
            <tbody>
              {top10Deposits.map((item, i) => {
                const romi    = parseNumber(item.romi);
                const romiCls = romi >= 150 ? "text-green-300" : romi >= 0 ? "text-yellow-300" : "text-red-300";
                return (
                  <tr key={item.creative} className="border-b border-violet-900/15 hover:bg-violet-900/10 transition-colors">
                    <td className="py-2.5 pr-4">
                      <span className="text-zinc-600 text-xs tabular-nums mr-2">{i + 1}</span>
                      <span className="text-zinc-200">{item.creative}</span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-bold text-white tabular-nums">{item.deposits || "—"}</td>
                    <td className="py-2.5 px-4 text-right text-zinc-300 tabular-nums">{item.spend || "—"}</td>
                    <td className={`py-2.5 text-right font-bold tabular-nums ${romiCls}`}>{item.romi || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
