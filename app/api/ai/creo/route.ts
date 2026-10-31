import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { warehouse } from "@/lib/warehouse/read";
import { aiReady } from "@/lib/ai/claude";
import { analysesFor, analyzeCreo, budgetOf, creoBuyers, latest } from "@/lib/ai/creo";

// AI-разбор крео (Decision 101).
// GET — последний разбор по каждому крео (значки в «Отчётах»); ?recent=N — N свежих с текстом (Главная);
// ?buyer=&creo= — разбор одного крео целиком; ?creo=&who=1 — чьё это крео (модалка крео: кого можно разобрать).
// POST { buyer, creo } — разобрать (или вернуть прежний, если цифры те же).
export const maxDuration = 120;

const fail = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка" }, { status });

export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  try {
    const buyer = q.get("buyer"), creo = q.get("creo");
    if (creo && q.get("who")) return NextResponse.json({ ready: aiReady(), buyers: aiReady() ? await creoBuyers(me, creo.slice(0, 300)) : [] });
    if (buyer && creo) {
      if (me.role === "buyer" && buyer !== me.id) return fail(new Error("Чужое крео"), 403);
      const a = await latest(buyer, creo);
      return NextResponse.json({ ready: aiReady(), analysis: a && { ...a, data_hash: undefined }, budget: await budgetOf(buyer) });
    }
    const recent = Number(q.get("recent")) || 0;
    const analyses = await analysesFor(me, recent > 0, recent > 0 ? Math.min(recent, 20) : 2000);
    const { data: people } = await warehouse().from("profiles").select("id, name, buyer_code, email").in("id", [...new Set(analyses.map((a) => a.buyer_id!))]);
    const names = Object.fromEntries((people ?? []).map((p) => [p.id, p.name || p.buyer_code || p.email]));
    return NextResponse.json({ ready: aiReady(), analyses, names, budget: me.role === "buyer" ? await budgetOf(me.id) : null });
  } catch (e) {
    return fail(e, 500);
  }
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { buyer?: unknown; creo?: unknown } | null;
  try {
    const buyer = String(body?.buyer ?? ""), creo = String(body?.creo ?? "").slice(0, 300);
    if (!buyer || !creo.trim()) throw new Error("Нужны баер и крео");
    const analysis = await analyzeCreo(me, buyer, creo);
    return NextResponse.json({ analysis, budget: await budgetOf(buyer) });
  } catch (e) {
    return fail(e);
  }
}
