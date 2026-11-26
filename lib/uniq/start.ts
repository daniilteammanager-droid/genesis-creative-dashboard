import { warehouse } from "@/lib/warehouse/read";
import { selfOf, type Profile } from "@/lib/auth/types";
import { myCreatives } from "@/lib/autoupload/options";
import { findSource, originalKey } from "./source";
import { TYPES } from "./bot";

// Запуск уникализации (Decision 076, 083, 091): по отклонённому объявлению, по видео своей Медиатеки (до 30 сразу)
// или повтор упавшего задания. Общий для страницы «Антиотклон» (/api/antireject, op=start) и AI-доступа (lib/mcp/antireject.ts).
// Ошибка — с HTTP-статусом для роута; текст — для человека.

export class UniqError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const db = () => warehouse();

export async function startUniq(me: Profile, b: { adId?: string; key?: string; keys?: string[]; retry?: string; tail?: string; frame?: string }): Promise<string[]> {
  if (!TYPES[b.tail ?? ""] || !TYPES[b.frame ?? ""]) throw new UniqError("Выбери вставку и кадры");
  let rows: Record<string, unknown>[];
  if (b.retry) {
    // Повтор упавшего или отменённого задания из библиотеки — новое задание с тем же исходником.
    const { data: j } = await db().from("video_variant_jobs").select("owner_id, source_key, source_name, ad_id, status").eq("id", b.retry).maybeSingle();
    if (!j || !["failed", "cancelled"].includes(j.status as string) || j.ad_id) throw new UniqError("Повторить можно упавшее или отменённое задание из библиотеки", 400);
    if (j.owner_id !== me.id && me.role !== "main") throw new UniqError("Это не твоё задание", 403);
    rows = [{ owner_id: j.owner_id, source_key: j.source_key, source_name: j.source_name }];
  } else if (b.adId) {
    const { data: ad } = await db().from("wh_rejected_ads").select("ad_id, account_id, ad_name, owner_user_id").eq("ad_id", b.adId).maybeSingle();
    if (!ad) throw new UniqError("Этого объявления нет среди отклонённых", 400);
    const { data: own } = await db().from("wh_account_owners").select("owner_user_id").eq("account_id", ad.account_id).maybeSingle();
    const owner = (own?.owner_user_id ?? ad.owner_user_id) as string | null;
    if (!owner || (owner !== me.id && me.role !== "main")) throw new UniqError("Это не твой кабинет", 403);
    if (String(ad.ad_id).startsWith("tg:")) throw new UniqError("Уникализация — только для Facebook", 400);
    const key = await findSource(String(ad.ad_name ?? ""));
    if (!key) throw new UniqError("Исходник v1 этого креатива не найден в библиотеке", 400);
    const { data: open } = await db().from("video_variant_jobs").select("id").eq("ad_id", ad.ad_id).in("status", ["choosing", "queued", "processing", "ready", "replacing"]).limit(1);
    if (open?.length) throw new UniqError("Для этого объявления уже идёт уникализация", 400);
    rows = [{ ad_id: ad.ad_id, account_id: ad.account_id, owner_id: owner, source_key: key, source_name: key.split("/").pop() }];
  } else {
    // Одно видео (key) или несколько сразу (keys) — по заданию на каждое, с одними настройками.
    const keys = [...new Set(b.keys?.length ? b.keys : b.key ? [b.key] : [])];
    if (!keys.length) throw new UniqError("Выбери видео из своей библиотеки", 400);
    if (keys.length > 30) throw new UniqError("Не больше 30 видео за раз — очередь одна на всю команду", 400);
    const videos = new Map((await myCreatives(me)).filter((x) => x.kind === "video").map((x) => [x.key, x]));
    const foreign = keys.filter((k) => !videos.has(k));
    if (foreign.length) throw new UniqError(`Нет в твоей Медиатеке: ${foreign.map((k) => k.split("/").pop()).join(", ")}`, 400);
    rows = await Promise.all(keys.map(async (k) => ({ owner_id: me.id, source_key: await originalKey(k), source_name: k.split("/").pop() })));
  }
  const { data, error } = await db().from("video_variant_jobs").insert(rows.map((r) => ({ ...r, actor_id: selfOf(me).id, tail_type: b.tail, frame_type: b.frame, status: "queued" }))).select("id");
  if (error) throw new Error(error.message);
  return data.map((d) => d.id as string);
}
