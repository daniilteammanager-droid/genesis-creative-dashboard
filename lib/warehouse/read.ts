import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Общий доступ к складу для серверного кода. Склад закрыт от браузера грантами
// (009_warehouse.sql), поэтому читает его только сервер сервисным ключом, а кому
// что положено — решают роуты.

export function warehouse(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Не заданы NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

// У ответа Supabase есть потолок в тысячу строк, и обычный select его не обходит:
// лишние строки просто не приезжают, без ошибки и предупреждения. На складе это
// особенно опасно — недостача выглядит как «столько и открутили».
export async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}
