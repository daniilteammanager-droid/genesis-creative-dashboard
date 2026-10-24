// Самопроверка утренней сводки. Запуск: npx tsx lib/alerts/summary.test.ts
import assert from "node:assert/strict";
import { summaryText } from "./summary";

const t = summaryText("2026-10-24",
  [
    { label: "Илья", spend: 394.89, revenue: null, romi: null },
    { label: "Артём", spend: 1200, revenue: 2000, romi: 66.7 },
    { label: "Андрей", spend: 0, revenue: null, romi: null },
  ],
  { label: "Итого", spend: 1594.89, revenue: 2000, romi: 25.4 },
  [{ label: "Илья", cabinets: 2, rejected: 0 }, { label: "без владельца", cabinets: 0, rejected: 3 }, { label: "Артём", cabinets: 0, rejected: 0 }],
);
const lines = t.split("\n");
assert.equal(lines[0], "<b>📊 Сводка за 24.10</b>");
assert.match(lines[2], /^Артём: 1\s200,00\$ \/ доход 2\s000,00\$ \/ ROMI 67%$/, "по расходу, сверху больший");
assert.match(lines[3], /^Илья: 394,89\$ \/ доход — \/ ROMI —$/, "неизвестный доход — прочерк");
assert.ok(!t.includes("Андрей"), "баер без расхода не печатается");
assert.match(t, /<b>Итого:<\/b> 1\s594,89\$/);
assert.match(t, /Илья — проблемных кабинетов: 2\n/);
assert.match(t, /без владельца — отклонённых объявлений: 3/);
assert.ok(!t.includes("Артём —"), "без проблем — не строка");

const calm = summaryText("2026-10-24", [], { label: "Итого", spend: 0, revenue: null, romi: null }, []);
assert.match(calm, /Расхода за день не было/);
assert.match(calm, /блокировок и отклонений не было/);

// Имена экранируются: сводка уходит HTML
assert.ok(summaryText("2026-10-24", [{ label: "<b>x", spend: 1, revenue: null, romi: null }], { label: "", spend: 1, revenue: null, romi: null }, []).includes("&lt;b&gt;x"));

console.log("summary: порядок, прочерки, проблемы по владельцам и экранирование — верно");
