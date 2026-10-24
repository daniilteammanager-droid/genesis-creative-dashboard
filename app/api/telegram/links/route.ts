import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { botUsername } from "@/lib/telegram/api";
import { EVENTS, cleanEvents } from "@/lib/telegram/events";
import { createLinkCode, deleteLink, listLinks, sendTest, setLinkEvents } from "@/lib/telegram/links";

// Свои привязки Telegram. user_id всегда из сессии: чужую привязку не увидеть,
// не отвязать и не перенастроить.

const fail = (e: unknown, status = 500) =>
  NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET() {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    // Бот не настроен — это состояние, а не ошибка страницы.
    const bot = process.env.TELEGRAM_BOT_TOKEN ? await botUsername().catch(() => null) : null;
    return NextResponse.json({ bot, events: EVENTS, links: await listLinks(me.id) });
  } catch (e) {
    return fail(e);
  }
}

// { action: "code" } — новая ссылка привязки; { action: "test", id } — проверка связи.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    const body = (await req.json()) as { action?: string; id?: string };
    if (body.action === "code") {
      const bot = await botUsername();
      const code = await createLinkCode(me.id);
      return NextResponse.json({
        privateUrl: `https://t.me/${bot}?start=${code}`,
        groupUrl: `https://t.me/${bot}?startgroup=${code}`,
        command: `/link ${code}`,
      });
    }
    if (body.action === "test" && body.id) {
      await sendTest(me.id, body.id);
      return NextResponse.json({ ok: true });
    }
    return fail("Неизвестное действие", 400);
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  try {
    const body = (await req.json()) as { id?: string; events?: unknown };
    if (!body.id) return fail("Нет id привязки", 400);
    await setLinkEvents(me.id, body.id, cleanEvents(body.events));
    return NextResponse.json({ links: await listLinks(me.id) });
  } catch (e) {
    return fail(e, 400);
  }
}

export async function DELETE(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Нет id привязки", 400);
  try {
    await deleteLink(me.id, id);
    return NextResponse.json({ links: await listLinks(me.id) });
  } catch (e) {
    return fail(e);
  }
}
