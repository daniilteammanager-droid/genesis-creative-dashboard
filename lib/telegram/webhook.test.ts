// Самопроверка разбора команд бота. Запуск: npx tsx lib/telegram/webhook.test.ts
import assert from "node:assert/strict";
import { parseCommand } from "./webhook";
import { cleanEvents } from "./events";
import { splitMessage } from "./api";

const BOT = "GenesisDashBot";

assert.deepEqual(parseCommand("/start abc_DEF-123", BOT), { cmd: "start", arg: "abc_DEF-123" });
// В группе Telegram дописывает имя бота к команде
assert.deepEqual(parseCommand("/start@GenesisDashBot abc", BOT), { cmd: "start", arg: "abc" });
assert.deepEqual(parseCommand("/start@genesisdashbot abc", BOT), { cmd: "start", arg: "abc" }, "регистр имени не важен");
// Команда чужому боту в той же группе — не нам
assert.equal(parseCommand("/start@OtherBot abc", BOT), null);
assert.deepEqual(parseCommand("/stop", BOT), { cmd: "stop", arg: "" });
assert.deepEqual(parseCommand("  /link   code42  ", BOT), { cmd: "link", arg: "code42" });
assert.equal(parseCommand("просто текст", BOT), null);

// Неизвестные ключи уведомлений отбрасываются, дубли схлопываются
assert.deepEqual(cleanEvents(["ad_rejected", "ad_rejected", "hack"]), ["ad_rejected"]);
assert.throws(() => cleanEvents("ad_rejected"));

// Длинный чек режется по блокам и ничего не теряет
const block = (i: number) => `Кампания ${i}\n10 / 2 / 3 / 0 / 0%`;
const long = Array.from({ length: 400 }, (_, i) => block(i)).join("\n\n");
const parts = splitMessage(long);
assert.ok(parts.length > 1);
assert.ok(parts.every((p) => p.length <= 3900));
assert.ok(parts.every((p) => p.startsWith("Кампания")), "резали по границе блока");
assert.equal(parts.join("\n\n"), long);
assert.deepEqual(splitMessage("коротко"), ["коротко"]);

console.log("telegram: команды разбираются, чужие боты и мусор отсекаются, длинное режется по блокам");
