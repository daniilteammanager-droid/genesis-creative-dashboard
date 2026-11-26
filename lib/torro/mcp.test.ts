// Самопроверка клиента Torro. Запуск: npx tsx lib/torro/mcp.test.ts
//
// Главное здесь — обход потолка в 100 строк: склеенные части обязаны сойтись
// с итогом дня, иначе часть цифр потерялась молча.
import assert from "node:assert/strict";
import { fetchDay, onlyClicks, rateLimited, timedOut, toCrm, type TorroRow } from "./mcp";

type Args = { group_by: string; country?: string[]; campaign_name?: string[]; ad_name?: string[] };

// Подставной Torro: 150 объявлений в двух странах, у MX две кампании.
const ads: (TorroRow & { country: string; campaign: string })[] = [];
for (let i = 0; i < 150; i++) {
  const country = i < 120 ? "MX" : "ES";
  ads.push({ group: `ad-${i}`, click: 2, sub: 1, chat: i % 2, country, campaign: country === "MX" ? `c${i % 2}` : "c-es" });
}
// Одно и то же объявление в двух странах — должно сложиться.
ads.push({ group: "ad-0", click: 5, sub: 0, chat: 0, dep_count: 1, dep_summary: 300, country: "ES", campaign: "c-es" });

const calls: Args[] = [];
function fakeTorro(data = ads): typeof fetch {
  return (async (_url: string, init: { body: string }) => {
    const args = JSON.parse(init.body).params.arguments as Args;
    calls.push(args);
    const picked = data.filter((a) =>
      (!args.country || args.country.includes(a.country)) &&
      (!args.campaign_name || args.campaign_name.includes(a.campaign)) &&
      (!args.ad_name || args.ad_name.includes(a.group)));
    const key = (a: (typeof data)[number]) =>
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

// Итог дня (первый запрос) разошёлся с частями на delta.
function skewed(field: string, delta: number): typeof fetch {
  const real = fakeTorro() as unknown as (u: string, i: { body: string }) => Promise<Response>;
  let first = true;
  return (async (url: string, init: { body: string }) => {
    const res = await real(url, init);
    if (!first) return res;
    first = false;
    const p = JSON.parse((await res.json()).result.content[0].text);
    p.summary[field] = (p.summary[field] ?? 0) + delta;
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify(p) }] } }));
  }) as unknown as typeof fetch;
}

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

// Новый трафик между запросами — не ошибка; потерянные строки и лишние депы — ошибка.
assert.equal((await fetchDay(base, "ad_name", skewed("click", -2))).length, 150, "части обогнали итог на 2 клика");
await assert.rejects(fetchDay(base, "ad_name", skewed("click", -50)), /не сошлись/);
await assert.rejects(fetchDay(base, "ad_name", skewed("click", 1)), /не сошлись/);
await assert.rejects(fetchDay(base, "ad_name", skewed("dep_count", -1)), /не сошлись/);

// «Отчёт уже считается» — повторяем, как лимит. Текст — настоящий ответ Torro.
assert.ok(rateLimited(new Error('Torro: {"error": "Этот отчёт статистики уже считается", "code": "busy", "retry_after": 2}')));
assert.ok(!rateLimited(new Error("Torro не принял ключ")));

// Тайм-аут Torro — не лимит: связки пропускают объявление, а не ждут. Текст — настоящий ответ.
const timeout = new Error('Torro: {"error": "Инструмент не ответил за 25 с, ничего не изменено.", "code": "timeout"}');
assert.ok(timedOut(timeout) && !rateLimited(timeout));
assert.ok(!timedOut(new Error("Torro недоступен: The operation was aborted due to timeout")));

// Боты Meta из США (Артём, 24.11.2026): 224 кампании и 224 объявления в US, одни клики;
// в ES — настоящие подписки. Раньше день падал «в стране US больше 100 кампаний» целиком.
const bots: (TorroRow & { country: string; campaign: string })[] = [];
for (let i = 0; i < 224; i++) bots.push({ group: `bot-ad-${i}`, click: 11, sub: 0, unsub: 0, chat: 0, cr: 0, country: "US", campaign: `us-c${i}` });
bots.push({ group: "vid-edit-t45-v2-b1-es-es", click: 72, sub: 16, chat: 4, country: "ES", campaign: "CAB6316_23.11_TG_EXP_ESP_MTG_ROMAN_2" });
bots.push({ group: "vid-edit-t45-v2-b1-es-es", click: 16, country: "US", campaign: "CAB6316_23.11_TG_EXP_ESP_MTG_ROMAN_2" });
bots.push({ group: "vid-balance-t11-v60-b1-es-es", click: 10, sub: 1, chat: 1, dep_count: 1, dep_summary: 500, country: "CL", campaign: "c-cl" });
for (const groupBy of ["ad_name", "campaign_name"] as const) {
  calls.length = 0;
  const day = await fetchDay(base, groupBy, fakeTorro(bots));
  const sum = (k: string) => day.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  assert.equal(sum("sub"), 17, `${groupBy}: все подписки на месте`);
  assert.equal(sum("dep_count"), 1, `${groupBy}: деп на месте`);
  assert.equal(sum("click"), 224 * 11 + 72 + 16 + 10, `${groupBy}: клики сходятся с итогом`);
  assert.equal(day.filter((r) => r.group === "").length, 1, `${groupBy}: США — одна строка без имени`);
  assert.ok(!calls.some((c) => c.country?.includes("US") && c.group_by !== groupBy), `${groupBy}: США дальше не делим`);
}
const es = (await fetchDay(base, "ad_name", fakeTorro(bots))).find((r) => r.group === "vid-edit-t45-v2-b1-es-es")!;
assert.equal(es.sub, 16);
assert.equal(es.chat, 4);

// 21.11.2026: в US 224 кампании, но 59 объявлений и настоящая подписка — кампании страны
// раскладываются пачками объявлений, подписка не теряется. Пустое имя объявления — тоже пачка.
const mixed: (TorroRow & { country: string; campaign: string })[] = [];
for (let i = 0; i < 224; i++) mixed.push({ group: i === 5 ? "" : `us-ad-${i % 59}`, click: 10, country: "US", campaign: `us-c${i}` });
mixed.push({ group: "us-ad-3", click: 1, sub: 1, chat: 1, country: "US", campaign: "us-c3" });
mixed.push({ group: "es-ad", click: 5, sub: 2, country: "ES", campaign: "es-c" });
for (const groupBy of ["ad_name", "campaign_name"] as const) {
  calls.length = 0;
  const day = await fetchDay(base, groupBy, fakeTorro(mixed));
  assert.equal(day.reduce((s, r) => s + (Number(r.sub) || 0), 0), 3, `${groupBy}: подписка из US на месте`);
  assert.equal(day.reduce((s, r) => s + (Number(r.click) || 0), 0), 224 * 10 + 1 + 5, `${groupBy}: клики сходятся`);
  if (groupBy === "campaign_name") {
    assert.equal(day.length, 225, "все 224 кампании US и кампания ES");
    assert.equal(day.find((r) => r.group === "us-c3")!.sub, 1);
    assert.ok(calls.every((c) => !c.ad_name || c.ad_name.length < 59), "пачками объявлений, а не все сразу");
  }
}

// Хоть одна подписка в переполненной стране — не сворачиваем, а честная ошибка.
const realInUs = [...bots, { group: "bot-ad-7", click: 0, sub: 1, country: "US", campaign: "us-c7" }];
await assert.rejects(fetchDay(base, "campaign_name", fakeTorro(realInUs)), /в стране US больше 100 кампаний/);
await assert.rejects(fetchDay(base, "ad_name", fakeTorro(realInUs)), /в стране US больше 100 кампаний/);

// Настоящие строки Torro за 24.11: US — одни клики; AW — ноль кликов, но сегмент; ES — подписки.
assert.ok(onlyClicks({ group: "US", click: 2555, sub: 0, unsub: 0, sub_clean: 0, cr: 0, cr_clean: 0, chat: 0, lead_reply: 0, percent_lead_reply: 0, reg: 0, command: 0 }));
assert.ok(!onlyClicks({ group: "AW", click: 0, sub: 0, unsub: 0, chat: 0, reg: 0, command: 0, seg_e_count: 1 }));
assert.ok(!onlyClicks({ group: "PL", click: 0, sub: 0, unsub: 1, sub_clean: -1 }));
assert.ok(!onlyClicks({ group: "ES", click: 129, sub: 18, chat: 7 }));

console.log("torro: потолок 100 строк обходится, части сходятся с итогом, страна из одних кликов сворачивается");
}

main().catch((e) => { console.error(e); process.exit(1); });
