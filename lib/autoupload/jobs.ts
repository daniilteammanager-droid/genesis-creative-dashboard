import { warehouse } from "@/lib/warehouse/read";
import { advance, cancelCreated, type Job } from "./launch";
import type { Plan } from "./plan";

// Очередь автозалива (Decision 081). Проход берёт задание арендой: пока аренда не
// истекла, второй проход его не тронет — иначе одна кампания создалась бы дважды.

const db = () => warehouse();
const LEASE_MS = 290_000;

export async function createJob(userId: string, plan: Plan): Promise<string> {
  const { data, error } = await db().from("autoupload_jobs").insert({ user_id: userId, plan, stage: "В очереди" }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
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
    patch.status = "failed";
    patch.error = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
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
  const { data } = await db().from("autoupload_jobs").select("id, status, stage, error, created_at, updated_at, plan, state")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
  return (data ?? []).map((j) => {
    const plan = j.plan as Plan;
    const created = ((j.state as { created?: { id?: string; adsets?: { ads?: { id?: string }[] }[] }[] } | null)?.created ?? []);
    return {
      id: j.id as string, status: j.status as string, stage: j.stage as string | null, error: j.error as string | null,
      createdAt: j.created_at as string, summary: plan.summary, names: plan.campaigns.map((c) => c.name),
      done: {
        campaigns: created.filter((c) => c.id).length,
        ads: created.reduce((s, c) => s + (c.adsets ?? []).reduce((t, a) => t + (a.ads ?? []).filter((x) => x.id).length, 0), 0),
      },
    };
  });
}
