import { warehouse } from "@/lib/warehouse/read";
import { escapeHtml, tg, TelegramError } from "@/lib/telegram/api";
import { mskDay, mskStamp, mskTime } from "@/lib/day";
import { addressFits, AUTO_SEARCH, findPayment, transferByHash, txUrl, type Asset, type Network, type Transfer } from "./chain";

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
export const NETWORKS: { network: Network; asset: Asset; label: string }[] = [
  { network: "TRC20", asset: "USDT", label: "USDT · TRC20" },
  { network: "TON", asset: "USDT", label: "USDT · TON" },
  { network: "TON", asset: "GRAM", label: "GRAM · TON" },
  { network: "BEP20", asset: "USDT", label: "USDT · BEP20" },
  { network: "ERC20", asset: "USDT", label: "USDT · ERC20" },
];
// Автопоиск ищет перевод сутки после «Оплачено», дальше — только хэш руками.
const SEARCH_FOR_MS = 24 * 3600_000;

export interface Topup {
  id: string; number: number; user_id: string; kind: string; target: string;
  amount: number; fee: number; asset: Asset; network: Network; address: string; comment: string | null;
  expires_at: string | null; status: "pending" | "paid" | "rejected" | "expired";
  searching_since: string | null; tx_hash: string | null; paid_amount: number | null; paid_at: string | null;
  closed_by: string | null; messages: { chat_id: number; message_id: number }[]; created_at: string;
  author?: string;
}

const COLS = "id, number, user_id, kind, target, amount, fee, asset, network, address, comment, expires_at, status, searching_since, tx_hash, paid_amount, paid_at, closed_by, messages, created_at";
const db = () => warehouse();
const num = (r: Topup): Topup => ({ ...r, amount: Number(r.amount), fee: Number(r.fee), paid_amount: r.paid_amount === null ? null : Number(r.paid_amount) });

export function topupToken(): string {
  const t = process.env.TOPUP_BOT_TOKEN;
  if (!t) throw new Error("Не задан TOPUP_BOT_TOKEN — бот пополнений не подключён");
  return t;
}
export const topupTg = <T = unknown>(method: string, body: Record<string, unknown>) => tg<T>(method, body, topupToken());

export async function topupChat(): Promise<{ chat_id: number; thread_id: number | null; title: string | null } | null> {
  const { data } = await db().from("topup_chat").select("chat_id, thread_id, title").eq("id", 1).maybeSingle();
  return data as { chat_id: number; thread_id: number | null; title: string | null } | null;
}

async function authors(ids: string[]): Promise<Map<string, string>> {
  const { data } = await db().from("profiles").select("id, name, email").in("id", [...new Set(ids)]);
  return new Map((data ?? []).map((p) => [p.id as string, (p.name as string) || (p.email as string)]));
}

export async function listTopups(userId: string | null, limit = 200): Promise<Topup[]> {
  let q = db().from("topup_requests").select(COLS).order("created_at", { ascending: false }).limit(limit);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => num(r as Topup));
  const names = await authors(rows.map((r) => r.user_id));
  return rows.map((r) => ({ ...r, author: names.get(r.user_id) ?? "—" }));
}

async function getTopup(id: string): Promise<Topup | null> {
  const { data } = await db().from("topup_requests").select(COLS).eq("id", id).maybeSingle();
  if (!data) return null;
  const r = num(data as Topup);
  return { ...r, author: (await authors([r.user_id])).get(r.user_id) ?? "—" };
}

export const what = (r: Pick<Topup, "kind" | "target">) => (r.target ? `${r.kind} · ${r.target}` : r.kind);
const money = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 6 });
const when = (iso: string) => {
  const d = new Date(iso);
  return mskDay(d) === mskDay() ? `${mskTime(d)} МСК` : `${mskStamp(d)} МСК`;
};

// Текст заявки в чате. Адрес виден, только пока заявку можно оплатить.
export function topupText(r: Topup): string {
  const total = r.fee ? ` + комиссия ${money(r.fee)} = <b>${money(r.amount + r.fee)} ${r.asset}</b>` : ` ${r.asset}`;
  const lines = [
    `🧾 <b>Заявка #${r.number}</b> · ${escapeHtml(what(r))}`,
    `От: ${escapeHtml(r.author ?? "—")}`,
    `Сумма: ${r.fee ? money(r.amount) : `<b>${money(r.amount)}</b>`}${total}`,
    `Сеть: ${r.network}`,
    r.status === "expired" || r.status === "rejected" ? "Адрес: скрыт" : `Адрес: <code>${escapeHtml(r.address)}</code>`,
  ];
  if (r.comment) lines.push(`Комментарий: ${escapeHtml(r.comment)}`);
  if (r.status === "pending" && r.expires_at) lines.push(`⏳ Оплатить до ${when(r.expires_at)}`);
  lines.push("");
  if (r.status === "paid") {
    lines.push(`✅ Оплачено${r.closed_by ? ` · ${escapeHtml(r.closed_by)}` : ""}${r.paid_amount ? ` · ${money(r.paid_amount)} ${r.asset}` : ""}`);
    if (r.tx_hash) lines.push(`<a href="${txUrl(r.network, r.tx_hash)}">Транзакция</a> · <code>${r.tx_hash}</code>`);
  } else if (r.status === "expired") {
    lines.push(`⌛ Время на оплату истекло${r.expires_at ? ` в ${when(r.expires_at)}` : ""} — нужна новая заявка`);
  } else if (r.status === "rejected") {
    lines.push(`✖️ Отклонено${r.closed_by ? ` · ${escapeHtml(r.closed_by)}` : ""}`);
  } else if (r.searching_since) {
    lines.push(AUTO_SEARCH.includes(r.network)
      ? `🔎 Отмечено оплаченным${r.closed_by ? ` (${escapeHtml(r.closed_by)})` : ""} — ищу перевод в блокчейне. Хэш можно прислать ответом на это сообщение.`
      : `🔎 Отмечено оплаченным — пришли хэш ответом на это сообщение (для ${r.network} бот сам не ищет).`);
  }
  return lines.join("\n");
}

function buttons(r: Topup) {
  if (r.status !== "pending") return { inline_keyboard: [] };
  const row = r.searching_since ? [] : [{ text: "💸 Оплачено", callback_data: `tp:paid:${r.id}` }];
  return { inline_keyboard: [[...row, { text: "✖️ Отклонить", callback_data: `tp:no:${r.id}` }]] };
}

// Перерисовать сообщения заявки в чате по её текущему состоянию.
async function refresh(r: Topup): Promise<void> {
  for (const m of r.messages) {
    try {
      await topupTg("editMessageText", {
        chat_id: m.chat_id, message_id: m.message_id, text: topupText(r), parse_mode: "HTML",
        link_preview_options: { is_disabled: true }, reply_markup: buttons(r),
      });
    } catch (e) {
      if (!(e instanceof TelegramError && /not modified|message to edit not found/i.test(e.message))) throw e;
    }
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
  const net = NETWORKS.find((n) => n.network === input.network && n.asset === input.asset);
  // Все поля обязательны: механика для баеров новая, пропуск поля — потерянная оплата.
  if (!CATEGORIES[kind]?.includes(target)) throw new Error("Выбери категорию и куда именно пополняем");
  if (!(amount > 0)) throw new Error("Сумма должна быть больше нуля");
  if (input.fee === undefined || input.fee === null || !(fee >= 0)) throw new Error("Укажи комиссию — нет комиссии, ставь 0");
  if (!comment) throw new Error("Комментарий обязателен — нечего добавить, ставь «-»");
  if (!net) throw new Error("Выбери сеть");
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

  const sent = await topupTg<{ message_id: number }>("sendMessage", {
    chat_id: chat.chat_id, ...(chat.thread_id ? { message_thread_id: chat.thread_id } : {}),
    text: topupText(r), parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: buttons(r),
  });
  r.messages = [{ chat_id: chat.chat_id, message_id: sent.message_id }];
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

async function trySearch(r: Topup): Promise<Transfer | null> {
  return findPayment({ network: r.network, asset: r.asset, address: r.address, amount: r.amount, fee: r.fee, createdAt: r.created_at }, hashTaken);
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
      const t = await trySearch(r);
      if (t && typeof (await markPaid(r.id, t, r.closed_by)) !== "string") out.found++;
    } catch (e) {
      out.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}
