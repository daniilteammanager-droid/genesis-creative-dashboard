// Самопроверка доступа к «Легаси крео» (Decision 119) и разделов джуна (060_junior.sql). Запуск: npx tsx lib/nav.test.ts
import assert from "node:assert/strict";
import { canSeeLegacy } from "./auth/types";
import { areasFor, juniorAreas, juniorMay, juniorTool, startPageOf } from "./nav";
import { stepsFor } from "./onboarding/steps";

const closed = { role: "buyer", legacy_access: false } as const;
const open = { role: "buyer", legacy_access: true } as const;
const has = (p: Parameters<typeof areasFor>[0]) => areasFor(p).some((a) => a.href === "/library");
const tours = (p: typeof closed | typeof open | { role: "main"; legacy_access: false }) => stepsFor(p).some((s) => s.route === "/library");

// Баер: решает флаг. Владелец и тимлид — всегда, флаг у них не читается.
assert.equal(canSeeLegacy(closed), false);
assert.equal(canSeeLegacy(open), true);
assert.equal(canSeeLegacy({ role: "main", legacy_access: false }), true);
assert.equal(canSeeLegacy({ role: "teamlead", legacy_access: false }), true);
// Профиль не прочитался — не запираем (как middleware со статусом).
assert.equal(canSeeLegacy(null), true);

// Панель и обучалка закрытому баеру раздел не показывают.
assert.equal(has(closed), false);
assert.equal(has(open), true);
assert.equal(tours(closed), false);
assert.equal(tours(open), true);
assert.equal(tours({ role: "main", legacy_access: false }), true);

// Стартовая «Легаси» у закрытого баера ведёт на Главную, а не в отказ.
assert.equal(startPageOf("/library", areasFor(closed)), "/home");
assert.equal(startPageOf("/library", areasFor(open)), "/library");

// ── Джун ──
const buyerOpen = { role: "buyer", status: "active", legacy_access: true };
const buyerClosed = { ...buyerOpen, legacy_access: false };
const def = juniorAreas(null, buyerOpen);
// По умолчанию закрыты деньги, остальное открыто.
assert.equal(def.includes("/topups"), false);
assert.equal(def.includes("/general-report-4"), false);
assert.equal(def.includes("/live-manager"), true);
assert.equal(def.includes("/library"), true);
// Открыть джуну можно только то, что видит баер: легаси закрыты баеру — у джуна их нет, даже если выбраны.
assert.equal(juniorAreas(["/library", "/tasks"], buyerClosed).join(), "/tasks");
// Баер отключён или больше не баер — только личное.
assert.equal(juniorAreas(null, { ...buyerOpen, status: "disabled" }).join(), "/tasks");
assert.equal(juniorAreas(null, { ...buyerOpen, role: "teamlead" }).join(), "/tasks");
assert.equal(juniorAreas(null, null).join(), "/tasks");
// Выбранное, но не существующее — отбрасывается.
assert.equal(juniorAreas(["/nope", "/check"], buyerOpen).join(), "/check");

// Панель и легаси джуна — по его разделам.
const junior = { role: "junior" as const, legacy_access: false, areas: ["/tasks", "/check"] };
assert.deepEqual(areasFor(junior).map((a) => a.href), ["/tasks", "/check"]);
assert.equal(canSeeLegacy(junior), false);
assert.equal(canSeeLegacy({ ...junior, areas: ["/library"] }), true);
// Стартовая: закрытая → Главная, а без Главной — первый раздел, без разделов — Настройки (не по кругу).
assert.equal(startPageOf("/topups", areasFor(junior)), "/tasks");
assert.equal(startPageOf(null, areasFor({ ...junior, areas: [] })), "/settings");

// Middleware: закрытый раздел — ни страница, ни его API.
assert.equal(juniorMay("/topups", def, false), false);
assert.equal(juniorMay("/api/topups", def, false), false);
assert.equal(juniorMay("/general-report", def, false), false);
assert.equal(juniorMay("/api/general-report-4", def, false), false);
assert.equal(juniorMay("/live-manager", def, false), true);
assert.equal(juniorMay("/reports", ["/tasks"], false), false);
assert.equal(juniorMay("/api/report-live", def, false), true);
// Уникализация открыта, антиотклон закрыт — роут заданий всё равно нужен.
assert.equal(juniorMay("/api/antireject", ["/uniquify"], false), true);
assert.equal(juniorMay("/antireject", ["/uniquify"], false), false);
// Интеграции и админка — никогда, даже если открыто всё.
const all = juniorAreas(["/home", "/tasks", "/library", "/creatives", "/check", "/live-manager", "/traffic-report", "/general-report-4", "/autoupload", "/antireject", "/uniquify", "/topups"], buyerOpen);
for (const p of ["/settings/integrations", "/api/meta-keys", "/api/connections", "/api/telegram/links", "/settings/team", "/api/accounts", "/api/ai/summary"]) assert.equal(juniorMay(p, all, true), false, p);
// AI-доступ — только с выключателем.
assert.equal(juniorMay("/settings/ai", all, false), false);
assert.equal(juniorMay("/api/mcp-tokens", all, true), true);
// Своё и общее — можно.
for (const p of ["/", "/settings", "/api/creatives/detail", "/api/media", "/api/ai/creo"]) assert.equal(juniorMay(p, ["/tasks"], false), true, p);
// /general-report-4 не путается с /general-report.
assert.equal(juniorMay("/general-report-4", ["/general-report-4"], false), true);

// Обучалка джуна — без «Интеграций» и закрытых разделов.
const juniorTour = stepsFor({ role: "junior", legacy_access: false, areas: ["/tasks", "/check"] });
assert.equal(juniorTour.some((s) => s.route === "/settings/integrations" || s.route === "/library"), false);

// Инструменты MCP — по разделам; неизвестный — закрыт.
assert.equal(juniorTool("get_stats", ["/traffic-report"]), true);
assert.equal(juniorTool("get_topups", def), false);
assert.equal(juniorTool("manage_campaigns", ["/tasks"]), false);
assert.equal(juniorTool("new_tool", all), false);

console.log("nav: ok");
