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

// Что интерфейс знает о креативе. Собирается из двух таблиц: расшифровка и
// «скрыт» — общие, про сам файл; заметка и избранное — личные, у каждого свои
// (supabase/007_user_notes.sql).
export type CreativeNote = {
  creative_code: string;
  favorite: boolean;
  note: string | null;
  transcription_ru: string | null;
  updated_at: string;
  // Скрывает битое/неактуальное название крео из списка "Ещё не загружено" в Медиатеке.
  ignored?: boolean;
};

// Id текущего пользователя, спрошенный один раз за жизнь вкладки.
//
// Личные заметки и избранное пишутся с user_id, а getUser() — это поход по сети.
// Без запоминания каждый клик по звёздочке стоил бы лишний круг до Supabase.
// Выход из аккаунта делает полную перезагрузку страницы, так что устареть
// запомненному негде.
let cachedUserId: string | null = null;

export async function currentUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Сессия потеряна — войди заново");
  cachedUserId = user.id;
  return cachedUserId;
}

// Читает всю таблицу, а не первую тысячу строк.
//
// У Supabase есть потолок на размер ответа (по умолчанию 1000 строк), и обычный
// select его не обходит: лишние строки просто не приезжают. Ни ошибки, ни
// предупреждения — список молча становится короче. На момент написания в
// creative_notes 626 строк, то есть до потолка оставалось меньше четырёхсот.
export async function selectAllRows<T>(table: string, columns: string): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}
