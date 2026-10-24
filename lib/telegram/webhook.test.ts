// Самопроверка разбора команд бота. Запуск: npx tsx lib/telegram/webhook.test.ts
import assert from "node:assert/strict";
import { parseCommand } from "./webhook";
import { cleanEvents } from "./events";

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

console.log("telegram: команды разбираются, чужие боты и мусор отсекаются");
