"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { supabase, isSupabaseConfigured, selectAllRows, currentUserId, type CreativeNote } from "@/lib/supabase";
import type { CreativeRow } from "@/lib/creatives/types";
import { loadCreativeRows } from "@/lib/creatives/loadCreativeRows";
import { type MediaFile, buildMediaIndex, lookupMedia, isVideo, isImage, getApproach } from "@/lib/creatives/media";
import { parseNumber, formatSummaryNumber, formatRomiPct } from "@/lib/creatives/format";
import CreativeModal from "@/components/CreativeModal";
import RomiBadge from "@/components/RomiBadge";
import MediaLibrary from "@/components/MediaLibrary";
import CreativeUploadModal from "./CreativeUploadModal";

type CreativeCardProps = {
  item: CreativeRow;
  itemMedia: MediaFile | undefined;
  itemMediaExact: boolean; // false = matched by base name (geo/variant suffix stripped), not the exact file
  itemApproach: string;
  itemNote: CreativeNote | undefined;
  supabaseAvailable: boolean;
  onSelect: (item: CreativeRow) => void;
  onToggleFavorite: (code: string) => void;
};

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
  const [contentVisible, setContentVisible] = useState(false);
  const [csvError,   setCsvError]   = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [activeTab,  setActiveTab]  = useState<"all" | "win" | "lose" | "test" | "favorites">("all");
  const [activeApproach, setActiveApproach] = useState("all");
  const [activeSort, setActiveSort] = useState<"none" | "romi" | "spend" | "deposits">("none");
  const [topTab,     setTopTab]     = useState<"creatives" | "analytics">("creatives");
  const [showUpload, setShowUpload] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [notes,      setNotes]      = useState<Record<string, CreativeNote>>({});
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesError, setNotesError] = useState<string | null>(null);
  // Known geo/variant naming suffixes ("es", "ar", "v2"...) — lets matching fall back
  // from an exact filename to a shared base name (edit1-ar -> edit1). Editable in Медиатека.
  const [matchSuffixes, setMatchSuffixes] = useState<string[]>([]);

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

  // Два флажка, но живут они в разных таблицах: избранное личное, «скрыт» общий
  // для всей библиотеки (supabase/007_user_notes.sql).
  const toggleFlag = useCallback(async (field: "favorite" | "ignored", creativeCode: string) => {
    if (!isSupabaseConfigured) {
      console.warn(`Supabase не настроен — toggle ${field} недоступен`);
      return;
    }
    const existing = notesRef.current[creativeCode];
    const newValue  = !(existing?.[field] ?? false);

    const updated: CreativeNote = existing
      ? { ...existing, [field]: newValue, updated_at: new Date().toISOString() }
      : {
          creative_code: creativeCode,
          favorite: false,
          note: null,
          transcription_ru: null,
          ignored: false,
          [field]: newValue,
          updated_at: new Date().toISOString(),
        };

    setNotes((prev) => ({ ...prev, [creativeCode]: updated }));

    try {
      // Пишем только то поле, которое меняли. Раньше уходила строка целиком, и
      // клик по избранному возвращал назад расшифровку, прочитанную при открытии
      // страницы, — воркер мог дописать её в промежутке, и она стиралась.
      if (field === "favorite") {
        const { error } = await supabase
          .from("creative_user_notes")
          .upsert(
            { user_id: await currentUserId(), creative_code: creativeCode, favorite: newValue, note: updated.note, updated_at: updated.updated_at },
            { onConflict: "user_id,creative_code" }
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("creative_notes")
          .upsert(
            { creative_code: creativeCode, ignored: newValue, updated_at: updated.updated_at },
            { onConflict: "creative_code" }
          );
        if (error) throw error;
      }
    } catch (e) {
      console.error(`Ошибка сохранения ${field}:`, e);
      setNotes((prev) => {
        const reverted = { ...prev };
        if (existing) reverted[creativeCode] = existing;
        else          delete reverted[creativeCode];
        return reverted;
      });
    }
  }, []); // stable — reads latest notes from notesRef

  const toggleFavorite = useCallback((creativeCode: string) => toggleFlag("favorite", creativeCode), [toggleFlag]);
  const toggleIgnored  = useCallback((creativeCode: string) => toggleFlag("ignored", creativeCode), [toggleFlag]);

  const handleSetSelected = useCallback((item: CreativeRow) => setSelected(item), []);

  // ─── Data loading ────────────────────────────────────────────────────────

  // fresh=true bypasses the browser/CDN cache (cache-busting query + no-store) — used after
  // an upload/rename/delete, where the R2 list must reflect the change immediately instead
  // of the up-to-10-minute Cache-Control on /api/media (fine for the initial page load).
  const loadMedia = useCallback(async (fresh = false) => {
    try {
      const url = fresh ? `/api/media?_=${Date.now()}` : "/api/media";
      const res = await fetch(url, fresh ? { cache: "no-store" } : undefined);
      if (!res.ok) throw new Error(`Media: ошибка сети ${res.status}`);
      const data = await res.json();
      setMedia(Array.isArray(data) ? data : []);
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : "Не удалось загрузить медиа");
    } finally {
      setMediaLoading(false);
    }
  }, []);

  const loadMatchSuffixes = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error } = await supabase.from("creative_match_suffixes").select("suffix");
    if (error) { console.error("Ошибка загрузки суффиксов мэтчинга:", error); return; }
    setMatchSuffixes((data ?? []).map((r) => r.suffix as string));
  }, []);

  const matchSuffixSet = useMemo(() => new Set(matchSuffixes), [matchSuffixes]);
  // Индекс перестраивается только при смене медиа или суффиксов. Раньше каждый поиск
  // линейно проходил весь список файлов, а вызывался он для каждого крео на каждое нажатие
  // клавиши при активном фильтре подходов.
  const mediaIndex = useMemo(() => buildMediaIndex(media, matchSuffixSet), [media, matchSuffixSet]);
  const findMedia = useCallback((creative: string) => lookupMedia(mediaIndex, creative), [mediaIndex]);

  useEffect(() => {
    async function loadCSV() {
      try {
        setRows(await loadCreativeRows());
      } catch (e) {
        setCsvError(e instanceof Error ? e.message : "Не удалось загрузить данные");
      } finally {
        setCsvLoading(false);
      }
    }

    async function loadNotes() {
      if (!isSupabaseConfigured) { setNotesLoading(false); return; }
      try {
        // Две таблицы: общая про файлы и своя личная. Обе читаются постранично —
        // без этого приезжала бы только первая тысяча строк, молча.
        const [shared, mine] = await Promise.all([
          selectAllRows<{ creative_code: string; transcription_ru: string | null; ignored: boolean | null; updated_at: string }>(
            "creative_notes", "creative_code, transcription_ru, ignored, updated_at"
          ),
          selectAllRows<{ creative_code: string; favorite: boolean; note: string | null; updated_at: string }>(
            "creative_user_notes", "creative_code, favorite, note, updated_at"
          ),
        ]);

        const map: Record<string, CreativeNote> = {};
        for (const row of shared) {
          map[row.creative_code] = {
            creative_code: row.creative_code,
            favorite: false,
            note: null,
            transcription_ru: row.transcription_ru,
            ignored: row.ignored ?? false,
            updated_at: row.updated_at,
          };
        }
        for (const row of mine) {
          const base = map[row.creative_code];
          map[row.creative_code] = base
            ? { ...base, favorite: row.favorite, note: row.note }
            : {
                creative_code: row.creative_code,
                favorite: row.favorite,
                note: row.note,
                transcription_ru: null,
                ignored: false,
                updated_at: row.updated_at,
              };
        }
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
    loadMatchSuffixes();
  }, [loadMedia, loadMatchSuffixes]);

  useEffect(() => {
    if (!csvLoading && !mediaLoading) {
      const frame = requestAnimationFrame(() => setContentVisible(true));
      return () => cancelAnimationFrame(frame);
    }
  }, [csvLoading, mediaLoading]);

  // ─── Derived state ───────────────────────────────────────────────────────

  // CSV + media are critical — they block the grid.
  // Notes are not critical — Supabase failure should not block creatives.
  const loading = csvLoading || mediaLoading;
  const error   = csvError || mediaError;
  // True only when Supabase is configured but the load request failed (paused project, network issue).
  const supabaseDown = isSupabaseConfigured && !!notesError;

  const approaches = useMemo(() => {
    const set = new Set(rows.map((item) => getApproach(item.creative, findMedia(item.creative)?.file.key)));
    return Array.from(set).sort();
  }, [rows, findMedia]);

  const tabCounts = useMemo(() => {
    const base = rows
      .filter((item) => item.creative.toLowerCase().includes(search.toLowerCase()))
      .filter((item) => {
        if (activeApproach === "all") return true;
        return getApproach(item.creative, findMedia(item.creative)?.file.key) === activeApproach;
      });
    return {
      all:       base.length,
      win:       base.filter((item) => parseNumber(item.romi) >= 150).length,
      lose:      base.filter((item) => parseNumber(item.romi) < 0 && parseNumber(item.spend) > 1000).length,
      test:      base.filter((item) => parseNumber(item.spend) < 1000).length,
      favorites: base.filter((item) => notes[item.creative]?.favorite === true).length,
    };
  }, [rows, search, activeApproach, notes, findMedia]);

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
        return getApproach(item.creative, findMedia(item.creative)?.file.key) === activeApproach;
      })
      .sort(sortFn);
  }, [rows, search, activeTab, activeApproach, activeSort, notes, findMedia]);

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

  if (loading) return <LoadingScreen />;

  return (
    <main
      className="min-h-screen bg-[#0a080f] text-white p-8"
      style={{ animation: contentVisible ? "dashboard-fade-in 0.45s ease forwards" : "none", opacity: contentVisible ? undefined : 0 }}
    >
      <div className="max-w-7xl mx-auto">

        {/* Вкладки этой страницы */}
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

                  <button
                    onClick={() => setShowLibrary(true)}
                    className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm hover:from-violet-500 hover:to-violet-400 transition flex items-center gap-1.5"
                  >
                    📁 Медиатека
                  </button>

                  <button
                    onClick={() => setShowUpload(true)}
                    className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm hover:from-violet-500 hover:to-violet-400 transition flex items-center gap-1.5"
                  >
                    ⬆ Загрузить
                  </button>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl px-4 py-3 mb-4">
                ⚠ {error}
              </div>
            )}

            {supabaseDown && (
              <div className="flex items-center gap-2 bg-amber-950/40 border border-amber-700/30 text-amber-300/80 rounded-xl px-4 py-2.5 mb-6 text-sm">
                <span className="flex-shrink-0">⚠</span>
                <span>Заметки и избранное временно недоступны — Supabase не отвечает</span>
              </div>
            )}

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
                      {rowItems.map((item) => {
                        const match = findMedia(item.creative);
                        return (
                          <CreativeCard
                            key={item.creative}
                            item={item}
                            itemMedia={match?.file}
                            itemMediaExact={match?.exact ?? true}
                            itemApproach={getApproach(item.creative, match?.file.key)}
                            itemNote={notes[item.creative]}
                            supabaseAvailable={!supabaseDown}
                            onSelect={handleSetSelected}
                            onToggleFavorite={toggleFavorite}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </>
          </>
        )}

        {topTab === "analytics" && (
          <AnalyticsView rows={rows} media={media} matchSuffixes={matchSuffixes} />
        )}
      </div>

      {selected && (
        <CreativeModal
          item={selected}
          mediaFile={findMedia(selected.creative)?.file}
          note={notes[selected.creative]}
          supabaseAvailable={!supabaseDown}
          onClose={() => setSelected(null)}
          onToggleFavorite={toggleFavorite}
          onNotesUpdated={(updated) =>
            setNotes((prev) => ({ ...prev, [updated.creative_code]: updated }))
          }
        />
      )}

      {showUpload && (
        <CreativeUploadModal onClose={() => setShowUpload(false)} onUploaded={() => loadMedia(true)} />
      )}

      {showLibrary && (
        <MediaLibrary
          rows={rows}
          media={media}
          notes={notes}
          matchSuffixes={matchSuffixes}
          supabaseAvailable={!supabaseDown}
          onRefresh={() => loadMedia(true)}
          onSuffixesChanged={loadMatchSuffixes}
          onToggleIgnored={toggleIgnored}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </main>
  );
}

// ─── CreativeCard — memoized to skip re-renders when props haven't changed ────

const CreativeCard = memo(function CreativeCard({
  item,
  itemMedia,
  itemMediaExact,
  itemApproach,
  itemNote,
  supabaseAvailable,
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
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {itemApproach !== "unknown" && (
              <span className="inline-block text-[10px] font-medium bg-violet-800/35 text-violet-100 border border-violet-700/40 px-1.5 py-0.5 rounded-full truncate max-w-full">
                {itemApproach}
              </span>
            )}
            {itemMedia && !itemMediaExact && (
              <span
                className="inline-block text-[10px] font-medium bg-amber-800/25 text-amber-300/90 border border-amber-700/40 px-1.5 py-0.5 rounded-full"
                title="Точного файла нет — превью подставлено по похожему названию"
              >
                ≈ похоже
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); if (supabaseAvailable) onToggleFavorite(item.creative); }}
            disabled={!supabaseAvailable}
            className={`text-base leading-none transition-colors ${
              !supabaseAvailable
                ? "text-zinc-700 opacity-30 cursor-not-allowed"
                : itemNote?.favorite
                ? "text-yellow-400"
                : "text-zinc-700 hover:text-yellow-400"
            }`}
            title={!supabaseAvailable ? "Избранное временно недоступно" : itemNote?.favorite ? "Убрать из избранного" : "В избранное"}
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

// ─── Loading screen ───────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-[#0a080f] flex flex-col items-center justify-center z-50">
      <div className="flex flex-col items-center gap-8 animate-pulse">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="Genesis" className="h-28 w-auto object-contain" />
        <div className="flex flex-col items-center gap-3">
          <div className="w-48 h-0.5 bg-gradient-to-r from-transparent via-violet-600/50 to-transparent rounded-full" />
          <p className="text-violet-300/50 text-sm font-medium tracking-[0.2em] uppercase">
            Loading Creative Dashboard...
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Analytics view ───────────────────────────────────────────────────────────

function AnalyticsView({ rows, media, matchSuffixes }: { rows: CreativeRow[]; media: MediaFile[]; matchSuffixes: string[] }) {
  const suffixSet = useMemo(() => new Set(matchSuffixes), [matchSuffixes]);
  const index = useMemo(() => buildMediaIndex(media, suffixSet), [media, suffixSet]);
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
      const match    = lookupMedia(index, item.creative);
      const approach = getApproach(item.creative, match?.file.key);
      spendMap.set(approach, (spendMap.get(approach) ?? 0) + spend);
    }
    const spendByApproach = [...spendMap.entries()].sort((a, b) => b[1] - a[1]);

    const winnersMap = new Map<string, number>();
    for (const item of rows) {
      if (parseNumber(item.romi) < 150) continue;
      const match    = lookupMedia(index, item.creative);
      const approach = getApproach(item.creative, match?.file.key);
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
  }, [rows, index]);

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
