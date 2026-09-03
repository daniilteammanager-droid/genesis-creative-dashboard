"use client";

import { useCallback, useEffect, useState } from "react";
import CreativeCards from "./CreativeCards";
import CreativeAnalytics from "./CreativeAnalytics";
import CreativesTable from "./CreativesTable";
import CreativeUploadModal from "@/app/CreativeUploadModal";
import MediaLibrary from "@/components/MediaLibrary";
import { toLegacy } from "./toLegacy";
import type { MediaFile } from "@/lib/creatives/media";
import { isSupabaseConfigured, supabase, selectAllRows, type CreativeNote } from "@/lib/supabase";
import type { CreativesResult } from "@/lib/warehouse/creatives";
import { mskDay, mskDaysAgo } from "@/lib/day";

// Оболочка раздела: виды, загрузка крео и Медиатека.
//
// Загрузка и Медиатека жили только на легаси-странице, и чтобы залить крео
// приходилось уходить туда. Работают же теперь здесь — значит и кнопки здесь.
// Компоненты те же самые, второй копии не появилось.
//
// Медиа, суффиксы и заметки живут на этом уровне: ими пользуются и плитка, и
// Медиатека. Иначе оба тянули бы /api/media по своему разу.

// Оформление кнопок один в один с легаси-разделом: там они выглядят лучше и
// человек не должен переучиваться, переходя между разделами.
const btn =
  "px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 " +
  "text-white shadow-sm hover:from-violet-500 hover:to-violet-400 transition flex items-center gap-1.5";

const daysAgo = (d: number) => mskDaysAgo(d);

const PERIODS = [
  { label: "Сегодня", since: () => daysAgo(0), until: () => daysAgo(0) },
  { label: "Вчера", since: () => daysAgo(1), until: () => daysAgo(1) },
  { label: "7 дней", since: () => daysAgo(6), until: () => daysAgo(0) },
  { label: "14 дней", since: () => daysAgo(13), until: () => daysAgo(0) },
  { label: "30 дней", since: () => daysAgo(29), until: () => daysAgo(0) },
];

const chip = (on: boolean) =>
  `px-4 py-2 rounded-xl text-sm font-semibold transition ${
    on ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm" : "text-zinc-400 hover:text-violet-300"
  }`;

const field =
  "bg-[#0d0b14] border border-violet-900/40 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-600/50 transition text-white";

export default function CreativesView() {
  const [view, setView] = useState<"cards" | "table" | "analytics">("cards");

  // Период, баер и страна общие для плитки и аналитики: переключая вид, человек
  // смотрит на те же данные под другим углом, а не выбирает период заново.
  const [since, setSince] = useState(daysAgo(0));
  const [until, setUntil] = useState(daysAgo(0));
  const [buyer, setBuyer] = useState("all");
  const [country, setCountry] = useState("all");
  const [data, setData] = useState<CreativesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaFile[]>([]);
  const [suffixes, setSuffixes] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, CreativeNote>>({});
  const [showUpload, setShowUpload] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  // Строки для Медиатеки — за 30 дней, а не за выбранный период: список
  // «ещё не загружено» полезен широким, иначе он схлопнется до одного дня.
  const [libraryRows, setLibraryRows] = useState<CreativesResult["rows"]>([]);

  // fresh=true обходит кэш /api/media: после загрузки список обязан показать
  // новый файл сразу, а не через десять минут.
  const loadMedia = useCallback(async (fresh = false) => {
    try {
      const url = fresh ? `/api/media?_=${Date.now()}` : "/api/media";
      const res = await fetch(url, fresh ? { cache: "no-store" } : undefined);
      const d = await res.json();
      setMedia(Array.isArray(d) ? d : []);
    } catch { setMedia([]); }
  }, []);

  const loadSuffixes = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data } = await supabase.from("creative_match_suffixes").select("suffix");
    setSuffixes((data ?? []).map((r) => r.suffix as string));
  }, []);

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ since, until });
    if (buyer !== "all") q.set("buyer", buyer);
    if (country !== "all") q.set("country", country);
    fetch(`/api/creatives?${q}`)
      .then((r) => r.json() as Promise<CreativesResult & { error?: string }>)
      .then((d) => {
        if (!alive) return;
        if (d.error) throw new Error(d.error);
        setData(d); setError(null); setLoading(false);
      })
      .catch((e: Error) => { if (alive) { setData(null); setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [since, until, buyer, country]);

  // Первая загрузка: состояние ставится в колбэке запроса, а не в теле эффекта.
  // loadMedia/loadSuffixes остаются для обработчиков — после заливки и правки
  // суффиксов список надо перечитать принудительно.
  useEffect(() => {
    fetch("/api/media")
      .then((r) => r.json())
      .then((d) => setMedia(Array.isArray(d) ? d : []))
      .catch(() => setMedia([]));

    if (!isSupabaseConfigured) return;
    supabase.from("creative_match_suffixes").select("suffix")
      .then(({ data }) => setSuffixes((data ?? []).map((r) => r.suffix as string)));
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    (async () => {
      try {
        const [shared, mine] = await Promise.all([
          selectAllRows<{ creative_code: string; transcription_ru: string | null; ignored: boolean | null; updated_at: string }>(
            "creative_notes", "creative_code, transcription_ru, ignored, updated_at"),
          selectAllRows<{ creative_code: string; favorite: boolean; note: string | null; updated_at: string }>(
            "creative_user_notes", "creative_code, favorite, note, updated_at"),
        ]);
        const map: Record<string, CreativeNote> = {};
        for (const r of shared) {
          map[r.creative_code] = {
            creative_code: r.creative_code, favorite: false, note: null,
            transcription_ru: r.transcription_ru, ignored: r.ignored ?? false, updated_at: r.updated_at,
          };
        }
        for (const r of mine) {
          const base = map[r.creative_code];
          map[r.creative_code] = base
            ? { ...base, favorite: r.favorite, note: r.note }
            : { creative_code: r.creative_code, favorite: r.favorite, note: r.note,
                transcription_ru: null, ignored: false, updated_at: r.updated_at };
        }
        setNotes(map);
      } catch { /* заметки некритичны (Decision 005) */ }
    })();
  }, []);

  // Список крео для Медиатеки берём только когда её открывают: лишний запрос
  // на каждое открытие раздела ни к чему.
  async function openLibrary() {
    setShowLibrary(true);
    try {
      const q = new URLSearchParams({ since: mskDaysAgo(29), until: mskDay() });
      const res = await fetch(`/api/creatives?${q}`);
      const d = (await res.json()) as CreativesResult & { error?: string };
      if (!d.error) setLibraryRows(d.rows ?? []);
    } catch { /* Медиатека переживёт пустой список */ }
  }

  const toggleIgnored = useCallback(async (code: string) => {
    if (!isSupabaseConfigured) return;
    const existing = notes[code];
    const next = !(existing?.ignored ?? false);
    const updated: CreativeNote = existing
      ? { ...existing, ignored: next, updated_at: new Date().toISOString() }
      : { creative_code: code, favorite: false, note: null, transcription_ru: null, ignored: next, updated_at: new Date().toISOString() };
    setNotes((p) => ({ ...p, [code]: updated }));
    // Только своё поле: расшифровку пишет воркер, и отправлять её обратно нельзя.
    await supabase.from("creative_notes").upsert(
      { creative_code: code, ignored: next, updated_at: updated.updated_at },
      { onConflict: "creative_code" }
    );
  }, [notes]);

  const tab = (on: boolean) =>
    `px-4 py-2 rounded-xl text-sm font-semibold transition ${
      on ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm" : "text-zinc-400 hover:text-violet-300"
    }`;

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 w-fit">
          <button onClick={() => setView("cards")} className={tab(view === "cards")}>Плитка</button>
          <button onClick={() => setView("table")} className={tab(view === "table")}>Таблица</button>
          <button onClick={() => setView("analytics")} className={tab(view === "analytics")}>Аналитика</button>
        </div>
        <div className="flex gap-2">
          <button onClick={openLibrary} className={btn}>📁 Медиатека</button>
          <button onClick={() => setShowUpload(true)} className={btn}>⬆ Загрузить</button>
        </div>
      </div>

      {view !== "table" && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span className="text-xs text-zinc-600 uppercase tracking-wider">Период</span>
            <input type="date" value={since} max={until} onChange={(e) => setSince(e.target.value)} className={field} />
            <span className="text-zinc-600">—</span>
            <input type="date" value={until} min={since} onChange={(e) => setUntil(e.target.value)} className={field} />
            <div className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 flex-wrap">
              {PERIODS.map((p) => (
                <button key={p.label} onClick={() => { setSince(p.since()); setUntil(p.until()); }}
                        className={chip(since === p.since() && until === p.until())}>{p.label}</button>
              ))}
            </div>
          </div>

          {!data?.isBuyer && data && (
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <span className="text-xs text-zinc-600 uppercase tracking-wider w-16">Баеры</span>
              {data.buyers.length > 0 ? (
                <div className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 flex-wrap">
                  <button onClick={() => setBuyer("all")} className={chip(buyer === "all")}>Сводная</button>
                  {data.buyers.map((b) => (
                    <button key={b.id} onClick={() => setBuyer(b.id)} className={chip(buyer === b.id)}>{b.label}</button>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-zinc-500">Никто из баеров ещё не подключил ключи</span>
              )}
            </div>
          )}

          {(data?.countries.length ?? 0) > 0 && (
            <div className="flex items-center gap-3 mb-5 flex-wrap">
              <span className="text-xs text-zinc-600 uppercase tracking-wider w-16">Страны</span>
              <div className="flex gap-1 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 flex-wrap">
                <button onClick={() => setCountry("all")} className={chip(country === "all")}>Все</button>
                {data!.countries.map((c) => (
                  <button key={c} onClick={() => setCountry(c)} className={chip(country === c)}>{c}</button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">{error}</div>
          )}
        </>
      )}

      {view === "cards" && (
        <CreativeCards data={data} loading={loading} media={media} suffixes={suffixes}
                       notes={notes} onNotesChange={setNotes} />
      )}
      {view === "analytics" && <CreativeAnalytics data={data} loading={loading} />}
      {view === "table" && <CreativesTable />}

      {showUpload && (
        <CreativeUploadModal onClose={() => setShowUpload(false)} onUploaded={() => loadMedia(true)} />
      )}

      {showLibrary && (
        <MediaLibrary
          rows={libraryRows.map(toLegacy)}
          media={media}
          notes={notes}
          matchSuffixes={suffixes}
          supabaseAvailable={isSupabaseConfigured}
          onRefresh={() => loadMedia(true)}
          onSuffixesChanged={loadSuffixes}
          onToggleIgnored={toggleIgnored}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </>
  );
}
