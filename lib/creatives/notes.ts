import type { CreativeNote } from "@/lib/supabase";
import { normalize } from "./naming";

// Заметки крео по ключу normalize(code). Воркер пишет creative_code в нижнем регистре, а код крео
// в картотеке — имя объявления как есть («Static 6»): точным ключом расшифровка не находилась.
// Строки одного крео в разном написании сливаются: расшифровка и заметка — свежая непустая,
// «скрыт» и избранное — если стоят хоть в одной. Пишем тоже по noteKey — в строку воркера.

type Shared = { creative_code: string; transcription_ru: string | null; ignored: boolean | null; updated_at: string };
type Mine = { creative_code: string; favorite: boolean; note: string | null; updated_at: string };

export const noteKey = normalize;
export const noteOf = (notes: Record<string, CreativeNote>, code: string): CreativeNote | undefined => notes[normalize(code)];

const byTime = <T extends { updated_at: string }>(rows: T[]) => [...rows].sort((a, b) => a.updated_at.localeCompare(b.updated_at));

export function notesMap(shared: Shared[], mine: Mine[]): Record<string, CreativeNote> {
  const map: Record<string, CreativeNote> = {};
  for (const r of byTime(shared)) {
    const k = normalize(r.creative_code);
    const p = map[k];
    map[k] = {
      creative_code: k, favorite: false, note: null,
      transcription_ru: r.transcription_ru || p?.transcription_ru || null,
      ignored: Boolean(p?.ignored || r.ignored),
      updated_at: r.updated_at,
    };
  }
  for (const r of byTime(mine)) {
    const k = normalize(r.creative_code);
    const p = map[k] ?? { creative_code: k, favorite: false, note: null, transcription_ru: null, ignored: false, updated_at: r.updated_at };
    map[k] = { ...p, favorite: p.favorite || r.favorite, note: r.note || p.note };
  }
  return map;
}
