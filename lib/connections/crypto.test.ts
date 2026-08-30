// Самопроверка шифрования ключей. Запуск: npx tsx lib/connections/crypto.test.ts
import assert from "node:assert/strict";

// Импорт статический: секрет читается в момент вызова, а не при загрузке модуля,
// поэтому подменять его между проверками можно свободно.
import { encryptSecret, decryptSecret, secretHint } from "./crypto";

process.env.CONNECTIONS_SECRET = "тестовый-секрет-достаточной-длины";

const token = "EAAG1ZBxyz_живой-токен-с-юникодом-и-symbols/+=";

// Туда и обратно
assert.equal(decryptSecret(encryptSecret(token)), token);

// Каждый раз новый шифротекст: одинаковый выдал бы, что два баера завели один ключ
assert.notEqual(encryptSecret(token), encryptSecret(token));

// Формат: версия и три части
assert.equal(encryptSecret(token).split(".").length, 4);
assert.ok(encryptSecret(token).startsWith("v1."));

// Шифротекст не содержит исходник
assert.ok(!encryptSecret(token).includes("EAAG1ZBxyz"));

// Подмена шифротекста ловится тегом, а не расшифровывается в мусор
const [v, iv, tag, ct] = encryptSecret(token).split(".");
const broken = [v, iv, tag, Buffer.from("подменённое").toString("base64")].join(".");
assert.throws(() => decryptSecret(broken));

// Подмена тега тоже
assert.throws(() => decryptSecret([v, iv, Buffer.alloc(16).toString("base64"), ct].join(".")));

// Чужой ключ шифрования не расшифрует
const good = encryptSecret(token);
process.env.CONNECTIONS_SECRET = "совершенно-другой-секрет-подлиннее";
assert.throws(() => decryptSecret(good));
process.env.CONNECTIONS_SECRET = "тестовый-секрет-достаточной-длины";

// Мусор вместо шифротекста — понятная ошибка, а не падение внутри crypto
assert.throws(() => decryptSecret("просто строка"), /неизвестного формата/);

// Подсказка показывает хвост и не показывает всё остальное
assert.equal(secretHint("abcdefgh"), "…efgh");
assert.equal(secretHint("abc"), "…");
assert.ok(!secretHint(token).includes("EAAG"));

// Без секрета — явная ошибка, а не тихое сохранение открытым текстом
delete process.env.CONNECTIONS_SECRET;
assert.throws(() => encryptSecret(token), /CONNECTIONS_SECRET/);
process.env.CONNECTIONS_SECRET = "короткий";
assert.throws(() => encryptSecret(token), /CONNECTIONS_SECRET/);

console.log("crypto: все проверки прошли");
