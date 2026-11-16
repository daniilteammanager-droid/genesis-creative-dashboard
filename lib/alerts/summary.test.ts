// Самопроверка утренней сводки. Запуск: npx tsx lib/alerts/summary.test.ts
import assert from "node:assert/strict";
import { morningPlan, summaryRich, summaryText } from "./summary";
import { buyerLines, faceRows, facesRich } from "./faces";

const HEAD = "<b>📊 Отчёт за 24.10</b>\n\n…\nИтого\n1 594,89 / …";
const t = summaryText(HEAD,
  [
    { label: "Илья", spend: 394.89, revenue: null, romi: null },
    { label: "Артём", spend: 1200, revenue: 2000, romi: 66.7 },
    { label: "Андрей", spend: 0, revenue: null, romi: null },
  ],
  [{ label: "Илья", cabinets: 2, rejected: 0 }, { label: "без владельца", cabinets: 0, rejected: 3 }, { label: "Артём", cabinets: 0, rejected: 0 }],
);
const lines = t.split("\n");
assert.ok(t.startsWith(`${HEAD}\n\n<b>По баерам:</b>\n`), "сначала отчёт по лицам с итогом, под ним баеры");
const b = lines.indexOf("<b>По баерам:</b>");
assert.match(lines[b + 1], /^Артём: 1\s200,00\$ \/ доход 2\s000,00\$ \/ ROMI 67%$/, "по расходу, сверху больший");
assert.match(lines[b + 2], /^Илья: 394,89\$ \/ доход — \/ ROMI —$/, "неизвестный доход — прочерк");
assert.ok(!t.includes("Андрей"), "баер без расхода не печатается");
assert.match(t, /<b>За сутки:<\/b>\nИлья — проблемных кабинетов: 2\n/);
assert.match(t, /без владельца — отклонённых объявлений: 3/);
assert.ok(!t.includes("Артём —"), "без проблем — не строка");

const calm = summaryText(HEAD, [], [], "За неделю");
assert.match(calm, /<b>По баерам:<\/b>\nрасхода не было/);
assert.match(calm, /<b>За неделю:<\/b>\nблокировок и отклонений не было/);

// Имена экранируются: сводка уходит HTML
assert.ok(summaryText(HEAD, [{ label: "<b>x", spend: 1, revenue: null, romi: null }], []).includes("&lt;b&gt;x"));

// Утро: по будням — за вчера; в выходные — ничего; в понедельник — пт, сб, вс по отдельности и неделя пн–вс
const plan = (d: string) => morningPlan(d).map((p) => `${p.since}…${p.until} ${p.title} / ${p.period}`);
assert.deepEqual(plan("2026-11-17"), ["2026-11-16…2026-11-16 📊 Отчёт за 16.11, пн / За день"]);
assert.deepEqual(plan("2026-11-21"), [], "суббота");
assert.deepEqual(plan("2026-11-22"), [], "воскресенье");
assert.deepEqual(plan("2026-11-16"), [
  "2026-11-13…2026-11-13 📊 Отчёт за 13.11, пт / За день",
  "2026-11-14…2026-11-14 📊 Отчёт за 14.11, сб / За день",
  "2026-11-15…2026-11-15 📊 Отчёт за 15.11, вс / За день",
  "2026-11-09…2026-11-15 📊 Отчёт за неделю 09.11–15.11 / За неделю",
]);

// Ячейки «Отчётов» → строки отчёта: лицо, площадка и страна складываются; пустое лицо — Роман,
// служебное гео — словом; баеры — из тех же ячеек
const Z = { spend: 0, impr: 0, clicks: 0, subs: 0, dia: 0, deps: 0, rev: 0 };
const cell = (buyer: string, geo: string, face: string, platform: "fb" | "tg", spend: number, rev: number) =>
  ({ buyer, geo, face, funnel: "", platform, creo: "x", sums: { ...Z, spend, rev, subs: 1 } });
const cells = [cell("Артём", "ES", "ROMAN", "fb", 100, 0), cell("Андрей", "ES", "ROMAN", "fb", 50, 300),
  cell("Андрей", "??", "", "fb", 0, 1000), cell("Павел", "ES", "ROMAN", "tg", 30, 0)];
const fr = faceRows(cells);
assert.deepEqual(fr.map((r) => [r.platform, r.face, r.label, r.spend, r.subscribers, r.revenue]),
  [["fb", "ROMAN", "ES", 150, 2, 300], ["fb", "ROMAN", "❔ Без страны", 0, 1, 1000], ["tg", "ROMAN", "ES", 30, 1, 0]], "без лица — Роман");
assert.deepEqual(buyerLines(cells).map((b) => [b.label, b.spend, b.revenue, b.romi === null ? null : Math.round(b.romi)]),
  [["Артём", 100, 0, -100], ["Андрей", 50, 1300, 2500], ["Павел", 30, 0, -100]]);

// Rich: таблица лиц, у лица с двумя площадками — строки площадок, страны свёрнуты по площадкам
const rich = facesRich([...fr, { ...fr[0], label: "Отчёт <x>", spend: 1234.5, subscribers: 100 }], "Отчёт <за>");
assert.ok(rich.startsWith("<h3>Отчёт &lt;за&gt;</h3><table"), "заголовок экранирован");
assert.equal((rich.match(/<td>↳<\/td>/g) ?? []).length, 2, "у Романа FB и TG — по строке площадки");
assert.equal((rich.match(/<details>/g) ?? []).length, 2, "страны — по блоку на площадку");
assert.equal(facesRich([fr[0]], "x").includes("↳"), false, "одна площадка — без своей строки");
assert.match(rich, /<summary>Роман · TG Ads — страны \(1\)<\/summary>/);
// Ничего не переносится: иконка и кружок ROMI — своими ячейками, в ячейках нет обычных пробелов, минус — знаком минуса
assert.ok(rich.includes("<td>👤</td><td><b>Роман</b></td>"), "👤 — своей ячейкой");
assert.ok(rich.includes("<td>🔴</td><td align=\"right\">−100%</td>"), "кружок ROMI — своей ячейкой");
assert.ok(!/<t[dh][^>]*>[^<]* [^<]*<\/t[dh]>/.test(rich), "ни одного обычного пробела в ячейке");
assert.ok(rich.includes("Отчёт &lt;x&gt;"), "подпись в ячейке экранирована");
// Числа с точкой, тысячи — неразрывным пробелом
assert.ok(rich.includes(">1 235<") && rich.includes(">12.35<"), "1 235 и 12.35, без запятых");
assert.ok(!/\d,\d/.test(rich));
assert.match(rich, /<b>Итого<\/b><\/td><td align="right">1 415<\/td>/);
assert.equal(facesRich([], "x"), "<h3>x</h3><p>Расхода не было.</p>");
const sr = summaryRich("<h3>H</h3>", [{ label: "Артём Б", spend: 100, revenue: 300, romi: 200 }],
  [{ label: "Илья", cabinets: 2, rejected: 1 }, { label: "Артём", cabinets: 1, rejected: 0 }]);
assert.match(sr, /<td>Артём Б<\/td><td align="right">100<\/td><td align="right">300<\/td><td>🟢<\/td><td align="right">200%<\/td>/);
assert.match(sr, /<summary>⚠️ Кабинеты 3 · отклонения 1<\/summary>/);
assert.match(sr, /<tr><td>Илья<\/td><td align="right">2<\/td><td align="right">1<\/td><\/tr>/);
assert.match(summaryRich("", [], []), /✅ Без блокировок и отклонений/);

console.log("summary: отчёт по лицам сверху, баеры по расходу, прочерки, проблемы по владельцам, экранирование, утро по будням и понедельник — верно");
