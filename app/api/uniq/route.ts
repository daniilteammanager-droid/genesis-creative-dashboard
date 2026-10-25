import { after, NextResponse } from "next/server";
import { warehouse } from "@/lib/warehouse/read";
import { publicUrl, resultKey, uploadUrl } from "@/lib/uniq/source";
import { renderFailed, replaceInMeta } from "@/lib/uniq/replace";

// Очередь уникализации для воркера на VPS (Decision 076). Сессии нет — как у
// /api/ingest: вход по общему секрету, роут в PUBLIC_PATHS middleware.
//   GET  — взять следующее задание: исходник по ссылке и куда положить результат;
//   POST — {id, stage} ход работы, {id, status: "ready", duration, bytes} готово,
//          {id, status: "failed", error} ошибка. Готовое сразу едет в Meta.

export const maxDuration = 300;

function authorized(req: Request): boolean {
  const expected = process.env.INGEST_SECRET;
  if (!expected || expected.length < 24) return false;
  const given = req.headers.get("x-ingest-secret") ?? "";
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const db = () => warehouse();
const deny = () => NextResponse.json({ error: "Нет доступа" }, { status: 401 });

export async function GET(req: Request) {
  if (!authorized(req)) return deny();
  // Упавший посреди монтажа воркер (рестарт) — задание снова в очереди через час.
  await db().from("video_variant_jobs").update({ status: "queued" }).eq("status", "processing")
    .lt("updated_at", new Date(Date.now() - 3600_000).toISOString());
  const { data: next } = await db().from("video_variant_jobs").select("id").eq("status", "queued").order("created_at").limit(1);
  if (!next?.length) return NextResponse.json({ job: null });
  const { data: j } = await db().from("video_variant_jobs").update({ status: "processing", stage: "Взял в работу", updated_at: new Date().toISOString() })
    .eq("id", next[0].id).eq("status", "queued").select("*").maybeSingle();
  if (!j) return NextResponse.json({ job: null });
  const key = resultKey(j.id);
  return NextResponse.json({ job: {
    id: j.id, name: j.source_name, tailType: j.tail_type, frameType: j.frame_type,
    sourceUrl: publicUrl(j.source_key), uploadUrl: await uploadUrl(key),
  } });
}

export async function POST(req: Request) {
  if (!authorized(req)) return deny();
  const b = (await req.json().catch(() => ({}))) as { id?: string; stage?: string; status?: string; error?: string; duration?: number; bytes?: number };
  if (!b.id) return NextResponse.json({ error: "Нет id" }, { status: 400 });
  const now = new Date().toISOString();
  if (b.status === "failed") {
    await renderFailed(b.id, b.error || "ошибка воркера");
  } else if (b.status === "ready") {
    await db().from("video_variant_jobs").update({
      status: "ready", stage: "Смонтировано", result_key: resultKey(b.id), duration: b.duration ?? null, bytes: b.bytes ?? null, updated_at: now,
    }).eq("id", b.id).eq("status", "processing");
    after(() => replaceInMeta(b.id!));
  } else if (b.stage) {
    await db().from("video_variant_jobs").update({ stage: b.stage.slice(0, 300), updated_at: now }).eq("id", b.id).eq("status", "processing");
  }
  return NextResponse.json({ ok: true });
}
