// Самопроверка клиента Torro. Запуск: npx tsx lib/torro/mcp.test.ts
//
// Главное здесь — обход потолка в 100 строк: склеенные части обязаны сойтись
// с итогом дня, иначе часть цифр потерялась молча.
import assert from "node:assert/strict";
import { fetchDay, toCrm, type TorroRow } from "./mcp";

type Args = { group_by: string; country?: string[]; campaign_name?: string[] };

// Подставной Torro: 150 объявлений в двух странах, у MX две кампании.
const ads: (TorroRow & { country: string; campaign: string })[] = [];
for (let i = 0; i < 150; i++) {
  const country = i < 120 ? "MX" : "ES";
  ads.push({ group: `ad-${i}`, click: 2, sub: 1, chat: i % 2, country, campaign: country === "MX" ? `c${i % 2}` : "c-es" });
}
// Одно и то же объявление в двух странах — должно сложиться.
ads.push({ group: "ad-0", click: 5, sub: 0, chat: 0, dep_count: 1, dep_summary: 300, country: "ES", campaign: "c-es" });

const calls: Args[] = [];
function fakeTorro(): typeof fetch {
  return (async (_url: string, init: { body: string }) => {
    const args = JSON.parse(init.body).params.arguments as Args;
    calls.push(args);
    const picked = ads.filter((a) =>
      (!args.country || args.country.includes(a.country)) &&
      (!args.campaign_name || args.campaign_name.includes(a.campaign)));
    const key = (a: (typeof ads)[number]) =>
      args.group_by === "country" ? a.country : args.group_by === "campaign_name" ? a.campaign : a.group;
    const grouped = new Map<string, TorroRow>();
    for (const a of picked) {
      const cur = grouped.get(key(a)) ?? { group: key(a) };
      for (const k of ["click", "sub", "chat", "dep_count", "dep_summary"] as const) {
        if (a[k] !== undefined) cur[k] = (Number(cur[k]) || 0) + Number(a[k]);
      }
      grouped.set(key(a), cur);
    }
    const all = [...grouped.values()];
    const summary: Record<string, number> = {};
    for (const r of all) for (const [k, v] of Object.entries(r)) if (typeof v === "number") summary[k] = (summary[k] ?? 0) + v;
    const payload = { rows: all.slice(0, 100), summary, rows_total: all.length, truncated: all.length > 100 };
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify(payload) }] } }));
  }) as unknown as typeof fetch;
}

const base = { token: "t", buyerId: 1, day: "2026-10-22" };

async function main() {
// 150 объявлений не влезают целиком; MX (120) не влезает и в страну — уходит в кампании.
const rows = await fetchDay(base, "ad_name", fakeTorro());
assert.equal(rows.length, 150, "все объявления на месте, дубль склеен");
const ad0 = rows.find((r) => r.group === "ad-0")!;
assert.equal(ad0.click, 7, "клики объявления из двух стран сложились");
assert.equal(ad0.dep_count, 1);
assert.ok(calls.some((c) => c.campaign_name), "дошло до разбиения по кампаниям");

// Кампаний мало — один запрос.
calls.length = 0;
const camps = await fetchDay(base, "campaign_name", fakeTorro());
assert.equal(camps.length, 3);
assert.equal(calls.length, 1);

// Отсутствующее поле — ноль, а не null: Torro молчит о целях, которые не сработали.
const crm = toCrm({ group: "x", click: 3, sub: 2 });
assert.equal(crm.depCount, 0);
assert.equal(crm.subscribers, 2);
assert.equal(crm.dialogs, 0);

// Ошибка инструмента — честная ошибка, а не пустой день.
const broken = (async () => new Response(JSON.stringify({ result: { isError: true, content: [{ type: "text", text: "bad buyer" }] } }))) as unknown as typeof fetch;
await assert.rejects(fetchDay(base, "ad_name", broken), /bad buyer/);

console.log("torro: потолок 100 строк обходится, части сходятся с итогом");
}

main().catch((e) => { console.error(e); process.exit(1); });
