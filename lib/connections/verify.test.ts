// Самопроверка входного фильтра ссылок. Запуск: npx tsx lib/connections/verify.test.ts
// Сюда попадают только случаи, которые отсекаются ДО сети — они и есть защита.
import assert from "node:assert/strict";
import { verifyXlsxUrl } from "./verify";

const rejected = [
  "http://169.254.169.254/latest/meta-data/",  // метаданные облака
  "http://localhost:3000/api/media",           // свой же сервер
  "http://127.0.0.1:9000/",
  "https://evil.example.com/x.xlsx",           // чужой хост
  "http://docs.google.com/x",                  // тот хост, но без https
  "file:///etc/passwd",
  "не ссылка вовсе",
  "",
];

// Обёртка, потому что tsx собирает этот файл в cjs, а там нет top-level await.
async function main() {
  for (const url of rejected) {
    const problem = await verifyXlsxUrl(url);
    assert.ok(problem, `должно быть отклонено до сети: ${url}`);
    // Наружу не уходит ни адрес, ни код ответа — только что делать.
    assert.ok(!problem.includes("169.254"), "адрес не должен попадать в текст ошибки");
  }
  console.log(`verify: ${rejected.length} опасных ссылок отклонены без единого запроса`);
}

main();
