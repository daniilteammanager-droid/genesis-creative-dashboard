import { warehouse } from "@/lib/warehouse/read";
import { advance, cancelCreated, MetaError, type Job } from "./launch";
import { buildPlan, type Plan, type PlanInput } from "./plan";
import { myAccounts, myCreatives, stemOf } from "./options";
import { getConnection } from "@/lib/connections/store";
import type { Profile } from "@/lib/auth/types";

// Очередь автозалива (Decision 081). Проход берёт задание арендой: пока аренда не
// истекла, второй проход его не тронет — иначе одна кампания создалась бы дважды.

const db = () => warehouse();
const LEASE_MS = 290_000;

// userId — чьи кабинеты и ключ (у джуна — его баер), actorId — кто нажал (060_junior.sql).
export async function createJob(userId: string, plan: Plan, actorId = userId): Promise<string> {
  const { data, error } = await db().from("autoupload_jobs").insert({ user_id: userId, actor_id: actorId, plan, stage: "В очереди" }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

// Сборка → план, как у страницы: кабинеты — свои живые, креативы — только из своей Медиатеки (ключ сверяется
// заново), нейминг и проверки — buildPlan. Общий для /api/autoupload и AI-доступа (lib/mcp/autoupload.ts).
export async function planFor(me: Profile, input: PlanInput): Promise<Plan> {
  const accounts = new Map((await myAccounts(me)).map((a) => [a.id, a]));
  // Креативы — только свои из Медиатеки: ключ из формы сверяется заново. Ключ в форме
  // устаревает: воркер пережимает X.mov в X.mp4 и удаляет .mov, сборка лежит с прошлой недели —
  // тот же файл ищем по имени без расширения, а чего нет совсем — называем поимённо.
  const lib = await myCreatives(me);
  const own = new Set(lib.map((c) => c.key));
  const byStem = new Map(lib.map((c) => [`${c.kind}|${stemOf(c.key)}`, c.key]));
  const missing: string[] = [];
  for (const a of input.adsets ?? []) for (const c of a.creatives ?? []) {
    if (own.has(c.key)) continue;
    const now = byStem.get(`${c.kind}|${stemOf(c.key)}`);
    if (now) c.key = now; else missing.push(c.code || c.key.split("/").pop() || c.key);
  }
  if (missing.length) {
    throw new Error(`Нет в твоей Медиатеке: ${[...new Set(missing)].join(", ")}. Файл удалили или переименовали — убери его из адсета и добавь заново из Медиатеки.`);
  }
  const conn = await getConnection(me.id).catch(() => null);
  return buildPlan(input, accounts, conn?.torroBuyerId ?? null);
}

async function lease(id: string): Promise<Job | null> {
  const now = new Date();
  const { data } = await db().from("autoupload_jobs")
    .update({ lease_until: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq("id", id).eq("status", "creating").or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .select("id, user_id, plan, status, state, stage, error").maybeSingle();
  return data as Job | null;
}

export async function runJob(id: string, budgetMs = 240_000): Promise<void> {
  const job = await lease(id);
  if (!job) return;
  const patch: Record<string, unknown> = { lease_until: null };
  try {
    if (await advance(job, Date.now() + budgetMs)) patch.status = "created";
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
    // Временный сбой Meta: до 3 раз подряд — продолжит крон через минуту (у Артёма 10/20/40 с).
    const st = job.state;
    if (e instanceof MetaError && e.transient && st && (st.retries ?? 0) < 3) {
      st.retries = (st.retries ?? 0) + 1;
      patch.state = st;
      patch.stage = `Meta временно не ответила — повторю (${st.retries}/3): ${msg}`;
    } else {
      patch.status = "failed";
      patch.error = msg;
    }
  }
  await db().from("autoupload_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

// Крон раз в минуту: незаконченные задания — дальше.
export async function runOpenJobs(budgetMs: number): Promise<number> {
  const { data } = await db().from("autoupload_jobs").select("id").eq("status", "creating").order("created_at").limit(3);
  const deadline = Date.now() + budgetMs;
  for (const j of data ?? []) {
    const left = deadline - Date.now();
    if (left < 20_000) break;
    await runJob(j.id as string, left - 10_000);
  }
  return data?.length ?? 0;
}

export async function cancelJob(userId: string, id: string): Promise<string[]> {
  const { data } = await db().from("autoupload_jobs").update({ status: "cancelling", stage: "Удаляю созданное" })
    .eq("id", id).eq("user_id", userId).in("status", ["creating", "created", "failed"])
    .select("id, user_id, plan, status, state, stage, error").maybeSingle();
  if (!data) throw new Error("Задание не найдено или уже отменено");
  const errors = await cancelCreated(data as Job);
  await db().from("autoupload_jobs").update({
    status: "cancelled", stage: errors.length ? "Удалено не всё" : "Кампании удалены", error: errors.join("; ") || null, updated_at: new Date().toISOString(),
  }).eq("id", id);
  return errors;
}

export async function listJobs(userId: string) {
  const { data } = await db().from("autoupload_jobs").select("id, status, stage, error, created_at, updated_at, plan, state, actor_id")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
  // Залил джун — его имя у задания: баер и джун видят один список.
  const others = [...new Set((data ?? []).map((j) => j.actor_id as string | null).filter((a): a is string => !!a && a !== userId))];
  const { data: people } = others.length ? await db().from("profiles").select("id, name, email").in("id", others) : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id as string, (p.name as string | null) || (p.email as string)]));
  return (data ?? []).map((j) => {
    const plan = j.plan as Plan;
    const created = ((j.state as { created?: { id?: string; adsets?: { ads?: { id?: string }[] }[] }[] } | null)?.created ?? []);
    return {
      id: j.id as string, status: j.status as string, stage: j.stage as string | null, error: j.error as string | null,
      createdAt: j.created_at as string, summary: plan.summary, names: plan.campaigns.map((c) => c.name),
      by: nameOf.get(j.actor_id as string) ?? null,
      done: {
        campaigns: created.filter((c) => c.id).length,
        ads: created.reduce((s, c) => s + (c.adsets ?? []).reduce((t, a) => t + (a.ads ?? []).filter((x) => x.id).length, 0), 0),
      },
    };
  });
}
