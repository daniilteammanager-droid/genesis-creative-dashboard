// Календарь: сетка месяца и подписи периода. Даты — строки ГГГГ-ММ-ДД, считаем
// в UTC: календарный день, а не момент времени, — иначе пояс браузера сдвигал бы клетки.

export const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);

// 6 недель с понедельника: клетки соседних месяцев — бледные, но кликабельные.
export function monthGrid(year: number, month: number): { iso: string; day: number; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month, 1));
  const shift = (first.getUTCDay() + 6) % 7;   // пн = 0
  const start = new Date(Date.UTC(year, month, 1 - shift));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getTime() + i * 86400000);
    return { iso: iso(d), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month };
  });
}

export const shiftMonth = (y: number, m: number, n: number) => { const d = new Date(Date.UTC(y, m + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; };
export const ymOf = (s: string) => ({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) - 1 });

// «28 окт 2026», «22–28 окт 2026», «22 окт — 3 ноя 2026», «28 дек 2026 — 3 янв 2027».
export function rangeLabel(since: string, until: string): string {
  const a = parse(since), b = parse(until);
  const d = (x: Date) => x.getUTCDate(), mo = (x: Date) => SHORT[x.getUTCMonth()], y = (x: Date) => x.getUTCFullYear();
  if (since === until) return `${d(a)} ${mo(a)} ${y(a)}`;
  if (y(a) !== y(b)) return `${d(a)} ${mo(a)} ${y(a)} — ${d(b)} ${mo(b)} ${y(b)}`;
  if (a.getUTCMonth() !== b.getUTCMonth()) return `${d(a)} ${mo(a)} — ${d(b)} ${mo(b)} ${y(b)}`;
  return `${d(a)}–${d(b)} ${mo(b)} ${y(b)}`;
}
export const dayLabel = (s: string) => rangeLabel(s, s);
