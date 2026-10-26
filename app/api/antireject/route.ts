import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { warehouse } from "@/lib/warehouse/read";
import { myCreatives } from "@/lib/autoupload/options";
import { findSource, originalKey, publicUrl } from "@/lib/uniq/source";
import { TYPES } from "@/lib/uniq/bot";

// Страница «Антиотклон» (Decision 083): отклонённые объявления своих кабинетов,
// уникализация по объявлению или из библиотеки, задания с готовыми видео.
// Баер видит своё, владелец и тимлид — всё. Кнопки замены ссылки, ФП и
// Multi-advertiser остаются в боте.
//   GET · POST { op: "start", adId? | key, tail, frame }

const db = () => warehouse();

async function myAccountIds(userId: string): Promise<string[]> {
  const { data } = await db().from("wh_account_owners").select("account_id").eq("owner_user_id", userId);
  return (data ?? []).map((r) => r.account_id as string);
}

export async function GET() {
  const me = await getProfile();
  if (!me || me.status !== "active") return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const all = me.role !== "buyer";
  const mine = all ? null : await myAccountIds(me.id);
  let rq = db().from("wh_rejected_ads").select("ad_id, account_id, ad_name, campaign_name, status, reason, first_seen_at, owner_user_id")
    .not("ad_id", "like", "\\_\\_%").order("first_seen_at", { ascending: false }).limit(200);
  if (mine) rq = rq.or(`account_id.in.(${mine.join(",") || "0"}),owner_user_id.eq.${me.id}`);
  let jq = db().from("video_variant_jobs").select("id, ad_id, source_name, tail_type, frame_type, status, stage, error, result_key, duration, created_at")
    .order("created_at", { ascending: false }).limit(30);
  if (!all) jq = jq.eq("owner_id", me.id);
  const [{ data: rejected }, { data: jobs }, videos] = await Promise.all([rq, jq, myCreatives(me).then((c) => c.filter((x) => x.kind === "video"))]);
  return NextResponse.json({
    rejected: rejected ?? [], types: TYPES, videos,
    jobs: (jobs ?? []).map((j) => ({ ...j, url: j.result_key && ["done", "failed"].includes(j.status as string) ? publicUrl(j.result_key as string) : null })),
  });
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || me.status !== "active") return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { op?: string; adId?: string; key?: string; tail?: string; frame?: string };
  if (b.op !== "start" || !TYPES[b.tail ?? ""] || !TYPES[b.frame ?? ""]) return NextResponse.json({ error: "Выбери вставку и кадры" }, { status: 400 });
  let row: Record<string, unknown>;
  if (b.adId) {
    const { data: ad } = await db().from("wh_rejected_ads").select("ad_id, account_id, ad_name, owner_user_id").eq("ad_id", b.adId).maybeSingle();
    if (!ad) return NextResponse.json({ error: "Этого объявления нет среди отклонённых" }, { status: 400 });
    const { data: own } = await db().from("wh_account_owners").select("owner_user_id").eq("account_id", ad.account_id).maybeSingle();
    const owner = (own?.owner_user_id ?? ad.owner_user_id) as string | null;
    if (!owner || (owner !== me.id && me.role !== "main")) return NextResponse.json({ error: "Это не твой кабинет" }, { status: 403 });
    if (String(ad.ad_id).startsWith("tg:")) return NextResponse.json({ error: "Уникализация — только для Facebook" }, { status: 400 });
    const key = await findSource(String(ad.ad_name ?? ""));
    if (!key) return NextResponse.json({ error: "Исходник v1 этого креатива не найден в библиотеке" }, { status: 400 });
    const { data: open } = await db().from("video_variant_jobs").select("id").eq("ad_id", ad.ad_id).in("status", ["choosing", "queued", "processing", "ready", "replacing"]).limit(1);
    if (open?.length) return NextResponse.json({ error: "Для этого объявления уже идёт уникализация" }, { status: 400 });
    row = { ad_id: ad.ad_id, account_id: ad.account_id, owner_id: owner, source_key: key, source_name: key.split("/").pop() };
  } else {
    const videos = await myCreatives(me);
    const v = videos.find((x) => x.key === b.key && x.kind === "video");
    if (!v) return NextResponse.json({ error: "Выбери видео из своей библиотеки" }, { status: 400 });
    row = { owner_id: me.id, source_key: await originalKey(v.key), source_name: v.key.split("/").pop() };
  }
  const { data, error } = await db().from("video_variant_jobs").insert({ ...row, tail_type: b.tail, frame_type: b.frame, status: "queued" }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
