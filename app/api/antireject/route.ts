import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { warehouse } from "@/lib/warehouse/read";
import { myCreatives } from "@/lib/autoupload/options";
import { downloadUrl, findSource, originalKey, publicUrl } from "@/lib/uniq/source";
import { TYPES } from "@/lib/uniq/bot";
import { confirm, options, preview, scanTokens, type Kind } from "@/lib/antireject/web";
import { checkRejectedAds } from "@/lib/alerts/rejected";
import { myLandings } from "@/lib/autoupload/options";

// Страница «Антиотклон» (Decision 083): отклонённые объявления своих кабинетов,
// уникализация по объявлению или из библиотеки, задания с готовыми видео.
// Баер видит своё, владелец и тимлид — всё. Замена ссылки, ФП и Multi-advertiser — и в
// боте, и здесь (Decision 091), история событий, лендинги Torro, «Проверить сейчас».
//   GET · POST { op: "start", adId? | key, tail, frame }
//        · { op: "options", adId, kind } · { op: "preview", adId, kind, value } · { op: "confirm", nonce } · { op: "scan" }

export const maxDuration = 300;
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
  let eq = db().from("antireject_events").select("id, created_at, kind, ad_id, ad_name, campaign_name, actor, text, ok, status")
    .order("created_at", { ascending: false }).limit(50);
  if (mine) eq = eq.or(`account_id.in.(${mine.join(",") || "0"}),owner_user_id.eq.${me.id}`);
  const [{ data: rejected }, { data: jobs }, videos, { data: events }, landings, { data: lastRun }, { data: queue }, { count: busy }] = await Promise.all([
    rq, jq, myCreatives(me).then((c) => c.filter((x) => x.kind === "video").map((x) => ({ ...x, url: publicUrl(x.key) }))), eq,
    myLandings(me).catch(() => []),
    db().from("wh_ingest_runs").select("finished_at").eq("kind", "today").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1),
    db().from("video_variant_jobs").select("id").eq("status", "queued").order("created_at").limit(200),
    db().from("video_variant_jobs").select("id", { count: "exact", head: true }).eq("status", "processing"),
  ]);
  return NextResponse.json({
    rejected: rejected ?? [], types: TYPES, videos, events: events ?? [],
    landings: landings.slice(0, 10), checkedAt: lastRun?.[0]?.finished_at ?? null,
    jobs: await Promise.all((jobs ?? []).map(async (j) => ({
      ...j,
      url: j.result_key && ["done", "failed"].includes(j.status as string) ? await downloadUrl(j.result_key as string, j.source_name as string) : null,
      link: j.result_key && ["done", "failed"].includes(j.status as string) ? publicUrl(j.result_key as string) : null,   // «Копировать ссылку» — постоянная
      // Очередь общая на всю команду, воркер один: место считается с тем, что сейчас монтируется.
      queue: j.status === "queued" ? (queue ?? []).findIndex((q) => q.id === j.id) + 1 + (busy ?? 0) : null,
    }))),
  });
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || me.status !== "active") return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { op?: string; adId?: string; key?: string; tail?: string; frame?: string; kind?: string; value?: string; nonce?: string; retry?: string; id?: string };
  const KINDS = ["link", "page", "multi"];
  try {
    if (b.op === "options" && b.adId && KINDS.includes(b.kind ?? "")) return NextResponse.json(await options(me, b.adId, b.kind as Kind));
    if (b.op === "preview" && b.adId && KINDS.includes(b.kind ?? "") && b.value) return NextResponse.json(await preview(me, b.adId, b.kind as Kind, b.value));
    if (b.op === "confirm" && b.nonce) return NextResponse.json(await confirm(me, b.nonce));
    if (b.op === "scan") {
      const tokens = await scanTokens(me);
      const r = await checkRejectedAds(tokens);
      return NextResponse.json({ accounts: tokens.size, rejected: r.rejected, fresh: r.fresh, failedAccounts: r.failedAccounts });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  // «Отменить» уникализацию: из очереди — сразу; в монтаже — воркер бросит её на ближайшем пульсе (до минуты).
  if (b.op === "cancel" && b.id) {
    const { data: j } = await db().from("video_variant_jobs").select("owner_id").eq("id", b.id).maybeSingle();
    if (!j) return NextResponse.json({ error: "Задание не найдено" }, { status: 404 });
    if (j.owner_id !== me.id && me.role !== "main") return NextResponse.json({ error: "Это не твоё задание" }, { status: 403 });
    const { data } = await db().from("video_variant_jobs").update({ status: "cancelled", stage: "Отменено", updated_at: new Date().toISOString() })
      .eq("id", b.id).in("status", ["choosing", "queued", "processing"]).select("id");
    if (!data?.length) return NextResponse.json({ error: "Это задание уже не отменить — оно смонтировано или закончено" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (b.op !== "start" || !TYPES[b.tail ?? ""] || !TYPES[b.frame ?? ""]) return NextResponse.json({ error: "Выбери вставку и кадры" }, { status: 400 });
  let row: Record<string, unknown>;
  if (b.retry) {
    // Повтор упавшего или отменённого задания из библиотеки — новое задание с тем же исходником.
    const { data: j } = await db().from("video_variant_jobs").select("owner_id, source_key, source_name, ad_id, status").eq("id", b.retry).maybeSingle();
    if (!j || !["failed", "cancelled"].includes(j.status as string) || j.ad_id) return NextResponse.json({ error: "Повторить можно упавшее или отменённое задание из библиотеки" }, { status: 400 });
    if (j.owner_id !== me.id && me.role !== "main") return NextResponse.json({ error: "Это не твоё задание" }, { status: 403 });
    row = { owner_id: j.owner_id, source_key: j.source_key, source_name: j.source_name };
  } else if (b.adId) {
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
