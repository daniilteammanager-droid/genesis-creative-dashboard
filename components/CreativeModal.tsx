"use client";

import { useEffect, useState } from "react";
import { supabase, currentUserId, type CreativeNote } from "@/lib/supabase";
import type { CreativeRow } from "@/lib/creatives/types";
import type { MediaFile } from "@/lib/creatives/media";
import { isVideo, getApproach } from "@/lib/creatives/media";
import { legacyTile } from "@/lib/creatives/tile";
import { noteKey } from "@/lib/creatives/notes";
import CreativeStats from "./CreativeStats";
import CreativeAi from "./CreativeAi";

// Модалка крео — общая для легаси-библиотеки и новой картотеки: видео, расшифровка,
// заметка, избранное и все цифры крео со склада за выбранный период и по неделям
// (CreativeStats). Цифры с карточки — запасные, если на складе крео нет.

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function CreativeModal({
  item,
  mediaFile,
  note,
  supabaseAvailable,
  onClose,
  onToggleFavorite,
  onNotesUpdated,
}: {
  item: CreativeRow;
  mediaFile?: MediaFile;
  note?: CreativeNote;
  supabaseAvailable: boolean;
  onClose: () => void;
  onToggleFavorite: (code: string) => void;
  onNotesUpdated: (updated: CreativeNote) => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Тексты читаются из пропа, а не хранятся в состоянии. Раньше они брались один
  // раз при монтировании — а модал в Reports открывается ДО того, как приедет
  // заметка, и приехавшую он уже не показывал. Хуже: в поле расшифровки в этот
  // момент стоял текст из CSV, и «Сохранить» затирало им расшифровку воркера.
  const noteText = note?.note ?? "";
  const [noteStatus,          setNoteStatus]          = useState<SaveStatus>("idle");
  const [noteEditing,         setNoteEditing]         = useState(false);
  const [noteDraft,           setNoteDraft]           = useState("");
  const transcriptionText = note?.transcription_ru || item.text;
  const [transcriptionStatus, setTranscriptionStatus] = useState<SaveStatus>("idle");
  const [transcriptionEditing,setTranscriptionEditing]= useState(false);
  const [transcriptionDraft,  setTranscriptionDraft]  = useState("");

  async function saveField(
    field: "note" | "transcription_ru",
    value: string,
    setStatus: (s: SaveStatus) => void,
    onSuccess?: () => void
  ) {
    if (!supabaseAvailable) { console.warn("Supabase недоступен — сохранение временно недоступно"); return; }
    setStatus("saving");
    const now = new Date().toISOString();
    // Разворачиваем прежнюю заметку целиком: раньше payload собирался с нуля и
    // терял ignored, а родитель заменяет объект целиком — флаг «скрыт» пропадал
    // из интерфейса до перезагрузки.
    const payload: CreativeNote = {
      ...(note ?? { creative_code: item.creative, favorite: false, note: null, transcription_ru: null, updated_at: now }),
      creative_code:    item.creative,
      note:             field === "note" ? (value.trim() || null) : (note?.note ?? null),
      transcription_ru: field === "transcription_ru" ? (value.trim() || null) : (note?.transcription_ru ?? null),
      updated_at:       now,
    };
    try {
      // Заметка личная, расшифровка общая — разные таблицы. И пишется только то
      // поле, которое правили: строка целиком затирала бы чужую работу, в том
      // числе расшифровку, дописанную воркером минуту назад.
      if (field === "note") {
        const { error } = await supabase.from("creative_user_notes").upsert(
          { user_id: await currentUserId(), creative_code: noteKey(item.creative), note: payload.note, updated_at: now },
          { onConflict: "user_id,creative_code" }
        );
        if (error) throw error;
      } else {
        const { error } = await supabase.from("creative_notes").upsert(
          { creative_code: noteKey(item.creative), transcription_ru: payload.transcription_ru, updated_at: now },
          { onConflict: "creative_code" }
        );
        if (error) throw error;
      }
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

  const approach = getApproach(item.creative, mediaFile?.key);
  const m        = legacyTile(item);

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 overflow-y-auto flex items-start md:items-center justify-center p-4 md:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[1200px] bg-panel border border-line rounded-2xl md:rounded-3xl overflow-hidden my-4 md:my-0 md:h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-line flex-shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold text-white leading-tight truncate">{item.creative}</h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {approach !== "unknown" && (
                <span className="text-xs font-medium text-violet-100 bg-violet-800/35 px-2.5 py-0.5 rounded-full border border-violet-600/40">
                  {approach}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => supabaseAvailable && onToggleFavorite(item.creative)}
              disabled={!supabaseAvailable}
              className={`w-9 h-9 flex items-center justify-center rounded-xl transition text-xl ${
                !supabaseAvailable
                  ? "text-zinc-700 opacity-30 cursor-not-allowed bg-raised"
                  : note?.favorite
                  ? "text-yellow-400 bg-yellow-900/30 hover:bg-yellow-900/50"
                  : "text-hint bg-raised hover:text-yellow-400 hover:bg-violet-900/40"
              }`}
              title={!supabaseAvailable ? "Избранное временно недоступно" : note?.favorite ? "Убрать из избранного" : "В избранное"}
            >
              {note?.favorite ? "★" : "☆"}
            </button>
            <button
              onClick={onClose}
              className="flex-shrink-0 text-zinc-400 hover:text-white bg-raised hover:bg-violet-900/40 rounded-xl w-9 h-9 flex items-center justify-center transition text-lg"
              aria-label="Закрыть"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* Слева: видео, расшифровка и заметка */}
          <div className="md:w-[340px] flex-shrink-0 p-4 space-y-3 border-b md:border-b-0 md:border-r border-line md:overflow-y-auto">
            <div className="bg-background rounded-xl overflow-hidden aspect-[9/16] max-h-[60vh] md:max-h-none flex items-center justify-center">
            {mediaFile ? (
              isVideo(mediaFile.url) ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={mediaFile.url} controls autoPlay loop poster={mediaFile.posterUrl} className="w-full h-full object-contain" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
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

            {/* Расшифровка */}
            <div className="bg-panel border border-line rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-violet-400/50 text-xs uppercase tracking-widest">Расшифровка</div>
                {!transcriptionEditing && supabaseAvailable && (
                  <button
                    onClick={() => { setTranscriptionDraft(transcriptionText); setTranscriptionEditing(true); }}
                    className="text-xs text-violet-400/60 hover:text-violet-300 transition"
                  >
                    Редактировать
                  </button>
                )}
                {!supabaseAvailable && (
                  <span className="text-xs text-hint italic">Сохранение временно недоступно</span>
                )}
              </div>
              {transcriptionEditing ? (
                <>
                  <textarea
                    value={transcriptionDraft}
                    onChange={(e) => setTranscriptionDraft(e.target.value)}
                    rows={6} autoFocus placeholder="Расшифровка пока не добавлена"
                    className="field w-full resize-none mb-3"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => saveField("transcription_ru", transcriptionDraft, setTranscriptionStatus, () => setTranscriptionEditing(false))}
                      disabled={!supabaseAvailable || transcriptionStatus === "saving"}
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
                    : <p className="text-hint text-sm italic">Расшифровка пока не добавлена</p>
                  }
                  {transcriptionStatus === "saved" && <p className="text-green-400 text-xs mt-2">✓ Сохранено</p>}
                </>
              )}
            </div>

            {/* Заметки */}
            <div className="bg-panel border border-line rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-violet-400/50 text-xs uppercase tracking-widest">Заметки</div>
                {!noteEditing && supabaseAvailable && (
                  <button
                    onClick={() => { setNoteDraft(noteText); setNoteEditing(true); }}
                    className="text-xs text-violet-400/60 hover:text-violet-300 transition"
                  >
                    Редактировать
                  </button>
                )}
                {!supabaseAvailable && (
                  <span className="text-xs text-hint italic">Сохранение временно недоступно</span>
                )}
              </div>
              {noteEditing ? (
                <>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={4} autoFocus placeholder="Добавьте заметку..."
                    className="field w-full resize-none mb-3"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => saveField("note", noteDraft, setNoteStatus, () => setNoteEditing(false))}
                      disabled={!supabaseAvailable || noteStatus === "saving"}
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
                    : <p className="text-hint text-sm italic">Заметка пока не добавлена</p>
                  }
                  {noteStatus === "saved" && <p className="text-green-400 text-xs mt-2">✓ Сохранено</p>}
                </>
              )}
            </div>
          </div>

          {/* Справа: все цифры крео за период и по неделям */}
          <div className="flex-1 min-w-0 p-5 md:overflow-y-auto">
            <CreativeAi key={item.creative} code={item.creative} />
            <CreativeStats code={item.creative} fallback={m} fallbackLabel="Цифры с карточки" />
          </div>
        </div>
      </div>
    </div>
  );
}
