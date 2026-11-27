// Самопроверка комментария заявки: npx tsx lib/topups/comment.test.ts
import assert from "node:assert/strict";
import { blocksOf, continueList, linksOf } from "./comment";

// Строки остаются строками, пункты подряд — один список, нумерация — с первого номера.
assert.deepEqual(blocksOf("Расчёт дизайнера за ноябрь\n- баннеры 10 шт\n- видео 3 шт\n\nИтого 450\n1. первый\n2. второй"), [
  { kind: "p", text: "Расчёт дизайнера за ноябрь" },
  { kind: "ul", items: ["баннеры 10 шт", "видео 3 шт"] },
  { kind: "p", text: "Итого 450" },
  { kind: "ol", items: ["первый", "второй"], start: 1 },
]);
assert.deepEqual(blocksOf("-"), [{ kind: "p", text: "-" }], "одиночный «-» — «нечего добавить», не список");
assert.deepEqual(blocksOf("• один\r\n• два"), [{ kind: "ul", items: ["один", "два"] }]);

// Ссылки — с точкой и скобкой в конце не путаются.
assert.deepEqual(linksOf("макеты: https://figma.com/file/abc?x=1. Готово"), [
  { text: "макеты: " }, { text: "https://figma.com/file/abc?x=1", href: "https://figma.com/file/abc?x=1" }, { text: ". Готово" },
]);
assert.deepEqual(linksOf("(https://t.me/genesis)"), [{ text: "(" }, { text: "https://t.me/genesis", href: "https://t.me/genesis" }, { text: ")" }]);
assert.deepEqual(linksOf("без ссылок"), [{ text: "без ссылок" }]);

// Enter продолжает список; пустой пункт — конец списка; обычная строка — обычный Enter.
assert.deepEqual(continueList("- баннеры", 9), { value: "- баннеры\n- ", caret: 12 });
assert.deepEqual(continueList("Итог\n2. видео", 13), { value: "Итог\n2. видео\n3. ", caret: 17 });
assert.deepEqual(continueList("- баннеры\n- ", 12), { value: "- баннеры\n", caret: 10 });
assert.equal(continueList("просто текст", 12), null);
assert.equal(continueList("-", 1), null, "«-» — не список");

console.log("topups comment: ok");
