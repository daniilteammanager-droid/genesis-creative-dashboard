// Самопроверка заметок крео. Запуск: npx tsx lib/creatives/notes.test.ts
import assert from "node:assert/strict";
import { noteOf, notesMap, transcriptOf } from "./notes";

const m = notesMap(
  [
    { creative_code: "static 6", transcription_ru: "НИКОГДА не открывайте позиции", ignored: false, updated_at: "2026-10-24T14:00:00Z" },
    { creative_code: "Static 6", transcription_ru: null, ignored: true, updated_at: "2026-10-25T10:00:00Z" },
    { creative_code: "videom11clst-es.mp4", transcription_ru: "старый", ignored: false, updated_at: "2026-08-01T00:00:00Z" },
    { creative_code: "videom11clst-es", transcription_ru: "новый", ignored: null, updated_at: "2026-09-01T00:00:00Z" },
  ],
  [
    { creative_code: "STATIC 6", favorite: true, note: "моя", updated_at: "2026-10-20T00:00:00Z" },
    { creative_code: "static 6", favorite: false, note: null, updated_at: "2026-10-26T00:00:00Z" },
    { creative_code: "balance/4c-es", favorite: true, note: null, updated_at: "2026-08-01T00:00:00Z" },
  ],
);

const s6 = noteOf(m, "Static 6")!;
assert.equal(s6.transcription_ru, "НИКОГДА не открывайте позиции");   // свежая пустая не затирает текст воркера
assert.equal(s6.ignored, true);                                       // «скрыт» хоть в одной
assert.equal(s6.favorite, true);
assert.equal(s6.note, "моя");
assert.equal(noteOf(m, "static 6"), s6);
assert.equal(noteOf(m, "VideoM11clst-ES")!.transcription_ru, "новый"); // свежая непустая; расширение — тот же крео
assert.equal(noteOf(m, "balance/4c-es")!.favorite, true);             // «/» → «:» как у файлов
assert.equal(noteOf(m, "нет такого"), undefined);
assert.equal(Object.keys(m).length, 3);

// Расшифровка по номеру текста tN — только своего баера (08.11.2026).
const t = notesMap(
  [
    { creative_code: "vid-balance-t30-v1-b3-es-es", transcription_ru: "Hoy gané", ignored: false, updated_at: "2026-11-01T00:00:00Z" },
    { creative_code: "vid-balance-t30-v2-b3-es-es", transcription_ru: "Сегодня я заработал", ignored: false, updated_at: "2026-11-01T00:00:00Z" },
    { creative_code: "vid-edit-t30-v9-b3-es-es", transcription_ru: "Другой подход", ignored: false, updated_at: "2026-11-01T00:00:00Z" },
    { creative_code: "vid-storytell-t30-v1-b1-es-es", transcription_ru: "Текст Артёма", ignored: false, updated_at: "2026-11-01T00:00:00Z" },
    { creative_code: "vid-balance-t31-v9", transcription_ru: "Файл без баера", ignored: false, updated_at: "2026-11-01T00:00:00Z" },
  ],
  [],
);
assert.equal(transcriptOf(t, "vid-balance-t30-v1-b3-es-mx"), "Hoy gané");             // та же версия — первой
assert.equal(transcriptOf(t, "vid-balance-t30-v7-b3-es-ar"), "Сегодня я заработал");  // тот же подход, по-русски
assert.equal(transcriptOf(t, "vid-checklist-t30-v1-b3-es-ar"), "Сегодня я заработал"); // другой подход — tN общий
assert.equal(transcriptOf(t, "vid-balance-t30-v1-b2-es-ar"), null);                    // чужой bN — никогда
assert.equal(transcriptOf(t, "vid-storytell-t30-v4-b1-es-mx"), "Текст Артёма");
assert.equal(transcriptOf(t, "vid-balance-t31-v9-b3-es-ar"), null);                    // ничей файл — только через файл
assert.equal(transcriptOf(t, "vid-balance-t31-v9-b3-es-ar", "b3/vid-balance-t31-v9.mp4"), "Файл без баера");
assert.equal(transcriptOf(t, "edit18-es"), null);

console.log("notes: ok");
