"use client";

import { useEffect, useState } from "react";
import { supabase, type CreativeNote } from "@/lib/supabase";
import type { CreativeRow } from "@/lib/creatives/types";
import type { MediaFile } from "@/lib/creatives/media";
import { isVideo, getApproach } from "@/lib/creatives/media";
import { parseNumber } from "@/lib/creatives/format";
import RomiBadge from "./RomiBadge";

// The Creative Library's detail modal — all-time Spend/Revenue/ROMI from the main CSV,
// real media, notes, favorite, transcription. Shared verbatim between the Creatives page
// and Reports (Ads mode): "see this creative's all-time results" opens exactly this.

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
    if (!supabaseAvailable) { console.warn("Supabase недоступен — сохранение временно недоступно"); return; }
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
                onClick={() => supabaseAvailable && onToggleFavorite(item.creative)}
                disabled={!supabaseAvailable}
                className={`w-9 h-9 flex items-center justify-center rounded-xl transition text-xl ${
                  !supabaseAvailable
                    ? "text-zinc-700 opacity-30 cursor-not-allowed bg-[#1a1826]"
                    : note?.favorite
                    ? "text-yellow-400 bg-yellow-900/30 hover:bg-yellow-900/50"
                    : "text-zinc-600 bg-[#1a1826] hover:text-yellow-400 hover:bg-[#221e35]"
                }`}
                title={!supabaseAvailable ? "Избранное временно недоступно" : note?.favorite ? "Убрать из избранного" : "В избранное"}
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
              <div className="text-violet-400/50 text-xs uppercase tracking-widest mb-3">Метрики (всё время)</div>
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
                {!transcriptionEditing && supabaseAvailable && (
                  <button
                    onClick={() => { setTranscriptionDraft(transcriptionText); setTranscriptionEditing(true); }}
                    className="text-xs text-violet-400/60 hover:text-violet-300 transition"
                  >
                    Редактировать
                  </button>
                )}
                {!supabaseAvailable && (
                  <span className="text-xs text-zinc-600 italic">Сохранение временно недоступно</span>
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
                {!noteEditing && supabaseAvailable && (
                  <button
                    onClick={() => { setNoteDraft(noteText); setNoteEditing(true); }}
                    className="text-xs text-violet-400/60 hover:text-violet-300 transition"
                  >
                    Редактировать
                  </button>
                )}
                {!supabaseAvailable && (
                  <span className="text-xs text-zinc-600 italic">Сохранение временно недоступно</span>
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
