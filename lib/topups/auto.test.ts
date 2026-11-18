// Самопроверка автопоиска оплаты. Запуск: npx tsx lib/topups/auto.test.ts
import assert from "node:assert/strict";
import { AFTER_EXPIRY_MS, dueSearches, every, GRACE_MS } from "./auto";
import { same } from "./chain";
import type { Topup } from "./requests";

const M = 60_000, H = 60 * M;
const NOW = Date.parse("2026-11-18T15:21:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
let n = 0;
const row = (p: Partial<Topup>) => ({
  id: `r${++n}`, number: n, status: "pending" as const, network: "TRC20" as const, address: "T1", amount: 96,
  created_at: ago(10 * M), expires_at: null, searching_since: null, ...p,
});
// За `span` минут подряд — сколько раз заявка попала в поиск.
const hits = (r: ReturnType<typeof row>, span: number, rows = [r]) =>
  Array.from({ length: span }, (_, i) => dueSearches(rows, NOW + i * M).some((d) => d.id === r.id)).filter(Boolean).length;

// Точная сумма: чужие 100,52 — не наши 100,5; плавающая точка не мешает.
assert.ok(same(40.0591, 40.0591, "USDT"));
assert.ok(same(40059100 / 1e6, 40.0591, "USDT"));
assert.ok(!same(100.52, 100.5, "USDT"));
assert.ok(!same(96.000001, 96, "USDT"));
assert.ok(same(1.123456789, 1.123456789, "GRAM"));

// Заявка 18.11 (#138): создана 15:11:53, перевод 96 USDT в 15:20:51, «Оплачено» никто не нажал —
// прогон в 15:21 ищет её, точной суммой.
const r138 = row({ created_at: "2026-11-18T15:11:53Z" });
const [d] = dueSearches([r138], NOW);
assert.deepEqual({ ...d, recentMs: 0 }, { id: r138.id, expired: false, strict: true, recentMs: 0 });

// BSC: обычно последние 15 минут, раз в 30 минут — всё окно заявки (перевод, пропущенный сбоем узла, #137).
const windows = Array.from({ length: 30 }, (_, i) => dueSearches([r138], NOW + i * M)[0].recentMs);
assert.equal(windows.filter((w) => w === undefined).length, 1);
assert.equal(windows.filter((w) => w === 15 * M).length, 29);

// Как часто: свежая — каждую минуту, после 6 часов — раз в 5 минут, после 3 дней — раз в 30.
assert.equal(every(5 * H), 1);
assert.equal(every(7 * H), 5);
assert.equal(every(4 * 24 * H), 30);
assert.equal(hits(row({}), 10), 10);
assert.equal(hits(row({ created_at: ago(10 * H) }), 10), 2);
assert.equal(hits(row({ created_at: ago(5 * 24 * H) }), 60), 2);
// Редкие поиски расходятся по минутам, а не идут одним прогоном.
const a = row({ created_at: ago(10 * H) }), b = row({ created_at: ago(10 * H) });
assert.notDeepEqual(dueSearches([a, b], NOW).map((x) => x.id), [a.id, b.id]);

// Нажали «Оплачено» — сутки каждую минуту и с допуском, как раньше; потом — точной суммой и реже.
const pressed = row({ created_at: ago(30 * H), searching_since: ago(2 * H) });
assert.equal(hits(pressed, 5), 5);
assert.equal(dueSearches([pressed], NOW)[0].strict, false);
const old = row({ created_at: ago(30 * H), searching_since: ago(25 * H) });
assert.equal(hits(old, 5), 1);
assert.equal(dueSearches([old], NOW + M * [0, 1, 2, 3, 4].find((i) => dueSearches([old], NOW + i * M).length)!)[0].strict, true);

// Срок вышел: ищем сутки, перевод — не позже 30 минут после срока; первый час каждую минуту, потом раз в 30.
const exp = row({ status: "expired", created_at: ago(70 * M), expires_at: ago(10 * M) });
const [e] = dueSearches([exp], NOW);
assert.deepEqual({ ...e, recentMs: 0 }, { id: exp.id, expired: true, strict: true, until: NOW - 10 * M + GRACE_MS, recentMs: 0 });
assert.equal(hits(row({ status: "expired", created_at: ago(5 * H), expires_at: ago(4 * H) }), 60), 2);
assert.equal(dueSearches([row({ status: "expired", expires_at: new Date(NOW - AFTER_EXPIRY_MS - M).toISOString() })], NOW).length, 0);
// На тот же адрес и сумму завели новую заявку — перевод её, у старой не ищем. Новая отклонена — ищем.
const again = row({ created_at: ago(5 * M) });
assert.deepEqual(dueSearches([exp, again], NOW).map((x) => x.id), [again.id]);
assert.equal(dueSearches([exp, { ...again, status: "rejected" }], NOW)[0].id, exp.id);
assert.equal(dueSearches([exp, { ...again, amount: 97 }], NOW).length, 2);

// Оплаченные и отклонённые не ищем. Две открытые на один адрес и сумму — первой старшая.
assert.equal(dueSearches([row({ status: "paid" }), row({ status: "rejected" })], NOW).length, 0);
const young = row({ created_at: ago(2 * M) }), elder = row({ created_at: ago(20 * M) });
assert.deepEqual(dueSearches([young, elder], NOW).map((x) => x.id), [elder.id, young.id]);

console.log("auto: ok");
