import type { CreativeNote } from "@/lib/supabase";
import { normalize, getFileBaseName } from "./naming";
import { buyerCodeIn, textNoOf, versionCode } from "./code";

// Заметки крео по ключу normalize(code). Воркер пишет creative_code в нижнем регистре, а код крео
// в картотеке — имя объявления как есть («Static 6»): точным ключом расшифровка не находилась.
// Строки одного крео в разном написании сливаются: расшифровка и заметка — свежая непустая,
// «скрыт» и избранное — если стоят хоть в одной. Пишем тоже по noteKey — в строку воркера.

type Shared = { creative_code: string; transcription_ru: string | null; ignored: boolean | null; updated_at: string };
type Mine = { creative_code: string; favorite: boolean; note: string | null; updated_at: string };

export const noteKey = normalize;
export const noteOf = (notes: Record<string, CreativeNote>, code: string): CreativeNote | undefined => notes[normalize(code)];

// Расшифровка к крео (08.11.2026): своя строка → строка показанного файла → видео того же баера с тем
// же номером текста tN. Номер текста свой у каждого баера, поэтому чужой bN — никогда (как
// pickTranscript в lib/ai/prompt.ts). Среди своих — та же версия, тот же подход, по-русски — первыми.
// ponytail: проход по всем заметкам на открытие одного крео; индекс — если понадобится в плитке.
export function transcriptOf(notes: Record<string, CreativeNote>, code: string, fileKey?: string): string | null {
  const direct = noteOf(notes, code)?.transcription_ru || (fileKey ? notes[getFileBaseName(fileKey)]?.transcription_ru : null);
  if (direct) return direct;
  const t = textNoOf(code), b = buyerCodeIn(code);
  if (!t || !b) return null;
  const v = versionCode(code)!, approach = v.slice(0, v.indexOf(`-${t}-`));
  const rank = (c: string, text: string) =>
    (versionCode(c) === v ? 0 : 4) + (c.startsWith(`${approach}-`) ? 0 : 2) + (/[а-яё]/i.test(text) ? 0 : 1);
  let best: { r: number; text: string } | null = null;
  for (const n of Object.values(notes)) {
    const text = n.transcription_ru;
    if (!text || textNoOf(n.creative_code) !== t || buyerCodeIn(n.creative_code) !== b) continue;
    const r = rank(n.creative_code, text);
    if (!best || r < best.r) best = { r, text };
  }
  return best?.text ?? null;
}

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
