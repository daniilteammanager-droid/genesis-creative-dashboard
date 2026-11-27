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
//
// ВАЖНО: запрос обязан нести полный порядок — обычно это первичный ключ таблицы.
// Без ORDER BY Postgres не обещает одинаковый порядок между страницами, и если
// кроновый прогон обновит таблицу между запросами, часть строк приедет дважды,
// а часть не приедет вовсе. Расход разойдётся на несколько объявлений, и сверить
// его будет не с чем.
//
// Страницы идут пачками по PARALLEL параллельно (27.11.2026): по одной «всё время» Креативов
// читалось 18 + 20 страниц по ~180 мс подряд. Первая — одна: почти все выборки короче тысячи
// строк. Лишние запросы за концом пачки возвращают пустой ответ, их не больше PARALLEL − 1.
const PAGE = 1000;
const PARALLEL = 8;

export async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const page = async (i: number) => {
    const { data, error } = await build(i * PAGE, i * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    return (data ?? []) as T[];
  };
  const out = await page(0);
  for (let next = 1; out.length === next * PAGE; next += PARALLEL) {
    const batch = await Promise.all(Array.from({ length: PARALLEL }, (_, k) => page(next + k)));
    for (const rows of batch) {
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }
  return out;
}
