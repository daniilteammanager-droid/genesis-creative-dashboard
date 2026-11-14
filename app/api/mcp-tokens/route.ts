import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { createPersonalKey, listConnections, revokeConnection } from "@/lib/mcp/store";

// Настройки → AI-доступ (Decision 116): свои подключения Claude и Codex, отключение и личный
// ключ для терминала. Только свои — чужие подключения не видит никто, владелец отключает человека целиком.
//   GET — список · POST { name } — новый ключ (показывается один раз) · DELETE ?id= — отключить

async function me() {
  const p = await getProfile();
  return p && p.status === "active" ? p : null;
}

export async function GET() {
  const p = await me();
  if (!p) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  return NextResponse.json({ connections: await listConnections(p) });
}

export async function POST(req: Request) {
  const p = await me();
  if (!p) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { name?: string };
  try {
    return NextResponse.json({ key: await createPersonalKey(p, b.name ?? "") });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const p = await me();
  if (!p) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  try {
    await revokeConnection(p, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
