import { supabase, isSupabaseConfigured, selectAllRows, currentUserId, type CreativeNote } from "@/lib/supabase";
import { notesMap, noteKey } from "./notes";

// Заметки крео из браузера: общие (расшифровка, «скрыт») и личные (заметка, избранное) одной картой.
// Отдельно от notes.ts — тот чистый и проверяется без Supabase. Заметки некритичны (Decision 005):
// Supabase не ответил — пустая карта.
export async function loadNotes(): Promise<Record<string, CreativeNote>> {
  if (!isSupabaseConfigured) return {};
  try {
    const [shared, mine] = await Promise.all([
      selectAllRows<{ creative_code: string; transcription_ru: string | null; ignored: boolean | null; updated_at: string }>(
        "creative_notes", "creative_code, transcription_ru, ignored, updated_at"),
      selectAllRows<{ creative_code: string; favorite: boolean; note: string | null; updated_at: string }>(
        "creative_user_notes", "creative_code, favorite, note, updated_at"),
    ]);
    return notesMap(shared, mine);
  } catch { return {}; }
}

// Избранное — только своё поле: расшифровку пишет воркер, отправлять её обратно нельзя.
export async function saveFavorite(code: string, favorite: boolean, at: string): Promise<void> {
  await supabase.from("creative_user_notes").upsert(
    { user_id: await currentUserId(), creative_code: noteKey(code), favorite, updated_at: at },
    { onConflict: "user_id,creative_code" }
  );
}
