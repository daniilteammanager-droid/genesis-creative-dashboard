// Самопроверка настроек «Пополнений»: npx tsx lib/topups/config.test.ts
import assert from "node:assert/strict";
import { checkCategories, DEFAULT, OTHER, renames, suggestTemplate, targetsOf, walletHints, type Category } from "./config";

const TSR = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";   // настоящий формат TRC20 (адрес контракта USDT)
const clone = (c: Category[]): Category[] => JSON.parse(JSON.stringify(c));

// Список по умолчанию — как был в форме; «Другое» в конце каждой категории само.
assert.equal(DEFAULT.length, 4);
assert.deepEqual(targetsOf(DEFAULT, "Кабинеты"), ["TG Ads кабинеты (TON)", OTHER]);
assert.deepEqual(targetsOf(DEFAULT, "Нет такой"), []);
assert.equal(checkCategories(DEFAULT), null);

// Проверка перед сохранением.
const bad = (f: (c: Category[]) => void) => { const c = clone(DEFAULT); f(c); return checkCategories(c); };
assert.match(bad((c) => { c[1].name = "Расходники"; }) ?? "", /два раза/);
assert.match(bad((c) => { c[0].targets[0].name = " "; }) ?? "", /без названия/);
assert.match(bad((c) => { c[0].targets.push({ id: "x", name: "другое", wallets: [] }); }) ?? "", /Другое/);
assert.match(bad((c) => { c[2].targets[2].wallets = [{ name: "TSR", asset: "USDT", network: "ERC20", address: TSR }]; }) ?? "", /не похож/);
assert.match(bad((c) => { c[2].targets[2].wallets = [{ name: "TSR", asset: "BTC", network: "TRC20", address: TSR }]; }) ?? "", /не переводим/);
assert.match(bad((c) => { c[2].targets[2].only = true; }) ?? "", /кошельков нет/);
assert.equal(bad((c) => { c[2].targets[2].wallets = [{ name: "TSR", asset: "USDT", network: "TRC20", address: TSR }]; c[2].targets[2].only = true; }), null);

// Переименования — по id: категория, потом «куда» уже в новой категории; новые и удалённые — не переименования.
const next = clone(DEFAULT);
next[1].name = "Карты и платёжки";
next[1].targets[0].name = "Brocard (USDT)";
next[2].targets.push({ id: "new", name: "Новый агент", wallets: [] });
next[3].targets = [];
assert.deepEqual(renames(DEFAULT, next), [
  { kind: "Карты", to: { kind: "Карты и платёжки" } },
  { kind: "Карты и платёжки", target: "Brocard", to: { target: "Brocard (USDT)" } },
]);
assert.deepEqual(renames(DEFAULT, clone(DEFAULT)), []);

// Подсказки из истории: TSR 3 из 4 на один адрес — закрепить; «Кабинеты · Другое» 5 из 5 — отдельное «куда»;
// отклонённые не считаются, «куда» с кошельком не подсказывается.
const r = (kind: string, target: string, address: string, status = "paid") => ({ kind, target, address, asset: "USDT" as const, network: "TRC20" as const, status });
const rows = [
  r("Агенты", "TSR", TSR), r("Агенты", "TSR", TSR), r("Агенты", "TSR", TSR), r("Агенты", "TSR", "Tother"),
  ...Array.from({ length: 5 }, () => r("Кабинеты", OTHER, "Tcab")),
  r("Карты", "Brocard", "Tb"), r("Карты", "Brocard", "Tb"), r("Карты", "Brocard", "Tb", "rejected"),
];
const hints = walletHints(rows, DEFAULT);
assert.deepEqual(hints.map((h) => [h.target, h.n, h.of, h.make]), [[OTHER, 5, 5, true], ["TSR", 3, 4, false]]);
const pinned = clone(DEFAULT);
pinned[2].targets[2].wallets = [{ name: "TSR", asset: "USDT", network: "TRC20", address: TSR }];
assert.equal(walletHints(rows, pinned).some((h) => h.target === "TSR"), false);

// Шаблон: три одинаковые за 30 дней — подсказать; шаблон уже есть или заявки старые — нет.
const now = Date.parse("2026-11-27T12:00:00Z");
const own = (amount: number, day: string) => ({ ...r("Агенты", "TSR", TSR), amount, created_at: `${day}T10:00:00Z` });
const mine = [own(1000, "2026-11-20"), own(1000, "2026-11-22"), own(1000, "2026-11-25"), own(500, "2026-11-25")];
assert.deepEqual(suggestTemplate(mine, [], now), { kind: "Агенты", target: "TSR", address: TSR, asset: "USDT", network: "TRC20", amount: 1000, n: 3 });
assert.equal(suggestTemplate(mine, [{ kind: "Агенты", target: "TSR", amount: 1000 }], now), null);
assert.equal(suggestTemplate(mine.map((m) => ({ ...m, created_at: "2026-09-01T10:00:00Z" })), [], now), null);

console.log("topups config: ok");
