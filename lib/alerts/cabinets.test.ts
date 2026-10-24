// Самопроверка алертов кабинетов. Запуск: npx tsx lib/alerts/cabinets.test.ts
import assert from "node:assert/strict";
import { diffCabinets, fromMinor, toState, type CabinetState } from "./cabinets";

const cab = (id: string, status: string, extra: Partial<CabinetState> = {}): CabinetState => ({
  accountId: id, name: `Cab ${id}`, status, disableReason: null, currency: "USD", balance: null, prepay: false, ...extra,
});
const map = (...s: CabinetState[]) => new Map(s.map((x) => [x.accountId, x]));

// Первый прогон — запоминаем всё, не шлём ничего: старые блокировки — не новость.
let r = diffCabinets(new Map(), [cab("1", "DISABLED")], true);
assert.equal(r.alerts.length, 0);
assert.equal(r.states.length, 1);

// ACTIVE → DISABLED — алерт с причиной
r = diffCabinets(map(cab("1", "ACTIVE")), [cab("1", "DISABLED", { disableReason: 3 })], true);
assert.equal(r.alerts.length, 1);
assert.match(r.alerts[0].text, /заблокирован/);
assert.match(r.alerts[0].text, /риск по платежам/);
assert.equal(r.alerts[0].payUrl, null);

// Платёжная проблема — с кнопкой оплаты и суммой
r = diffCabinets(map(cab("2", "ACTIVE")), [cab("2", "UNSETTLED", { balance: 125.5 })], true);
assert.ok(r.alerts[0].payUrl?.includes("asset_id=2"));
assert.match(r.alerts[0].text, /К оплате/);

// Выход из проблемы — «снята»; смена между двумя не-проблемами — тишина
r = diffCabinets(map(cab("3", "DISABLED"), cab("4", "ACTIVE")), [cab("3", "ACTIVE"), cab("4", "PENDING_CLOSURE")], true);
assert.equal(r.alerts.length, 1);
assert.match(r.alerts[0].text, /снята/);

// Пропажа — только при полном прогоне
r = diffCabinets(map(cab("5", "ACTIVE")), [], false);
assert.equal(r.alerts.length, 0, "упал ключ — пропажу не объявляем");
assert.equal(r.states.length, 0);
r = diffCabinets(map(cab("5", "ACTIVE")), [], true);
assert.equal(r.alerts.length, 1);
assert.equal(r.states[0].status, "MISSING");
// Вернулся — «снова доступен»
r = diffCabinets(map(cab("5", "MISSING")), [cab("5", "ACTIVE")], true);
assert.match(r.alerts[0].text, /снова доступен/);
// Уже MISSING и всё ещё нет — повторно не шлём
r = diffCabinets(map(cab("5", "MISSING")), [], true);
assert.equal(r.alerts.length, 0);

// Имя экранируется: в HTML-сообщении «<» сломал бы разметку
r = diffCabinets(map(cab("6", "ACTIVE")), [cab("6", "DISABLED", { name: "A<b>" })], true);
assert.match(r.alerts[0].text, /A&lt;b&gt;/);

// Баланс из минимальных единиц: центы у доллара, их нет у иены
assert.equal(fromMinor("12550", "USD"), 125.5);
assert.equal(fromMinor("1000", "JPY"), 1000);
assert.equal(fromMinor(undefined, "USD"), null);

assert.deepEqual(toState({ id: "act_77", account_status: 9, currency: "EUR", balance: "500" }).status, "IN_GRACE_PERIOD");
assert.equal(toState({ id: "act_77", account_status: 9 }).accountId, "77");

console.log("cabinets: смены статусов, пропажи и балансы разбираются верно");
