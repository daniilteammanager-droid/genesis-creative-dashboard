import { warehouse } from "@/lib/warehouse/read";
import { escapeHtml, tg, TelegramError } from "@/lib/telegram/api";
import { mskDay, mskStamp, mskTime } from "@/lib/day";
import { paymentUri, qrPng } from "./qr";
import { addressFits, AUTO_SEARCH, DECIMALS, exact, findPayment, PAIRS, transferByHash, txUrl, type Asset, type Network, type Transfer } from "./chain";
import { stage, type Stage } from "./view";

// Заявки на пополнение (Decision 072): создать, показать в платёжном чате,
// закрыть оплатой, отказом или по сроку. Таблицы закрыты от браузера — всё
// сервисным ключом, доступ проверяют роуты.

// Что пополняем: категория → куда именно. «Другое» — для того, чего нет в списке
// (провайдеров прокси всех не впишешь).
export const OTHER = "Другое";
export const CATEGORIES: Record<string, string[]> = {
  "Расходники": ["Кабинеты/БМ/Кинги/ФП", "Прокси", "Домены", "Почты", "Антик", "Сервера/хостинг", "Подписки/сервисы", "Кошелёк USDT", "Склад кабинетов", OTHER],
  "Карты": ["Brocard", "AbCard", "Adpos", "FBMcards", OTHER],
  "Агенты": ["T2A", "RentAcc", "TSR", "Monika (агенты TikTok)", OTHER],
  "Кабинеты": ["TG Ads кабинеты (TON)", OTHER],
};
// Автопоиск ищет перевод сутки после «Оплачено», дальше — только хэш руками.
const SEARCH_FOR_MS = 24 * 3600_000;

export interface Topup {
  id: string; number: number; user_id: string; kind: string; target: string;
  amount: number; fee: number; asset: Asset; network: Network; address: string; comment: string | null;
  expires_at: string | null; status: "pending" | "paid" | "rejected" | "expired";
  // taken_by — кто в чате нажал «Беру в работу» (платит он, остальные не переводят).
  taken_by: string | null; taken_at: string | null;
  searching_since: string | null; tx_hash: string | null; paid_amount: number | null; paid_at: string | null;
  // qr — отдельное фото QR у заявок до 13.11.2026; теперь QR внутри сообщения.
  closed_by: string | null; messages: { chat_id: number; message_id: number; qr?: boolean }[]; created_at: string;
  author?: string; tx_url?: string;
}

const COLS = "id, number, user_id, kind, target, amount, fee, asset, network, address, comment, expires_at, status, taken_by, taken_at, searching_since, tx_hash, paid_amount, paid_at, closed_by, messages, created_at";
const db = () => warehouse();
const num = (r: Topup): Topup => ({ ...r, amount: Number(r.amount), fee: Number(r.fee), paid_amount: r.paid_amount === null ? null : Number(r.paid_amount) });

export function topupToken(): string {
  const t = process.env.TOPUP_BOT_TOKEN;
  if (!t) throw new Error("Не задан TOPUP_BOT_TOKEN — бот пополнений не подключён");
  return t;
}
export const topupTg = <T = unknown>(method: string, body: Record<string, unknown>, file?: { name: string; png: Uint8Array }) =>
  tg<T>(method, body, topupToken(), file);

export async function topupChat(): Promise<{ chat_id: number; thread_id: number | null; title: string | null } | null> {
  const { data } = await db().from("topup_chat").select("chat_id, thread_id, title").eq("id", 1).maybeSingle();
  return data as { chat_id: number; thread_id: number | null; title: string | null } | null;
}

async function authors(ids: string[]): Promise<Map<string, string>> {
  const { data } = await db().from("profiles").select("id, name, email").in("id", [...new Set(ids)]);
  return new Map((data ?? []).map((p) => [p.id as string, (p.name as string) || (p.email as string)]));
}

// ponytail: поиск и фильтры страницы идут по этим строкам в браузере — 500 последних (на 13.11 всего 109);
// упрёмся — поиск на сервер.
export async function listTopups(userId: string | null, limit = 500): Promise<Topup[]> {
  let q = db().from("topup_requests").select(COLS).order("created_at", { ascending: false }).limit(limit);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => num(r as Topup));
  const names = await authors(rows.map((r) => r.user_id));
  return rows.map((r) => ({ ...r, author: names.get(r.user_id) ?? "—", tx_url: r.tx_hash ? txUrl(r.network, r.tx_hash) : undefined }));
}

async function getTopup(id: string): Promise<Topup | null> {
  const { data } = await db().from("topup_requests").select(COLS).eq("id", id).maybeSingle();
  if (!data) return null;
  const r = num(data as Topup);
  return { ...r, author: (await authors([r.user_id])).get(r.user_id) ?? "—" };
}

export const what = (r: Pick<Topup, "kind" | "target">) => (r.target ? `${r.kind} · ${r.target}` : r.kind);
const money = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 9 });
const when = (iso: string) => {
  const d = new Date(iso);
  return mskDay(d) === mskDay() ? `${mskTime(d)} МСК` : `${mskStamp(d)} МСК`;
};

// Сообщение заявки в платёжном чате — компактное (13.11.2026: первый вариант Даниилу показался длинным): строка-
// заголовок с состоянием, «что сейчас» — только когда что-то происходит, короткая таблица, QR свёрнут под
// «QR для оплаты», кнопки «Скопировать» и одна строка действий. Rich message (Bot API 10.1+): одно сообщение вместо
// текста и отдельного фото. Адрес виден, только пока заявку можно оплатить или она оплачена.
const HEAD: Record<Stage, string> = {
  pending: "🚨 #{n} · ждёт оплаты", work: "🛠 #{n} · в работе", search: "🔎 #{n} · ищу перевод",
  paid: "✅ #{n} · оплачено", rejected: "✖️ #{n} · отклонено", expired: "⌛ #{n} · время вышло",
};
const e = (s: string | null | undefined) => escapeHtml(s ?? "—");
const attr = (s: string) => escapeHtml(s).replace(/"/g, "&quot;");
const head = (r: Topup, st: Stage) => `<b>${HEAD[st].replace("{n}", String(r.number))}</b> · ${e(what(r))} · ${e(r.author)}`;

// Что сейчас с заявкой. У новой — ничего: кнопки говорят сами.
function line(r: Topup, st: Stage): string | null {
  switch (st) {
    case "pending": return null;
    case "work": return `Платит ${e(r.taken_by)}${r.taken_at ? ` с ${when(r.taken_at)}` : ""} — остальные не переводите`;
    case "search": return `${e(r.closed_by)} отметил оплату — ищу перевод. Хэш — ответом на это сообщение`;
    case "paid": return `Оплатил ${e(r.closed_by)}${r.paid_at ? ` · ${when(r.paid_at)}` : ""}${r.paid_amount ? ` · пришло ${money(r.paid_amount)} ${r.asset}` : ""}`;
    case "rejected": return `Отклонил ${e(r.closed_by)}`;
    case "expired": return `Время вышло${r.expires_at ? ` в ${when(r.expires_at)}` : ""} — нужна новая заявка`;
  }
}

// Поля таблицы: [подпись, значение в HTML]. Сумма и адрес — <code>: в чате копируются нажатием.
function fields(r: Topup, st: Stage): [string, string][] {
  const open = st === "pending" || st === "work" || st === "search";
  const rows: [string, string][] = [
    ["Сумма", `<code>${exact(r.amount, r.asset)}</code> <b>${r.asset}</b> · ${r.network}`],
    ["Адрес", open || st === "paid" ? `<code>${e(r.address)}</code>` : "скрыт"],
  ];
  // Комиссия — справкой: в сумму перевода не входит, агент и платёжка считают её сами от пополнения.
  if (r.fee) rows.push(["Комиссия", `${money(r.fee)} · не в переводе`]);
  if (open && r.expires_at) rows.push(["Срок", `до ${when(r.expires_at)}`]);
  if (r.comment) rows.push(["Коммент", e(r.comment)]);
  return rows;
}

export function topupHtml(r: Topup, qr: boolean): string {
  const st = stage(r);
  const amount = exact(r.amount, r.asset);
  const now = line(r, st);
  return [
    `<p>${head(r, st)}</p>`,
    now ? `<blockquote>${now}</blockquote>` : "",
    `<table compact>${fields(r, st).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>`,
    qr ? `<details><summary>QR для оплаты</summary><figure><img src="tg://photo?id=qr"/><figcaption>${paymentUri(r).withAmount
      ? "Адрес, сумма и монета подставятся сами" : `Подставится адрес, сумму — точно: ${amount}`}</figcaption></figure></details>` +
      `<tg-button-row><tg-button type="copy_text" text="${attr(amount)}">Копировать сумму</tg-button>` +
      `<tg-button type="copy_text" text="${attr(r.address)}">Копировать адрес</tg-button></tg-button-row>` : "",
  ].join("");
}

// Запасной вид — прежний текст: если Telegram не примет rich message, заявка всё равно дойдёт до чата.
export function topupText(r: Topup): string {
  const st = stage(r);
  return [head(r, st), line(r, st), ...fields(r, st).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join("\n");
}

// Действия — одной строкой. Ссылка на перевод у оплаченной — кнопкой, а не строкой с хэшем.
function buttons(r: Topup) {
  const paid = { text: "✅ Оплачено", callback_data: `tp:paid:${r.id}`, style: "success" };
  const no = { text: "✖ Отклонить", callback_data: `tp:no:${r.id}`, style: "danger" };
  switch (stage(r)) {
    case "pending": return { inline_keyboard: [[{ text: "🛠 Беру", callback_data: `tp:take:${r.id}`, style: "primary" }, paid, no]] };
    case "work": return { inline_keyboard: [[paid, { text: "↩ Снять", callback_data: `tp:free:${r.id}` }, no]] };
    case "search": return { inline_keyboard: [[no]] };
    case "paid": return { inline_keyboard: r.tx_hash ? [[{ text: "Транзакция ↗", url: txUrl(r.network, r.tx_hash) }]] : [] };
    default: return { inline_keyboard: [] };
  }
}

const quiet = (e: unknown) => e instanceof TelegramError && /not modified|message to edit not found/i.test(e.message);

// Отправить (to — чат) или перерисовать (to — сообщение) заявку. QR — пока заявку можно оплатить:
// картинка грузится заново при каждой правке, правок у заявки — единицы.
async function show(r: Topup, to: Record<string, unknown>): Promise<number> {
  const edit = "message_id" in to;
  const st = stage(r);
  const qr = st === "pending" || st === "work" || st === "search" ? await qrPng(paymentUri(r).uri).catch(() => null) : null;
  try {
    const res = await topupTg<{ message_id: number } | true>(edit ? "editMessageText" : "sendRichMessage", {
      ...to, reply_markup: buttons(r),
      rich_message: { html: topupHtml(r, Boolean(qr)), skip_entity_detection: true,
        ...(qr ? { media: [{ id: "qr", media: { type: "photo", media: "attach://qr" } }] } : {}) },
    }, qr ? { name: "qr", png: qr } : undefined);
    return typeof res === "object" ? res.message_id : Number(to.message_id);
  } catch (err) {
    if (quiet(err)) return Number(to.message_id);
    // Запасной текст — только когда Telegram отверг сам rich message (400/404). Сеть или тайм-аут — ошибка как
    // раньше: сообщение могло уже дойти, и второе, текстом, задвоило бы заявку в чате.
    if (!(err instanceof TelegramError && (err.code === 400 || err.code === 404))) throw err;
    console.warn("topups: rich message не прошёл, шлю текстом", err instanceof Error ? err.message : err);
    const res = await topupTg<{ message_id: number } | true>(edit ? "editMessageText" : "sendMessage", {
      ...to, text: topupText(r), parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: buttons(r),
    }).catch((e2) => { if (quiet(e2)) return true as const; throw e2; });
    return typeof res === "object" ? res.message_id : Number(to.message_id);
  }
}

// Перерисовать сообщения заявки в чате по её текущему состоянию.
async function refresh(r: Topup): Promise<void> {
  for (const m of r.messages) {
    // Отдельное фото QR старых заявок: с адресом нельзя оставлять после закрытия.
    if (m.qr) {
      if (r.status !== "pending") await topupTg("deleteMessage", { chat_id: m.chat_id, message_id: m.message_id }).catch(() => undefined);
      continue;
    }
    await show(r, { chat_id: m.chat_id, message_id: m.message_id });
  }
}

export interface TopupInput {
  kind?: string; target?: string; amount?: number; fee?: number; network?: string; asset?: string;
  address?: string; comment?: string; minutes?: number | null;
}

export async function createTopup(userId: string, input: TopupInput): Promise<Topup> {
  const kind = (input.kind ?? "").trim(), target = (input.target ?? "").trim();
  const comment = (input.comment ?? "").trim();
  const address = (input.address ?? "").trim();
  const amount = Number(input.amount), fee = Number(input.fee ?? 0);
  const asset = input.asset as Asset, network = input.network as Network;
  const net = PAIRS[asset]?.includes(network) ? { asset, network } : null;
  // Все поля обязательны: механика для баеров новая, пропуск поля — потерянная оплата.
  if (!CATEGORIES[kind]?.includes(target)) throw new Error("Выбери категорию и куда именно пополняем");
  if (!(amount > 0)) throw new Error("Сумма должна быть больше нуля");
  if (input.fee === undefined || input.fee === null || !(fee >= 0)) throw new Error("Укажи комиссию — нет комиссии, ставь 0");
  if (!comment) throw new Error("Комментарий обязателен — нечего добавить, ставь «-»");
  if (!PAIRS[asset]) throw new Error("Выбери монету");
  if (!net) throw new Error(`${asset} в сети ${network ?? "—"} не переводим — выбери другую сеть`);
  if (Number(exact(amount, net.asset)) !== amount) throw new Error(`У ${net.asset} не больше ${DECIMALS[net.asset]} знаков после точки — такую сумму не перевести точно`);
  if (!addressFits(net.network, address)) throw new Error(`Адрес не похож на адрес сети ${net.network}`);
  if (input.minutes === undefined || input.minutes === null) throw new Error("Выбери время на оплату");
  const minutes = Number(input.minutes) || null;   // 0 — осознанно «без срока»

  const chat = await topupChat();
  if (!chat) throw new Error("Платёжный чат ещё не привязан — заявку некуда отправить");
  const { data, error } = await db().from("topup_requests").insert({
    user_id: userId, kind, target, amount, fee, network: net.network, asset: net.asset, address,
    comment: comment === "-" ? null : comment,
    expires_at: minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null,
  }).select("id").single();
  if (error) throw new Error(error.message);
  const r = (await getTopup(data.id as string))!;

  const sent = await show(r, { chat_id: chat.chat_id, ...(chat.thread_id ? { message_thread_id: chat.thread_id } : {}) });
  r.messages = [{ chat_id: chat.chat_id, message_id: sent }];
  await db().from("topup_requests").update({ messages: r.messages }).eq("id", r.id);
  return r;
}

const hashTaken = async (hash: string) =>
  Boolean((await db().from("topup_requests").select("id").eq("tx_hash", hash).maybeSingle()).data);

// Закрыть оплатой. Условие status = pending — двойной клик и параллельный крон
// не закроют дважды; занятый хэш не запишется за вторую заявку (unique).
export async function markPaid(id: string, pay: { hash: string; amount?: number }, by: string | null): Promise<Topup | string> {
  const { data, error } = await db().from("topup_requests").update({
    status: "paid", tx_hash: pay.hash, paid_amount: pay.amount ?? null, paid_at: new Date().toISOString(),
    closed_by: by, searching_since: null,
  }).eq("id", id).eq("status", "pending").select("id");
  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      const { data: other } = await db().from("topup_requests").select("number").eq("tx_hash", pay.hash).maybeSingle();
      return `Этот хэш уже записан за заявкой #${other?.number ?? "?"}.`;
    }
    throw new Error(error.message);
  }
  if (!data?.length) return "Заявка уже закрыта.";
  const r = (await getTopup(id))!;
  await refresh(r);
  return r;
}

// recentMs — для крона: при «Оплачено» окно уже просмотрено целиком, дальше хватит свежих минут.
async function trySearch(r: Topup, recentMs?: number): Promise<Transfer | null> {
  return findPayment({ network: r.network, asset: r.asset, address: r.address, amount: r.amount, createdAt: r.created_at }, hashTaken, recentMs);
}

// «Беру в работу»: заявку платит этот человек. Условие taken_by is null — двое одновременно не возьмут,
// второму — ответ, кто уже взял.
export async function take(id: string, by: string | null): Promise<string | null> {
  const { data } = await db().from("topup_requests").update({ taken_by: by ?? "кто-то", taken_at: new Date().toISOString() })
    .eq("id", id).eq("status", "pending").is("searching_since", null).is("taken_by", null).select("id");
  const r = await getTopup(id);
  if (!data?.length) {
    return r && stage(r) === "work"
      ? `Заявку #${r.number} уже взял ${r.taken_by}${r.taken_at ? ` в ${when(r.taken_at)}` : ""}. Не переводи — спроси его.`
      : "Заявка уже не ждёт оплаты.";
  }
  await refresh(r!);
  return null;
}

// «Снять с себя» — только тот, кто взял: остальным хватит «Оплачено» и «Отклонить».
export async function release(id: string, by: string | null): Promise<string | null> {
  const { data } = await db().from("topup_requests").update({ taken_by: null, taken_at: null })
    .eq("id", id).eq("status", "pending").is("searching_since", null).eq("taken_by", by ?? "").select("id");
  const r = await getTopup(id);
  if (!data?.length) return r && stage(r) === "work" ? `Снять может только ${r.taken_by}.` : "Заявка уже не в работе.";
  await refresh(r!);
  return null;
}

// «Оплачено»: сразу ищем перевод; не нашли — заявка ждёт его в поиске (крон раз в минуту).
export async function pressPaid(id: string, by: string | null): Promise<string | null> {
  const { data } = await db().from("topup_requests").update({ searching_since: new Date().toISOString(), closed_by: by })
    .eq("id", id).eq("status", "pending").is("searching_since", null).select("id");
  if (!data?.length) return "Заявка уже закрыта или уже в поиске.";
  const r = (await getTopup(id))!;
  const t = await trySearch(r).catch(() => null);
  if (t) {
    const res = await markPaid(id, t, by);
    return typeof res === "string" ? res : null;
  }
  await refresh(r);
  return null;
}

export async function reject(id: string, by: string | null): Promise<string | null> {
  const { data } = await db().from("topup_requests").update({ status: "rejected", closed_by: by, searching_since: null })
    .eq("id", id).eq("status", "pending").select("id");
  if (!data?.length) return "Заявка уже закрыта.";
  const r = (await getTopup(id))!;
  await refresh(r);
  return null;
}

// Хэш, присланный руками: сумму перевода берём из блокчейна, если он пришёл на адрес заявки.
export async function manualPaid(r: Topup, hash: string, by: string | null): Promise<{ result: Topup | string; seen: boolean }> {
  const t = await transferByHash(r.network, r.asset, r.address, hash, Date.parse(r.created_at)).catch(() => null);
  return { result: await markPaid(r.id, { hash: t?.hash ?? hash, amount: t?.amount }, by), seen: Boolean(t) };
}

// Ответ хэшем на сообщение заявки в чате.
export async function topupByMessage(chatId: number, messageId: number): Promise<Topup | null> {
  // JSON строкой: массив supabase-js превращает в литерал массива Postgres, а не в jsonb.
  const { data } = await db().from("topup_requests").select("id")
    .filter("messages", "cs", JSON.stringify([{ chat_id: chatId, message_id: messageId }])).maybeSingle();
  return data ? getTopup(data.id as string) : null;
}

// Крон раз в минуту: истёкшие закрыть (адрес из сообщения убрать), по нажатым
// «Оплачено» — поискать перевод.
export async function tickTopups(): Promise<{ expired: number; found: number; errors: string[] }> {
  const now = new Date().toISOString();
  const out = { expired: 0, found: 0, errors: [] as string[] };

  const { data: gone } = await db().from("topup_requests").update({ status: "expired" })
    .eq("status", "pending").is("searching_since", null).lt("expires_at", now).select("id");
  for (const g of gone ?? []) {
    out.expired++;
    try {
      const r = (await getTopup(g.id as string))!;
      await refresh(r);
        } catch (e) {
      out.errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  const { data: open } = await db().from("topup_requests").select("id").eq("status", "pending")
    .not("searching_since", "is", null).gt("searching_since", new Date(Date.now() - SEARCH_FOR_MS).toISOString())
    .in("network", AUTO_SEARCH);
  for (const o of open ?? []) {
    try {
      const r = (await getTopup(o.id as string))!;
      const t = await trySearch(r, 15 * 60_000);
      if (t && typeof (await markPaid(r.id, t, r.closed_by)) !== "string") out.found++;
    } catch (e) {
      out.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}
