"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CreativeModal from "@/components/CreativeModal";
import RomiBadge from "@/components/RomiBadge";
import { MediaWide } from "@/components/CreativeMedia";
import { buildMediaIndex, lookupMedia, type MediaFile } from "@/lib/creatives/media";
import { isSupabaseConfigured, supabase, currentUserId, type CreativeNote } from "@/lib/supabase";
import type { CreativesResult, CreativeRow } from "@/lib/warehouse/creatives";
import { mskDaysAgo } from "@/lib/day";
import { toLegacy } from "./toLegacy";

// Плитка новой картотеки: то же, что на легаси-странице, но за выбранный период.
//
// Строки задаёт склад — это объявления, которые реально крутились за период.
// Файл к строке ищется по ВСЕМУ бакету R2, без фильтра по владельцу: старым
// форматом льют до сих пор, и эти файлы лежат в общих папках (Decision 036).

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

const money = (v: number | null) =>
  v === null ? "—" : `$${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: number | null) => (v === null ? "—" : v.toLocaleString("ru-RU"));

// Показываем не всё сразу: за месяц строк бывает много, а карточка тянет превью.
const PAGE = 120;

export default function CreativeCards({
  media,
  suffixes,
  notes,
  onNotesChange,
}: {
  media: MediaFile[];
  suffixes: string[];
  notes: Record<string, CreativeNote>;
  onNotesChange: (updater: (prev: Record<string, CreativeNote>) => Record<string, CreativeNote>) => void;
}) {
  const [since, setSince] = useState(daysAgo(0));
  const [until, setUntil] = useState(daysAgo(0));
  const [buyer, setBuyer] = useState("all");
  const [country, setCountry] = useState("all");
  const [data, setData] = useState<CreativesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const [selected, setSelected] = useState<CreativeRow | null>(null);

  const isBuyer = data?.isBuyer ?? false;

  // ─── Данные склада ─────────────────────────────────────────────────────────
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
        setData(d); setError(null); setLoading(false); setLimit(PAGE);
      })
      .catch((e: Error) => { if (alive) { setData(null); setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [since, until, buyer, country]);

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

  const rows = data?.rows ?? [];
  const shown = rows.slice(0, limit);
  const withoutFile = rows.filter((r) => !findMedia(r.code)).length;

  return (
    <div>
      {/* ─── Фильтры ─── */}
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

      {!isBuyer && data && (
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

      {data?.notice && (
        <div className="bg-amber-950/30 border border-amber-700/30 rounded-xl px-4 py-3 text-amber-200/90 text-sm mb-4">
          {data.notice}
        </div>
      )}
      {error && (
        <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">{error}</div>
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
                          ["Диалоги", num(r.dialogs)],
                          ["Клики", num(r.clicks)],
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
