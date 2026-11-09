"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import CreativeModal from "./CreativeModal";
import { buildMediaIndex, lookupMedia, type MediaFile } from "@/lib/creatives/media";
import { noteKey, noteOf, transcriptOf } from "@/lib/creatives/notes";
import { loadNotes, saveFavorite } from "@/lib/creatives/notesDb";
import { isSupabaseConfigured, supabase, type CreativeNote } from "@/lib/supabase";

// Модалка крео откуда угодно (08.11.2026): имя крео в Отчётах, Live Manager, Checks… — <CreoLink>, и
// открывается та же модалка, что в Креативах: видео, расшифровка, заметка, AI-разбор и цифры со склада
// за любой период (их она грузит сама по имени). Файлы, суффиксы и заметки — при первом открытии,
// а не на каждой странице. Доступ тот же: /api/media отдаёт баеру только его файлы, цифры — его склад.

const OpenCreo = createContext<(name: string) => void>(() => {});
export const useOpenCreo = () => useContext(OpenCreo);

const EMPTY = { spend: "", revenue: "", deposits: "", pdp: "", dia: "", romi: "", text: "" };

export function CreoModalProvider({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaFile[] | null>(null);
  const [suffixes, setSuffixes] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, CreativeNote>>({});
  const started = useRef(false);

  const open = useCallback((n: string) => {
    setName(n);
    if (started.current) return;
    started.current = true;
    fetch("/api/media").then((r) => r.json()).then((d) => setMedia(Array.isArray(d) ? d : [])).catch(() => setMedia([]));
    loadNotes().then(setNotes);
    if (isSupabaseConfigured) {
      supabase.from("creative_match_suffixes").select("suffix")
        .then(({ data }) => setSuffixes((data ?? []).map((r) => r.suffix as string)));
    }
  }, []);

  const index = useMemo(() => (media ? buildMediaIndex(media, new Set(suffixes)) : null), [media, suffixes]);
  const match = name && index ? lookupMedia(index, name) : undefined;

  const toggleFavorite = useCallback((code: string) => {
    const key = noteKey(code), at = new Date().toISOString();
    const prev = notes[key];
    const next = !(prev?.favorite ?? false);
    setNotes((p) => ({ ...p, [key]: { ...(prev ?? { creative_code: key, note: null, transcription_ru: null, ignored: false }), favorite: next, updated_at: at } }));
    saveFavorite(code, next, at);
  }, [notes]);

  return (
    <OpenCreo.Provider value={open}>
      {children}
      {name && (
        <CreativeModal
          item={{ creative: name, ...EMPTY }}
          mediaFile={match?.file}
          mediaLoading={media === null}
          otherVersion={match?.otherVersion}
          note={noteOf(notes, name)}
          transcript={transcriptOf(notes, name, match?.file.key)}
          supabaseAvailable={isSupabaseConfigured}
          onClose={() => setName(null)}
          onToggleFavorite={toggleFavorite}
          onNotesUpdated={(u) => setNotes((p) => ({ ...p, [noteKey(u.creative_code)]: u }))}
        />
      )}
    </OpenCreo.Provider>
  );
}

// Имя крео, по клику — его модалка. Клик не уходит в строку: строки таблиц раскрываются по клику.
export function CreoLink({ name, className = "" }: { name: string; className?: string }) {
  const open = useOpenCreo();
  return (
    <button type="button" title="Открыть крео: видео, расшифровка и цифры за любой период"
            onClick={(e) => { e.stopPropagation(); open(name); }}
            className={`text-left hover:text-violet-300 hover:underline underline-offset-2 decoration-violet-400/60 ${className}`}>
      {name}
    </button>
  );
}
