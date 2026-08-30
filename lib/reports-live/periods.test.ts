// Самопроверка разбора листов выгрузки. Запуск: npx tsx lib/reports-live/periods.test.ts
import assert from "node:assert/strict";
import { parsePeriod, toPeriods } from "./periods";

// Недельный лист
const w = parsePeriod("2026-08-24_2026-08-30");
assert.deepEqual(w, { key: "2026-08-24_2026-08-30", since: "2026-08-24", until: "2026-08-30", granularity: "range" });

// Дневной лист
const d = parsePeriod("2026-08-31");
assert.deepEqual(d, { key: "2026-08-31", since: "2026-08-31", until: "2026-08-31", granularity: "day" });

// Служебные листы реальных выгрузок — не периоды. Попав в список, они дали бы
// пустой отчёт вместо честной ошибки «периодов нет».
for (const junk of [
  "download", "All Data", "Лист1", "", "2026-08",
  "2026-13-01_2026-13-05",   // месяца 13 не бывает
  "2026-02-31",              // и такого дня тоже
  "2026-08-30_2026-08-24",   // диапазон наизнанку
]) {
  assert.equal(parsePeriod(junk), null, `«${junk}» не период`);
}

// Смешанный список: служебное отбрасывается, остальное сортируется свежим вперёд
const mixed = toPeriods(["download", "All Data", "2026-08-08", "2026-08-31", "2026-08-24_2026-08-30"]);
assert.deepEqual(mixed.map((p) => p.key), ["2026-08-31", "2026-08-24_2026-08-30", "2026-08-08"]);
assert.equal(mixed.length, 3, "служебные листы не попадают в периоды");

console.log(`periods: разобрано ${mixed.length} листа, служебные отброшены`);
