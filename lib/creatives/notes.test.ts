// Самопроверка заметок крео. Запуск: npx tsx lib/creatives/notes.test.ts
import assert from "node:assert/strict";
import { noteOf, notesMap } from "./notes";

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

console.log("notes: ok");
