// Выгрузки Torro разложены по листам. Лист = период, и периоды бывают двух видов:
//   недельные — "2026-08-24_2026-08-30" (так устроены старые выгрузки);
//   дневные   — "2026-08-31" (так устроены новые, ради склада).
//
// Всё, что не подошло ни под один вид, — не период. В реальных выгрузках рядом
// лежат служебные листы "download" и "All Data": они попали бы в список периодов
// и дали бы пустой отчёт вместо ошибки.

export interface Period {
  key: string;
  since: string;
  until: string;
  // Один день или диапазон. Отличать нужно на чтении: за диапазон нельзя отдать
  // цифры по произвольной дате внутри него, разложить их по дням невозможно.
  granularity: "day" | "range";
}

const RANGE_RE = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/;
const DAY_RE = /^(\d{4}-\d{2}-\d{2})$/;

// Регулярки проверяют форму, но не смысл: под них подходят и «2026-13-01», и
// «2026-02-31». Такой лист попал бы в список периодов и дал бы пустой ответ
// вместо честного «периодов нет». Обратная сборка даты ловит это дёшево.
function isRealDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

export function parsePeriod(key: string): Period | null {
  const range = RANGE_RE.exec(key);
  if (range) {
    if (!isRealDate(range[1]) || !isRealDate(range[2])) return null;
    // Перевёрнутый диапазон — тоже не период, а опечатка в имени листа.
    if (range[2] < range[1]) return null;
    return { key, since: range[1], until: range[2], granularity: "range" };
  }

  const day = DAY_RE.exec(key);
  if (day && isRealDate(day[1])) return { key, since: day[1], until: day[1], granularity: "day" };

  return null;
}

export function toPeriods(sheetTitles: string[]): Period[] {
  return sheetTitles
    .map(parsePeriod)
    .filter((p): p is Period => p !== null)
    .sort((a, b) => b.since.localeCompare(a.since));
}
