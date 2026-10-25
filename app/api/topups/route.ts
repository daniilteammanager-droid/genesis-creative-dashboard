import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { createLinkCode } from "@/lib/telegram/links";
import { createTopup, listTopups, topupChat, topupTg, type TopupInput } from "@/lib/topups/requests";

// Заявки на пополнение (Decision 072). Владелец видит все заявки и привязывает
// платёжный чат, остальные — только свои. user_id всегда из сессии.

const fail = (e: unknown, status = 400) =>
  NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

async function view(me: { id: string; role: string }) {
  const admin = me.role === "main";
  const chat = admin ? await topupChat() : null;
  return { admin, chat: chat ? { title: chat.title } : null, topups: await listTopups(admin ? null : me.id) };
}

export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    // Ссылка привязки платёжного чата — только владельцу.
    if (new URL(req.url).searchParams.get("bind")) {
      if (me.role !== "main") return fail("Платёжный чат привязывает владелец", 403);
      const bot = await topupTg<{ username: string }>("getMe", {});
      return NextResponse.json({ link: `https://t.me/${bot.username}?startgroup=${await createLinkCode(me.id)}` });
    }
    return NextResponse.json(await view(me));
  } catch (e) {
    return fail(e, 500);
  }
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    await createTopup(me.id, (await req.json()) as TopupInput);
    return NextResponse.json(await view(me));
  } catch (e) {
    return fail(e);
  }
}
