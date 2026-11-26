import { after, NextResponse } from "next/server";
import { getSeat } from "@/lib/auth/server";
import { selfOf } from "@/lib/auth/types";
import { INTEGRATIONS } from "@/lib/nav";
import { juniorDid } from "@/lib/telegram/links";
import type { PlanInput } from "@/lib/autoupload/plan";
import { accountDetails, myAccounts, myCreatives, myLandings } from "@/lib/autoupload/options";
import { cancelJob, createJob, listJobs, planFor, runJob } from "@/lib/autoupload/jobs";
import { warehouse } from "@/lib/warehouse/read";
import { checkAutouploadKey, deleteAutouploadKey, setAutouploadKey, viewAutouploadKey } from "@/lib/autoupload/key";
import { listMetaKeys } from "@/lib/connections/metaKeys";

// Автозалив (Decision 081). Всё — от имени вошедшего: свои кабинеты, свой ключ
// Meta с ads_management, свои креативы. План пересобирается на сервере и при
// запуске — что пришло из формы, проверяется заново.
//   GET  ?op=options | accounts (живые статусы из Meta) | account&id= | jobs | drafts | key
//   POST { op: "preview" | "launch", input } · { op: "cancel", id } · { op: "saveDraft", name, form } · { op: "deleteDraft", id }
//        · { op: "setKey", name, token, secret } · { op: "deleteKey" } · { op: "checkKey" } — приложение автозалива

export const maxDuration = 300;
const fail = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET(req: Request) {
  const me = await getSeat();
  if (!me || me.status !== "active") return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  try {
    if (p.get("op") === "account") return NextResponse.json(await accountDetails(me, p.get("id") ?? ""));
    if (p.get("op") === "accounts") return NextResponse.json({ accounts: await myAccounts(me, true) });
    if (p.get("op") === "jobs") return NextResponse.json({ jobs: await listJobs(me.id) });
    // Приложение Meta для автозалива (Decision 093) и чем зальём без него.
    if (p.get("op") === "key") {
      const [key, stats] = await Promise.all([viewAutouploadKey(me.id), listMetaKeys(me.id).catch(() => [])]);
      return NextResponse.json({ key, fallback: stats.find((k) => k.canWrite)?.name ?? null });
    }
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
  const me = await getSeat();
  if (!me || me.status !== "active") return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { op?: string; input?: PlanInput; id?: string; name?: string; form?: unknown; token?: string; secret?: string };
  try {
    // Джун заливает в кабинеты баера его ключом; сам ключ меняет, только если ему открыли «Интеграции» (Decision 127).
    const keyOp = ["setKey", "deleteKey", "checkKey"].includes(b.op ?? "");
    if (keyOp && me.actor && !me.actor.areas?.includes(INTEGRATIONS)) return fail("Ключ автозалива подключает баер", 403);
    if (b.op === "setKey") {
      await setAutouploadKey(me.id, b.name ?? "", b.token ?? "", b.secret ?? "");
      await juniorDid(me, "поменял ключ автозалива");
      return NextResponse.json({ key: await viewAutouploadKey(me.id) });
    }
    if (b.op === "deleteKey") { await deleteAutouploadKey(me.id); await juniorDid(me, "отключил ключ автозалива"); return NextResponse.json({ ok: true }); }
    if (b.op === "checkKey") return NextResponse.json(await checkAutouploadKey(me.id));
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
    const plan = await planFor(me, b.input);
    if (b.op === "preview") return NextResponse.json({ plan });
    if (b.op === "launch") {
      const id = await createJob(me.id, plan, selfOf(me).id);
      after(() => runJob(id));
      return NextResponse.json({ id });
    }
    return fail("Неизвестная операция");
  } catch (e) {
    return fail(e);
  }
}
