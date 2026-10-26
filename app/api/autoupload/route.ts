import { after, NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { getConnection } from "@/lib/connections/store";
import { buildPlan, type PlanInput } from "@/lib/autoupload/plan";
import { accountDetails, myAccounts, myCreatives, myLandings } from "@/lib/autoupload/options";
import { cancelJob, createJob, listJobs, runJob } from "@/lib/autoupload/jobs";

// Автозалив (Decision 081). Всё — от имени вошедшего: свои кабинеты, свой ключ
// Meta с ads_management, свои креативы. План пересобирается на сервере и при
// запуске — что пришло из формы, проверяется заново.
//   GET  ?op=options | accounts (живые статусы из Meta) | account&id= | jobs
//   POST { op: "preview" | "launch", input } · { op: "cancel", id }

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
  const b = (await req.json().catch(() => ({}))) as { op?: string; input?: PlanInput; id?: string };
  try {
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
