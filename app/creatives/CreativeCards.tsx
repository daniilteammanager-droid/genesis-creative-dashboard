"use client";

import { useCallback, useMemo, useState } from "react";
import CreativeModal from "@/components/CreativeModal";
import CreativeTile from "@/components/CreativeTile";
import { costPer, romiOf, warehouseTile } from "@/lib/creatives/tile";
import { buildMediaIndex, lookupMedia, type MediaFile } from "@/lib/creatives/media";
import { isSupabaseConfigured, supabase, currentUserId, type CreativeNote } from "@/lib/supabase";
import type { CreativesResult, CreativeRow } from "@/lib/warehouse/creatives";
import { toLegacy } from "./toLegacy";
import { seg, Spinner } from "@/components/ui";

// Плитка новой картотеки: то же, что на легаси-странице, но за выбранный период.
//
// Строки задаёт склад — это объявления, которые реально крутились за период.
// Файл к строке ищется по ВСЕМУ бакету R2, без фильтра по владельцу: старым
// форматом льют до сих пор, и эти файлы лежат в общих папках (Decision 036).



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
            className="field w-full"
          />

          <div className="flex flex-wrap items-center gap-2">
            <div className="seg">
              {TABS.map((t) => (
                <button key={t.id} onClick={() => { setTab(t.id); setLimit(PAGE); }} {...seg(tab === t.id)}>
                  {t.label}<span className="ml-1 text-[11px] opacity-60">{counts[t.id]}</span>
                </button>
              ))}
            </div>

            <div className="flex-1" />

            <button onClick={() => { setOnlyWithSpend((v) => !v); setLimit(PAGE); }}
                    title={`Крео без расхода за период: ${zeroSpend}`}
                    aria-pressed={onlyWithSpend}
                    className={`btn ${onlyWithSpend ? "border-violet-600 bg-violet-900/30 text-white" : ""}`}>
              Только с расходом
            </button>

            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="field">
              {SORTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>

            {mediums.length > 0 && (
              <select value={medium} onChange={(e) => { setMedium(e.target.value); setLimit(PAGE); }} className="field">
                <option value="all">Носитель: все</option>
                {mediums.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            )}

            {approaches.length > 0 && (
              <select value={approach} onChange={(e) => { setApproach(e.target.value); setLimit(PAGE); }} className="field">
                <option value="all">Подход: все</option>
                {approaches.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            )}

            {dirty && (
              <button onClick={() => { setSearch(""); setTab("all"); setSort("none"); setMedium("all"); setApproach("all"); setOnlyWithSpend(true); }}
                      className="px-3 py-2 rounded-xl text-sm text-hint hover:text-violet-300 transition">
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
          <Spinner />
        </div>
      )}

      {data && !loading && (
        <>
          {withoutFile > 0 && (
            <p className="text-[11px] text-hint mb-3">
              У {withoutFile} из {rows.length} крео файла в R2 нет — они крутятся, но в дашборд не загружены.
              Загрузка не влияет на цифры, только на превью.
            </p>
          )}

          {rows.length === 0 ? (
            <p className="text-hint text-sm py-8">За этот период не крутилось ни одного крео.</p>
          ) : (
            <>
              {/* Колонок столько же, сколько в легаси-библиотеке: на широком экране — больше колонок, а не шире карточка. */}
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 min-[1700px]:grid-cols-6 min-[2000px]:grid-cols-7 min-[2400px]:grid-cols-8 gap-4">
                {shown.map((r) => {
                  const match = findMedia(r.code);
                  return (
                    <CreativeTile
                      key={r.code}
                      code={r.code}
                      approach={r.approach}
                      countries={r.countries}
                      file={match?.file}
                      exact={match?.exact}
                      geoMismatch={r.geoMismatch}
                      m={warehouseTile(r)}
                      favorite={notes[r.code]?.favorite ?? false}
                      canFavorite={isSupabaseConfigured}
                      onOpen={() => setSelected(r)}
                      onFavorite={() => toggleFavorite(r.code)}
                    />
                  );
                })}
              </div>

              {rows.length > shown.length && (
                <div className="flex justify-center mt-6">
                  <button onClick={() => setLimit((l) => l + PAGE)}
                          className="btn">
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
