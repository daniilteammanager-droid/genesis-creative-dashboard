import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { createLinkCode } from "@/lib/telegram/links";
import { paymentUri, qrPng } from "@/lib/topups/qr";
import {
  createTopup, getTopup, hashPaid, listTopups, openCount, pressPaid, reject, release, take, topupChat, topupTg, type TopupInput,
} from "@/lib/topups/requests";

// Заявки на пополнение (Decision 072). Владелец видит все заявки и привязывает
// платёжный чат, остальные — только свои. user_id всегда из сессии.
// С Decision 126 владелец ещё и работает с заявкой со страницы — те же функции, что кнопки бота,
// поэтому сообщение в платёжном чате и страница всегда совпадают.

const fail = (e: unknown, status = 400) =>
  NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

type Me = { id: string; role: string; name: string | null; email: string };
// Имя, которым человек записывается в заявку («Платит …», «Оплатил …»). В боте — то же имя, если Telegram привязан (bot.ts).
const nameOf = (me: Me) => me.name || me.email;

async function view(me: Me) {
  const admin = me.role === "main";
  const chat = admin ? await topupChat() : null;
  return { admin, me: nameOf(me), chat: chat ? { title: chat.title } : null, topups: await listTopups(admin ? null : me.id) };
}

export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  try {
    // Счётчик в панели — только владельцам: остальным заявки чужих не видны.
    if (p.get("count")) return NextResponse.json({ open: me.role === "main" ? await openCount() : 0 });
    // QR открытой заявки — тот же, что в чате.
    const qr = p.get("qr");
    if (qr) {
      if (me.role !== "main") return fail("QR видят владельцы", 403);
      const r = await getTopup(qr);
      if (!r || r.status !== "pending") return fail("Заявка уже не ждёт оплаты", 404);
      return new NextResponse(new Uint8Array(await qrPng(paymentUri(r).uri)), {
        headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" },
      });
    }
    // Ссылка привязки платёжного чата — только владельцу.
    if (p.get("bind")) {
      if (me.role !== "main") return fail("Платёжный чат привязывает владелец", 403);
      const bot = await topupTg<{ username: string }>("getMe", {});
      return NextResponse.json({ link: `https://t.me/${bot.username}?startgroup=${await createLinkCode(me.id)}` });
    }
    return NextResponse.json(await view(me));
  } catch (e) {
    return fail(e, 500);
  }
}

// POST без op — новая заявка (любой). С op — действие с заявкой, только владелец.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    const body = (await req.json()) as TopupInput & { op?: string; id?: string; hash?: string };
    if (!body.op) {
      await createTopup(me.id, body);
      return NextResponse.json(await view(me));
    }
    // Скрытая кнопка — не защита: роль проверяется здесь.
    if (me.role !== "main") return fail("Брать и оплачивать заявки могут только владельцы", 403);
    const id = String(body.id ?? ""), by = nameOf(me);
    let error: string | null | undefined, note: string | undefined;
    switch (body.op) {
      case "take": error = await take(id, by); break;
      case "release": error = await release(id, by); break;
      case "paid": error = await pressPaid(id, by); break;
      case "reject": error = await reject(id, by); break;
      case "hash": ({ error, warn: note } = await hashPaid(id, String(body.hash ?? ""), by)); break;
      default: return fail(`Неизвестное действие: ${body.op}`);
    }
    if (error) return fail(error);
    return NextResponse.json({ ...(await view(me)), note });
  } catch (e) {
    return fail(e);
  }
}
