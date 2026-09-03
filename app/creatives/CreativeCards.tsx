"use client";

import { useCallback, useMemo, useState } from "react";
import CreativeModal from "@/components/CreativeModal";
import RomiBadge from "@/components/RomiBadge";
import { MediaWide } from "@/components/CreativeMedia";
import { buildMediaIndex, lookupMedia, type MediaFile } from "@/lib/creatives/media";
import { isSupabaseConfigured, supabase, currentUserId, type CreativeNote } from "@/lib/supabase";
import type { CreativesResult, CreativeRow } from "@/lib/warehouse/creatives";
import { toLegacy } from "./toLegacy";

// Плитка новой картотеки: то же, что на легаси-странице, но за выбранный период.
//
// Строки задаёт склад — это объявления, которые реально крутились за период.
// Файл к строке ищется по ВСЕМУ бакету R2, без фильтра по владельцу: старым
// форматом льют до сих пор, и эти файлы лежат в общих папках (Decision 036).

const chip = (on: boolean) =>
  `px-4 py-2 rounded-xl text-sm font-semibold transition ${
    on ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm" : "text-zinc-400 hover:text-violet-300"
  }`;

const field =
  "bg-[#0d0b14] border border-violet-900/40 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-600/50 transition text-white";

const money = (v: number | null) =>
  v === null ? "—" : `$${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: number | null) => (v === null ? "—" : v.toLocaleString("ru-RU"));

// Показываем не всё сразу: за месяц строк бывает много, а карточка тянет превью.
const PAGE = 120;

// Порог, с которого о крео вообще можно судить. В легаси-библиотеке стоит $1000,
// но там метрики за всё время. Здесь период короткий, и по $1000 в «тестах»
// оказалось бы всё подряд. Берём порог зрелости из правил проекта — $200.
const MATURE = 200;

type Tab = "all" | "win" | "lose" | "test" | "fav";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "win", label: "Win" },
  { id: "lose", label: "Lose" },
  { id: "test", label: "Test" },
  { id: "fav", label: "★ Fav" },
];

const SORTS = [
  { id: "none", label: "Сорт: по расходу" },
  { id: "romi", label: "Сорт: ROMI" },
  { id: "deposits", label: "Сорт: депозиты" },
  { id: "costPdp", label: "Сорт: цена ПДП" },
  { id: "costDia", label: "Сорт: цена диалога" },
] as const;
type Sort = (typeof SORTS)[number]["id"];

const romiOf = (r: CreativeRow) => {
  const revenue = (r.depSum ?? 0) + (r.redepSum ?? 0);
  return r.spend > 0 ? ((revenue - r.spend) / r.spend) * 100 : null;
};
// Цена берётся из сумм за период, а не усреднением по дням (Decision 024).
const costPer = (spend: number, count: number | null) =>
  count && count > 0 ? spend / count : null;

export default function CreativeCards({
  data,
  loading,
  media,
  suffixes,
  notes,
  onNotesChange,
}: {
  data: CreativesResult | null;
  loading: boolean;
  media: MediaFile[];
  suffixes: string[];
  notes: Record<string, CreativeNote>;
  onNotesChange: (updater: (prev: Record<string, CreativeNote>) => Record<string, CreativeNote>) => void;
}) {
  // Показ ограничен: за месяц строк много, а карточка тянет превью. Счётчик
  // привязан к периоду — сменились данные, показ снова начинается с начала,
  // и делать это эффектом не нужно.
  const [limitBy, setLimitBy] = useState<{ key: string; value: number }>({ key: "", value: PAGE });
  const periodKey = `${data?.since ?? ""}|${data?.until ?? ""}|${data?.rows.length ?? 0}`;
  const limit = limitBy.key === periodKey ? limitBy.value : PAGE;
  const setLimit = (v: number | ((p: number) => number)) =>
    setLimitBy({ key: periodKey, value: typeof v === "function" ? v(limit) : v });
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<Sort>("none");
  const [medium, setMedium] = useState("all");
  const [approach, setApproach] = useState("all");
  // Крео без расхода за период — обычно шум: объявление есть, но не крутилось.
  // По умолчанию прячем, но выключателем возвращаются.
  const [onlyWithSpend, setOnlyWithSpend] = useState(true);

  const [selected, setSelected] = useState<CreativeRow | null>(null);

  const index = useMemo(() => buildMediaIndex(media, new Set(suffixes)), [media, suffixes]);
  const findMedia = useCallback((code: string) => lookupMedia(index, code), [index]);

  const toggleFavorite = useCallback(async (code: string) => {
    if (!isSupabaseConfigured) return;
    const existing = notes[code];
    const next = !(existing?.favorite ?? false);
    const updated: CreativeNote = existing
      ? { ...existing, favorite: next, updated_at: new Date().toISOString() }
      : { creative_code: code, favorite: next, note: null, transcription_ru: null, ignored: false, updated_at: new Date().toISOString() };
    onNotesChange((p) => ({ ...p, [code]: updated }));
    // Пишем только своё поле: расшифровку сюда класть нельзя, её пишет воркер.
    await supabase.from("creative_user_notes").upsert(
      { user_id: await currentUserId(), creative_code: code, favorite: next, updated_at: updated.updated_at },
      { onConflict: "user_id,creative_code" }
    );
  }, [notes, onNotesChange]);

  const all = useMemo(() => data?.rows ?? [], [data]);

  // Носители и подходы — из самих данных, а не из списка в коде: словарь
  // команды пополняется, и хардкод означал бы деплой ради каждого подхода.
  const mediums = useMemo(
    () => [...new Set(all.map((r) => r.medium).filter(Boolean) as string[])].sort(),
    [all]
  );
  const approaches = useMemo(
    () => [...new Set(all.map((r) => r.approach).filter((a) => a && a !== "unknown"))].sort(),
    [all]
  );

  // Счётчики считаются до вкладки, но после поиска и формата — иначе цифра на
  // вкладке не сходилась бы с тем, что человек увидит, нажав её.
  const beforeTab = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((r) => !onlyWithSpend || r.spend > 0)
      .filter((r) => !q || r.code.toLowerCase().includes(q))
      .filter((r) => medium === "all" || r.medium === medium)
      .filter((r) => approach === "all" || r.approach === approach);
  }, [all, search, medium, approach, onlyWithSpend]);

  const counts = useMemo(() => ({
    all: beforeTab.length,
    win: beforeTab.filter((r) => (romiOf(r) ?? -1) >= 150 && r.spend >= MATURE).length,
    lose: beforeTab.filter((r) => (romiOf(r) ?? 0) < 0 && r.spend >= MATURE).length,
    test: beforeTab.filter((r) => r.spend < MATURE).length,
    fav: beforeTab.filter((r) => notes[r.code]?.favorite).length,
  }), [beforeTab, notes]);

  const rows = useMemo(() => {
    const filtered = beforeTab.filter((r) => {
      if (tab === "all") return true;
      if (tab === "win") return (romiOf(r) ?? -1) >= 150 && r.spend >= MATURE;
      if (tab === "lose") return (romiOf(r) ?? 0) < 0 && r.spend >= MATURE;
      if (tab === "test") return r.spend < MATURE;
      return notes[r.code]?.favorite === true;
    });

    const key = (r: CreativeRow): number | null => {
      if (sort === "romi") return romiOf(r);
      if (sort === "deposits") return r.depCount ?? 0;
      if (sort === "costPdp") return costPer(r.spend, r.subscribers);
      if (sort === "costDia") return costPer(r.spend, r.dialogs);
      return r.spend;
    };
    // Цена — чем меньше, тем лучше; остальное — чем больше. Строки без числа
    // уходят вниз в обоих случаях: «неизвестно» не должно выглядеть как лучшее.
    const asc = sort === "costPdp" || sort === "costDia";
    return [...filtered].sort((a, b) => {
      const x = key(a), y = key(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return asc ? x - y : y - x;
    });
  }, [beforeTab, tab, sort, notes]);

  const shown = rows.slice(0, limit);
  const withoutFile = rows.filter((r) => !findMedia(r.code)).length;
  const dirty = search !== "" || tab !== "all" || sort !== "none" || medium !== "all" || approach !== "all" || !onlyWithSpend;
  const zeroSpend = all.filter((r) => r.spend === 0).length;

  return (
    <div>
      {/* Поиск, вкладки и формат. Формат — по новому неймингу: носитель и подход
          читаются из кода крео, а не из папки в R2 (Decision 026). */}
      {data && !loading && (
        <div className="mb-4 space-y-3">
          <input
            type="text"
            placeholder="Поиск крео…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#0d0b14] border border-violet-900/40 rounded-xl px-4 py-3 outline-none focus:border-violet-600/50 transition placeholder:text-zinc-600 text-white text-sm"
          />

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 flex-wrap">
              {TABS.map((t) => (
                <button key={t.id} onClick={() => { setTab(t.id); setLimit(PAGE); }} className={chip(tab === t.id)}>
                  {t.label} <span className="text-[11px] opacity-60">{counts[t.id]}</span>
                </button>
              ))}
            </div>

            <div className="flex-1" />

            <button onClick={() => { setOnlyWithSpend((v) => !v); setLimit(PAGE); }}
                    title={`Крео без расхода за период: ${zeroSpend}`}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition border ${
                      onlyWithSpend
                        ? "bg-violet-900/40 text-violet-200 border-violet-700/40"
                        : "bg-[#0d0b14] text-zinc-500 border-violet-900/40 hover:text-violet-300"
                    }`}>
              Только с расходом
            </button>

            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={field}>
              {SORTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>

            {mediums.length > 0 && (
              <select value={medium} onChange={(e) => { setMedium(e.target.value); setLimit(PAGE); }} className={field}>
                <option value="all">Носитель: все</option>
                {mediums.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            )}

            {approaches.length > 0 && (
              <select value={approach} onChange={(e) => { setApproach(e.target.value); setLimit(PAGE); }} className={field}>
                <option value="all">Подход: все</option>
                {approaches.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            )}

            {dirty && (
              <button onClick={() => { setSearch(""); setTab("all"); setSort("none"); setMedium("all"); setApproach("all"); setOnlyWithSpend(true); }}
                      className="px-3 py-2 rounded-xl text-sm text-zinc-500 hover:text-violet-300 transition">
                сбросить
              </button>
            )}
          </div>
        </div>
      )}

      {data?.notice && (
        <div className="bg-amber-950/30 border border-amber-700/30 rounded-xl px-4 py-3 text-amber-200/90 text-sm mb-4">
          {data.notice}
        </div>
      )}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-10 h-10 rounded-full border-2 border-violet-600/40 border-t-violet-400 animate-spin" />
        </div>
      )}

      {data && !loading && (
        <>
          {withoutFile > 0 && (
            <p className="text-[11px] text-zinc-600 mb-3">
              У {withoutFile} из {rows.length} крео файла в R2 нет — они крутятся, но в дашборд не загружены.
              Загрузка не влияет на цифры, только на превью.
            </p>
          )}

          {rows.length === 0 ? (
            <p className="text-zinc-500 text-sm py-8">За этот период не крутилось ни одного крео.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {shown.map((r) => {
                  const match = findMedia(r.code);
                  const note = notes[r.code];
                  const revenue = (r.depSum ?? 0) + (r.redepSum ?? 0);
                  const romi = r.spend > 0 ? ((revenue - r.spend) / r.spend) * 100 : null;
                  return (
                    <div key={r.code} onClick={() => setSelected(r)}
                         className="bg-[#111118] border border-violet-900/30 rounded-2xl overflow-hidden cursor-pointer hover:border-violet-500/50 hover:shadow-[0_4px_24px_rgb(109_40_217/0.12)] transition">
                      <MediaWide file={match?.file} />

                      <div className="flex items-center justify-between px-4 pt-4 pb-3 gap-3 border-b border-violet-900/20">
                        <div className="min-w-0 flex-1">
                          <div className="text-base font-bold text-white truncate" title={r.code}>{r.code}</div>
                          <div className="flex items-center gap-1.5 flex-wrap mt-1">
                            {r.approach !== "unknown" && (
                              <span className="text-[10px] font-medium bg-violet-800/35 text-violet-100 border border-violet-700/40 px-1.5 py-0.5 rounded-full">
                                {r.approach}
                              </span>
                            )}
                            {r.countries.map((c) => (
                              <span key={c} className="text-[10px] font-medium bg-zinc-800/60 text-zinc-300 border border-zinc-700/40 px-1.5 py-0.5 rounded-full">{c}</span>
                            ))}
                            {match && !match.exact && (
                              <span title="Точного файла нет — превью подставлено по похожему названию"
                                    className="text-[10px] font-medium bg-amber-800/25 text-amber-300/90 border border-amber-700/40 px-1.5 py-0.5 rounded-full">≈ похоже</span>
                            )}
                            {!match && (
                              <span className="text-[10px] font-medium bg-zinc-800/60 text-zinc-500 border border-zinc-700/40 px-1.5 py-0.5 rounded-full">файл не загружен</span>
                            )}
                            {r.geoMismatch && (
                              <span title="Гео в имени не совпало со странами таргета"
                                    className="text-[10px] font-medium bg-amber-800/25 text-amber-300/90 border border-amber-700/40 px-1.5 py-0.5 rounded-full">≠ гео</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button onClick={(e) => { e.stopPropagation(); toggleFavorite(r.code); }}
                                  disabled={!isSupabaseConfigured}
                                  title={note?.favorite ? "Убрать из избранного" : "В избранное"}
                                  className={`text-base leading-none transition-colors ${
                                    !isSupabaseConfigured ? "text-zinc-700 opacity-30 cursor-not-allowed"
                                      : note?.favorite ? "text-yellow-400" : "text-zinc-700 hover:text-yellow-400"}`}>★</button>
                          <RomiBadge value={romi === null ? "" : String(romi)} />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-x-3 gap-y-2 px-4 pt-3 pb-4 text-[13px]">
                        {([
                          ["Расход", money(r.spend)],
                          ["Доход", revenue > 0 ? money(revenue) : "—"],
                          ["Депозиты", num(r.depCount)],
                          ["ПДП", num(r.subscribers)],
                          ["Цена ПДП", money(costPer(r.spend, r.subscribers))],
                          ["Диалоги", num(r.dialogs)],
                          ["Цена диа", money(costPer(r.spend, r.dialogs))],
                          ["Клики", num(r.clicks)],
                          ["Показы", num(r.impressions)],
                        ] as const).map(([label, value]) => (
                          <div key={label}>
                            <p className="text-[10px] text-zinc-600 uppercase tracking-wider">{label}</p>
                            <p className="text-zinc-200">{value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {rows.length > shown.length && (
                <div className="flex justify-center mt-6">
                  <button onClick={() => setLimit((l) => l + PAGE)}
                          className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-violet-900/40 text-violet-200 hover:bg-violet-900/60 transition">
                    Показать ещё {Math.min(PAGE, rows.length - shown.length)} из {rows.length - shown.length}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {selected && (
        <CreativeModal
          item={toLegacy(selected)}
          mediaFile={findMedia(selected.code)?.file}
          note={notes[selected.code]}
          supabaseAvailable={isSupabaseConfigured}
          onClose={() => setSelected(null)}
          onToggleFavorite={toggleFavorite}
          onNotesUpdated={(u) => onNotesChange((p) => ({ ...p, [u.creative_code]: u }))}
        />
      )}
    </div>
  );
}
