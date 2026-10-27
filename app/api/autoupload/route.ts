import { after, NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { getConnection } from "@/lib/connections/store";
import { buildPlan, type PlanInput } from "@/lib/autoupload/plan";
import { accountDetails, myAccounts, myCreatives, myLandings } from "@/lib/autoupload/options";
import { cancelJob, createJob, listJobs, runJob } from "@/lib/autoupload/jobs";
import { warehouse } from "@/lib/warehouse/read";

// Автозалив (Decision 081). Всё — от имени вошедшего: свои кабинеты, свой ключ
// Meta с ads_management, свои креативы. План пересобирается на сервере и при
// запуске — что пришло из формы, проверяется заново.
//   GET  ?op=options | accounts (живые статусы из Meta) | account&id= | jobs | drafts
//   POST { op: "preview" | "launch", input } · { op: "cancel", id } · { op: "saveDraft", name, form } · { op: "deleteDraft", id }

export const maxDuration = 300;
const fail = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET(req: Request) {
  const me = await getProfile();
  if (!me || me.status !== "active") return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  try {
    if (p.get("op") === "account") return NextResponse.json(await accountDetails(me, p.get("id") ?? ""));
    if (p.get("op") === "accounts") return NextResponse.json({ accounts: await myAccounts(me, true) });
    if (p.get("op") === "jobs") return NextResponse.json({ jobs: await listJobs(me.id) });
    // Сохранённые сборки (Decision 092): форма целиком под своим названием.
    if (p.get("op") === "drafts") {
      const { data } = await warehouse().from("autoupload_drafts").select("id, name, form, updated_at").eq("user_id", me.id).order("updated_at", { ascending: false }).limit(30);
      return NextResponse.json({ drafts: data ?? [] });
    }
    const [accounts, landings, creatives] = await Promise.all([
      myAccounts(me), myLandings(me).catch(() => []), myCreatives(me),
    ]);
    return NextResponse.json({ accounts, landings, creatives });
  } catch (e) {
    return fail(e, 500);
  }
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || me.status !== "active") return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { op?: string; input?: PlanInput; id?: string; name?: string; form?: unknown };
  try {
    if (b.op === "saveDraft") {
      const name = (b.name ?? "").trim().slice(0, 80);
      if (!name || !b.form) return fail("Назови сборку");
      const { error } = await warehouse().from("autoupload_drafts").upsert({ user_id: me.id, name, form: b.form, updated_at: new Date().toISOString() }, { onConflict: "user_id,name" });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }
    if (b.op === "deleteDraft") {
      await warehouse().from("autoupload_drafts").delete().eq("id", b.id ?? "").eq("user_id", me.id);
      return NextResponse.json({ ok: true });
    }
    if (b.op === "cancel") return NextResponse.json({ errors: await cancelJob(me.id, b.id ?? "") });
    if (!b.input) return fail("Нет сборки");
    const accounts = new Map((await myAccounts(me)).map((a) => [a.id, a]));
    // Креативы — только свои из Медиатеки: ключ из формы сверяется заново.
    const own = new Set((await myCreatives(me)).map((c) => c.key));
    if (b.input.adsets?.some((a) => a.creatives?.some((c) => !own.has(c.key)))) return fail("Креатив не из твоей Медиатеки");
    const conn = await getConnection(me.id).catch(() => null);
    const plan = buildPlan(b.input, accounts, conn?.torroBuyerId ?? null);
    if (b.op === "preview") return NextResponse.json({ plan });
    if (b.op === "launch") {
      const id = await createJob(me.id, plan);
      after(() => runJob(id));
      return NextResponse.json({ id });
    }
    return fail("Неизвестная операция");
  } catch (e) {
    return fail(e);
  }
}
