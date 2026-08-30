import { createBrowserClient } from "@supabase/ssr";

// Флаг: переменные среды заданы → Supabase активен.
// Если не заданы — fetch пропускается, дашборд работает без заметок.
export const isSupabaseConfigured = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Браузерный клиент из @supabase/ssr, а не обычный createClient: сессия хранится
// в cookies и потому видна серверу. С localStorage её видел бы только браузер, и
// защитить route handler было бы нечем.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://placeholder.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder"
);

// Структура строки таблицы creative_notes
export type CreativeNote = {
  creative_code: string;
  favorite: boolean;
  note: string | null;
  transcription_ru: string | null;
  updated_at: string;
  // Скрывает битое/неактуальное название крео из списка "Ещё не загружено" в Медиатеке.
  // Требует колонку `ignored boolean default false` в таблице creative_notes.
  ignored?: boolean;
};
