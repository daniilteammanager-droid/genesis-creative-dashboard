import type { Profile } from "@/lib/auth/types";
import { CATEGORIES, createTopup, listTopups, what, type Topup } from "@/lib/topups/requests";
import { filterTopups, stage, STAGES, type Stage } from "@/lib/topups/view";
import { exact, PAIRS, type Asset } from "@/lib/topups/chain";
import { mskDay, mskTime } from "@/lib/day";
import { findPerson, team } from "./tasks";
import { ToolError, type ToolDef } from "./protocol";

// Пополнения через AI (Decision 121): те же заявки и права, что на странице «Пополнения» (/api/topups):
// владелец видит все, остальные — свои. Список, фильтры и поиск — view.ts, как на странице; здесь — период и сводка.
// Новая заявка — тот же createTopup, что у формы: те же проверки, уходит Top-Up ботом в платёжный чат владельцев.
// Сверх формы — guard: повтор вызова после обрыва не задваивает заявку, зациклившаяся модель не заваливает чат.

interface Ctx { me: Profile; tokenId?: string }
type Tool = ToolDef<Ctx>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<Stage, string>;
export const GROUPS = ["total", "status", "kind", "target", "coin", "author", "day", "month"] as const;
export type Group = (typeof GROUPS)[number];
// ponytail: на странице — последние 500; здесь 2000 ради сводок за долгий период (на 13.11 всего 109). Упрёмся — период в запрос к базе.
const MAX_ROWS = 2000;

// ── Чистая часть (самопроверка — topups.test.ts) ─────────────────────────────

export interface Query { since: string | null; until: string | null; userId: string | null; stages: Stage[]; kinds: string[]; targets: string[]; assets: string[]; q: string }

// Значения фильтра — без учёта регистра: «карты» находит «Карты».
const canon = (want: string[], present: string[]) => want.map((v) => present.find((p) => p.toLowerCase() === v.toLowerCase()) ?? v);

// Период — по дню создания заявки по Москве; остальное — тот же filterTopups, что у страницы.
export function pickTopups(rows: Topup[], f: Query): Topup[] {
  const day = (r: Topup) => mskDay(new Date(r.created_at));
  const assets = f.assets.map((a) => a.toUpperCase());
  const scoped = rows.filter((r) => (!f.userId || r.user_id === f.userId) && (!assets.length || assets.includes(r.asset))
    && (!f.since || day(r) >= f.since) && (!f.until || day(r) <= f.until));
  return filterTopups(scoped, {
    q: f.q, stages: f.stages, authors: [],
    kinds: canon(f.kinds, rows.map((r) => r.kind)), targets: canon(f.targets, rows.map((r) => r.target)),
  });
}

export function keyOf(r: Topup, g: Group): string {
  switch (g) {
    case "total": return "Итого";
    case "status": return LABEL[stage(r)];
    case "kind": return r.kind;
    case "target": return what(r);
    case "coin": return `${r.asset} · ${r.network}`;
    case "author": return r.author ?? "—";
    case "day": return mskDay(new Date(r.created_at));
    case "month": return mskDay(new Date(r.created_at)).slice(0, 7);
  }
}

// Суммы — по монетам: USDT и BTC в одну цифру не складываются. amount — все заявки выборки, paid — оплаченные.
export interface Sum { name: string; count: number; paid_count: number; amount: Partial<Record<Asset, number>>; paid: Partial<Record<Asset, number>> }

export function summarize(rows: Topup[], g: Group): Sum[] {
  const by = new Map<string, Sum>();
  for (const r of rows) {
    const k = keyOf(r, g);
    const s = by.get(k) ?? by.set(k, { name: k, count: 0, paid_count: 0, amount: {}, paid: {} }).get(k)!;
    s.count++;
    s.amount[r.asset] = (s.amount[r.asset] ?? 0) + r.amount;
    if (r.status === "paid") { s.paid_count++; s.paid[r.asset] = (s.paid[r.asset] ?? 0) + r.amount; }
  }
  const round = (m: Sum["amount"]) => { for (const a of Object.keys(m) as Asset[]) m[a] = Number(exact(m[a]!, a)); };
  const out = [...by.values()];
  for (const s of out) { round(s.amount); round(s.paid); }
  // Дни и месяцы — по порядку, остальное — где больше заявок.
  return out.sort(g === "day" || g === "month" ? (x, y) => x.name.localeCompare(y.name) : (x, y) => y.count - x.count || x.name.localeCompare(y.name));
}

// Повтор — та же сумма на тот же адрес, заявка ещё ждёт оплаты и уже в чате, создана за последние полчаса.
// Без сообщений в чате — не дошла (сбой Telegram), её повтор разрешаем, как на странице.
export const DUP_MS = 30 * 60_000, PER_HOUR = 10;
export function guard(mine: Topup[], want: { address: string; amount: number }, now = Date.now()): string | null {
  const age = (r: Topup) => now - Date.parse(r.created_at);
  const dup = mine.find((r) => r.status === "pending" && r.messages.length > 0 && age(r) < DUP_MS
    && r.address === want.address && r.amount === want.amount);
  if (dup) return `Такая заявка уже есть: #${dup.number} — ${exact(dup.amount, dup.asset)} ${dup.asset} на этот адрес, ждёт оплаты. Вторую такую же — только на странице «Пополнения».`;
  const hour = mine.filter((r) => age(r) < 3600_000).length;
  if (hour >= PER_HOUR) return `За последний час у тебя уже ${hour} заявок — через AI больше нельзя, создай на странице «Пополнения».`;
  return null;
}

// Значение без учёта регистра: «brocard» → «Brocard».
const oneOf = (v: string, list: string[]) => list.find((x) => x.toLowerCase() === v.toLowerCase()) ?? v;

const at = (iso: string | null) => (iso ? `${mskDay(new Date(iso))} ${mskTime(new Date(iso))}` : undefined);

export function rowOf(r: Topup) {
  return {
    number: r.number, created: at(r.created_at), author: r.author, kind: r.kind, target: r.target,
    amount: r.amount, asset: r.asset, network: r.network, fee: r.fee || undefined, status: LABEL[stage(r)],
    address: r.address, comment: r.comment ?? undefined, expires: r.status === "pending" ? at(r.expires_at) : undefined,
    taken_by: r.taken_by ?? undefined, closed_by: r.closed_by ?? undefined, paid_at: at(r.paid_at),
    paid_amount: r.paid_amount ?? undefined, tx_url: r.tx_url,
  };
}

// ── Инструмент ───────────────────────────────────────────────────────────────

const getTopups: Tool = {
  name: "get_topups",
  title: "Пополнения",
  description: "Заявки на пополнение кабинетов, карт, агентов и расходников — как раздел «Пополнения»: номер, кто создал, категория и куда, сумма, монета и сеть, комиссия, статус, кто взял и кто оплатил, ссылка на перевод. Плюс сводка: количество и суммы по монетам (все заявки и оплаченные) с разбивкой по статусу, категории, «куда», монете и сети, автору, дням или месяцам. Владелец видит все заявки, остальные — только свои. Создать заявку — create_topup.",
  inputSchema: {
    type: "object",
    properties: {
      since: { type: "string", description: "Первый день создания заявки, YYYY-MM-DD (по Москве). Пусто — с самой первой." },
      until: { type: "string", description: "Последний день включительно, YYYY-MM-DD. Пусто — по сегодня." },
      status: { type: "array", items: { type: "string", enum: STAGES.map((s) => s.key) }, description: "Статусы: pending — ждёт оплаты, work — в работе, search — отмечено оплаченным, ищем перевод, paid — оплачено, rejected — отклонено, expired — время вышло. Пусто — все." },
      author: { type: "string", description: "Только для владельца: заявки одного человека — имя, код баера (b2) или почта." },
      kind: { type: "array", items: { type: "string" }, description: "Категории: Расходники, Карты, Агенты, Кабинеты." },
      target: { type: "array", items: { type: "string" }, description: "Куда именно: Brocard, Прокси, T2A, Другое…" },
      asset: { type: "array", items: { type: "string", enum: ["USDT", "USDC", "BTC", "GRAM", "TRX"] }, description: "Монеты." },
      search: { type: "string", description: "Поиск, как на странице: номер (#117), сумма, адрес, хэш, комментарий, категория, кто создал, взял или закрыл." },
      group_by: { type: "string", enum: [...GROUPS], description: "Разбивка сводки: status, kind, target (категория · куда), coin (монета · сеть), author, day, month. По умолчанию total — только итог." },
      limit: { type: "integer", description: "Сколько заявок списком, новые первыми, 0–200. По умолчанию 30; 0 — только сводка." },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, title: "Пополнения" },
  async run({ me }, a) {
    const since = str(a.since) || null, until = str(a.until) || null;
    if ((since && !DAY.test(since)) || (until && !DAY.test(until))) throw new ToolError("Даты — в формате YYYY-MM-DD");
    if (since && until && since > until) throw new ToolError("since позже until");
    const owner = me.role === "main";
    let userId: string | null = null;
    if (str(a.author)) {
      userId = findPerson(await team(), str(a.author)).id;
      if (!owner && userId !== me.id) throw new ToolError("Чужие заявки видит только владелец — тебе видны только свои");
    }
    const stages = arr(a.status).filter((s): s is Stage => s in LABEL);
    const group = (GROUPS as readonly string[]).includes(str(a.group_by)) ? (str(a.group_by) as Group) : "total";
    const all = await listTopups(owner ? null : me.id, MAX_ROWS);
    const rows = pickTopups(all, { since, until, userId, stages, kinds: arr(a.kind), targets: arr(a.target), assets: arr(a.asset), q: str(a.search) });
    const limit = Math.min(200, Math.max(0, Number.isFinite(Number(a.limit)) ? Math.floor(Number(a.limit)) : 30));
    const [totals] = summarize(rows, "total");
    return {
      scope: owner ? "все заявки" : "свои заявки", period: { since: since ?? "с начала", until: until ?? "сегодня" },
      totals: totals ?? { count: 0, paid_count: 0, amount: {}, paid: {} },
      groups: group === "total" ? undefined : summarize(rows, group),
      rows: limit ? rows.slice(0, limit).map(rowOf) : undefined,
      more_rows: Math.max(0, rows.length - limit) || undefined,
      notice: all.length >= MAX_ROWS ? `Учтены только последние ${MAX_ROWS} заявок` : undefined,
    };
  },
};

const TIMES = [0, 15, 30, 60, 120, 360, 1440];

const createTopupTool: Tool = {
  name: "create_topup",
  title: "Новая заявка на пополнение",
  description: "Создать заявку на пополнение — как форма на странице «Пополнения». Заявка сразу уходит Top-Up ботом в платёжный чат владельцев, и по ней переводят настоящие деньги: точную сумму на указанный адрес. Все поля обязательны. Перед вызовом покажи человеку все поля заявки и дождись его «да»; адрес и сумму бери только от него. Одна заявка за вызов.",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: Object.keys(CATEGORIES), description: "Категория." },
      target: { type: "string", description: `Куда именно, из списка категории: ${Object.entries(CATEGORIES).map(([k, v]) => `${k} — ${v.join(", ")}`).join("; ")}. Чего нет в списке — «Другое», а что именно — в комментарии.` },
      amount: { type: "number", description: "Сумма перевода точно до знака — платёжка узнаёт перевод по ней. USDT, USDC, TRX — до 6 знаков после точки, BTC — 8, GRAM — 9." },
      asset: { type: "string", enum: Object.keys(PAIRS), description: "Монета." },
      network: { type: "string", enum: [...new Set(Object.values(PAIRS).flat())], description: `Сеть, своя для монеты: ${Object.entries(PAIRS).map(([a, n]) => `${a} — ${n.join(", ")}`).join("; ")}. У монеты с одной сетью можно не указывать.` },
      fee: { type: "number", description: "Комиссия справкой, в перевод не входит. Нет комиссии — 0." },
      address: { type: "string", description: "Адрес получателя в выбранной сети." },
      minutes: { type: "integer", enum: TIMES, description: "Время на оплату в минутах: 15, 30, 60, 120, 360, 1440 (сутки) или 0 — без срока." },
      comment: { type: "string", description: "Комментарий для тех, кто платит. Нечего добавить — «-»." },
    },
    required: ["kind", "target", "amount", "asset", "fee", "address", "minutes", "comment"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true, title: "Новая заявка на пополнение" },
  async run({ me }, a) {
    const kind = oneOf(str(a.kind), Object.keys(CATEGORIES));
    const asset = str(a.asset).toUpperCase() as Asset;
    const network = str(a.network).toUpperCase() || (PAIRS[asset]?.length === 1 ? PAIRS[asset][0] : "");
    const amount = Number(a.amount), address = str(a.address);
    if (!TIMES.includes(Number(a.minutes))) throw new ToolError("Время на оплату — 0 (без срока), 15, 30, 60, 120, 360 или 1440 минут");
    const stop = guard(await listTopups(me.id, 50), { address, amount });
    if (stop) throw new ToolError(stop);
    const r = await createTopup(me.id, {
      kind, target: oneOf(str(a.target), CATEGORIES[kind] ?? []), amount, fee: typeof a.fee === "number" ? a.fee : undefined,
      asset, network, address, minutes: Number(a.minutes), comment: str(a.comment),
    }).catch((e: unknown) => { throw new ToolError(e instanceof Error ? e.message : String(e)); });
    return { created: rowOf(r), note: `Заявка #${r.number} ушла в платёжный чат. Статус — get_topups.` };
  },
};

export const TOPUP_TOOLS: Tool[] = [getTopups, createTopupTool];
