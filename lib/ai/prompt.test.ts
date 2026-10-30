// Самопроверка разбора. Запуск: npx tsx lib/ai/prompt.test.ts
import assert from "node:assert/strict";
import { chunks, creoPrompt, dataHash, parseVerdict, toTelegramHtml, type CreoFacts } from "./prompt";
import { lastWeek, summaryPrompt } from "./summary";

assert.equal(parseVerdict("**Вердикт: масштабировать в Испании** — 3 депа"), "scale");
assert.equal(parseVerdict("\nВердикт: выключить — $1157 без депов"), "off");
assert.equal(parseVerdict("Вердикт: доработать"), "rework");
assert.equal(parseVerdict("Крео хорошее, держать"), null);           // первая строка без «Вердикт» — не угадываем

assert.equal(toTelegramHtml("## Итог\n**CTR** 0,8% < 1,5%"), "Итог\n<b>CTR</b> 0,8% &lt; 1,5%");

const s = (spend: number, deps: number) => ({ spend, impr: 10000, clicks: 100, subs: 20, dia: 5, deps, rev: deps * 800 });
const f: CreoFacts = {
  buyer: "Andrew", creo: "vid-balance-t47-v2-b3-es-es", face: "ROMAN", funnel: "TG", transcript: "Вчера я поймал сделку…",
  geos: [{ geo: "ES", name: "Испания", stage: "deps", sums: s(319, 3) }], total: s(338, 3),
  team: [{ region: "Испания", sums: s(20000, 60) }],
};
const p = creoPrompt(f);
assert.ok(p.includes("Испания (есть депы): спенд $319"));
assert.ok(p.includes("Вчера я поймал сделку"));
assert.ok(creoPrompt({ ...f, transcript: null }).includes("транскрипта нет"));

assert.equal(dataHash(f), dataHash({ ...f, team: [] }));             // средние команды не меняют разбор крео
assert.notEqual(dataHash(f), dataHash({ ...f, geos: [{ ...f.geos[0], sums: s(400, 3) }] }));

const long = Array.from({ length: 100 }, (_, i) => `абзац ${i} ${"x".repeat(80)}`).join("\n");
const parts = chunks(long);
assert.ok(parts.length > 1 && parts.every((x) => x.length <= 3800));
assert.equal(parts.join("\n"), long);
// Недельная сводка — за прошлую неделю пн–вс по Москве, в какой бы день её ни собрали.
assert.deepEqual(lastWeek("2026-11-02"), { since: "2026-10-26", until: "2026-11-01" });
assert.deepEqual(lastWeek("2026-10-31"), { since: "2026-10-19", until: "2026-10-25" });
const cell = (buyer: string, creo: string, deps: number) => ({ buyer, geo: "ES", face: "ROMAN", funnel: "TG", platform: "fb" as const, creo, sums: s(300, deps) });
const sp = summaryPrompt([cell("Andrew", "vid-balance-t47-v2-b3-es-es", 2), cell("Матвей", "vid-checklist-t16-v1-b2-es-es", 0)], [],
  new Map([["vid-balance-t47-v2", "Вчера я поймал сделку"]]), { since: "2026-10-19", until: "2026-10-25" });
assert.ok(sp.includes("## Баер Andrew") && sp.includes("## Баер Матвей") && sp.includes("Начало текста: «Вчера я поймал сделку»"));
console.log("ai prompt: ok");
