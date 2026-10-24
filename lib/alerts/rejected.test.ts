// Самопроверка антиотклона. Запуск: npx tsx lib/alerts/rejected.test.ts
import assert from "node:assert/strict";
import { diffRejected, isRejected, reasonOf, rejectionText, toRejected } from "./rejected";

// DISAPPROVED — всегда; WITH_ISSUES — только с замечаниями ревью
assert.equal(isRejected({ id: "1", effective_status: "DISAPPROVED" }), true);
assert.equal(isRejected({ id: "2", effective_status: "WITH_ISSUES" }), false, "техническая мелочь — не отклонение");
assert.equal(isRejected({ id: "3", effective_status: "WITH_ISSUES", ad_review_feedback: { global: { POLICY: "Нарушение" } } }), true);
assert.equal(isRejected({ id: "4", effective_status: "WITH_ISSUES", ad_review_feedback: { global: { X: "  " } } }), false, "пустое замечание — не считается");

// Причина собирается из ревью и issues_info, дубли схлопываются
const reason = reasonOf({
  id: "5", effective_status: "DISAPPROVED",
  ad_review_feedback: { global: { ADVERTISING_POLICIES: "Финансовые услуги" }, placement_specific: { instagram: { X: "Текст" } } },
  issues_info: [{ error_message: "Финансовые услуги" }, { error_message: "Финансовые услуги" }],
});
assert.match(reason!, /ADVERTISING_POLICIES: Финансовые услуги/);
assert.match(reason!, /placement_specific · instagram · X: Текст/, "вложенность площадки разобрана");
assert.equal(reason!.split("\n").length, 3);
assert.equal(reasonOf({ id: "6", effective_status: "DISAPPROVED" }), null);

// Новое — алерт; одобренное — забыть; непрочитанный кабинет — ничего не забываем
const a = toRejected({ id: "10", effective_status: "DISAPPROVED", name: "vid-x" }, "111");
const b = toRejected({ id: "11", effective_status: "DISAPPROVED" }, "222");
const known = new Set(["10", "20", "30"]);
const knownAccount = new Map([["10", "111"], ["20", "111"], ["30", "333"]]);
const d = diffRejected(known, [a, b], new Set(["111", "222"]), knownAccount);
assert.deepEqual(d.fresh.map((r) => r.adId), ["11"]);
assert.deepEqual(d.gone, ["20"], "кабинет 333 не прочитался — его 30 не трогаем");

// Текст: имена экранированы, нет причины — так и сказано
const text = rejectionText(toRejected({ id: "12", effective_status: "DISAPPROVED", name: "a<b>", campaign: { name: "K&1" } }, "123456"), "Cab");
assert.match(text, /a&lt;b&gt;/);
assert.match(text, /K&amp;1/);
assert.match(text, /CAB3456/);
assert.match(text, /Meta не вернула причину/);

console.log("rejected: отклонения отличаются от мелочей, новые и одобренные считаются верно");
