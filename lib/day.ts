// Команда работает по Москве. «Сегодня» должно меняться в московскую полночь, а
// не в UTC: на Vercel сервер живёт в UTC, и с 00:00 до 03:00 МСК он считал бы
// сегодняшний день вчерашним. Для чека это не косметика — от того, какой день
// «сегодня», зависит, идти в живую Мету или в склад.
//
// ponytail: одна зона в константе. Появятся баеры в другом поясе — сюда придёт
// аргумент, а не второй набор функций.
export const TEAM_TZ = "Europe/Moscow";

// en-CA даёт ровно YYYY-MM-DD — тот же формат, в котором даты лежат в базе.
const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TEAM_TZ, year: "numeric", month: "2-digit", day: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TEAM_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
});

/** Сегодняшний московский день: `2026-08-31`. */
export function mskDay(d: Date = new Date()): string {
  return dayFmt.format(d);
}

/** Шапка чека: `31.08 - 13:53`. */
export function mskStamp(d: Date = new Date()): string {
  const [, month, day] = mskDay(d).split("-");
  return `${day}.${month} - ${timeFmt.format(d)}`;
}

/** Сдвиг от московского сегодня на N дней назад. */
export function mskDaysAgo(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - days);
  return mskDay(d);
}
