import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { warehouse } from "@/lib/warehouse/read";
import { metaTokensOf } from "@/lib/connections/metaKeys";
import { getConnection } from "@/lib/connections/store";
import { callTool, listLandings } from "@/lib/torro/mcp";
import { accountPages } from "@/lib/antireject/meta";
import { mayManageKey } from "@/lib/creatives/access";
import { parseCreativeCode } from "@/lib/creatives/code";
import { accountsOf, toState } from "@/lib/alerts/cabinets";
import { facesOf, type Face } from "@/lib/creatives/faces";
import type { Profile } from "@/lib/auth/types";

// Что можно выбрать в форме автозалива (Decision 081): свои кабинеты, их пиксели и
// страницы, MVP-лендинги из Torro, свои креативы из библиотеки R2.

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
});

// Кабинеты, закреплённые за мной (Decision 061): заливаю только в свои. Как у Артёма —
// только живые: ACTIVE без ограничения Meta. Бан, unsettled, пропавшие не показываются.
// live — статусы прямо из Meta своими ключами («Обновить кабинеты»), иначе — с последнего
// прогона склада (до 15 минут). В склад live не пишет: смену статуса ловят алерты.
export async function myAccounts(me: Profile, live = false): Promise<{ id: string; name: string; status: string; timezone: string | null }[]> {
  const { data: own } = await warehouse().from("wh_account_owners").select("account_id").eq("owner_user_id", me.id);
  const ids = (own ?? []).map((r) => r.account_id as string);
  if (!ids.length) return [];
  const by = new Map<string, { name: string | null; status: string; disableReason: number | null; timezone?: string | null }>();
  if (live) {
    let read = 0;
    for (const { token } of await metaTokensOf(me.id)) {
      const list = await accountsOf(token, true).catch(() => null);
      if (!list) continue;
      read++;
      for (const a of list) {
        const s = toState(a);
        if (!by.has(s.accountId) || s.status === "ACTIVE") by.set(s.accountId, s);
      }
    }
    if (!read) throw new Error("Meta не ответила ни одним ключом — статусы не обновлены");
  } else {
    const { data: st } = await warehouse().from("wh_cabinet_states").select("account_id, name, status, disable_reason, timezone").in("account_id", ids);
    for (const s of st ?? []) by.set(s.account_id as string, { name: s.name, status: s.status, disableReason: s.disable_reason, timezone: s.timezone });
  }
  return ids.flatMap((id) => {
    const s = by.get(id);
    return s && s.status === "ACTIVE" && !s.disableReason ? [{ id, name: s.name || `act_${id}`, status: s.status, timezone: s.timezone ?? null }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function writerToken(userId: string): Promise<string | null> {
  return (await metaTokensOf(userId)).find((k) => k.canWrite)?.token ?? null;
}

export async function accountDetails(me: Profile, accountId: string) {
  if (!(await myAccounts(me)).some((a) => a.id === accountId)) throw new Error("Это не твой кабинет");
  const token = await writerToken(me.id);
  if (!token) throw new Error("Нужен ключ Meta с правом ads_management — Настройки → Интеграции");
  const res = await fetch(`https://graph.facebook.com/v26.0/act_${accountId}/adspixels?fields=id,name&limit=100&access_token=${token}`, { signal: AbortSignal.timeout(30_000) });
  const px = (await res.json().catch(() => ({}))) as { data?: { id: string; name: string }[]; error?: { message?: string } };
  if (px.error) throw new Error(`Meta: ${px.error.message}`);
  return { pixels: px.data ?? [], pages: await accountPages(token, accountId) };
}

// Серия лендинга — по споту Torro, как у Артёма (torro-identities.cjs): Испания и Латам —
// Роман, Рики — свой спот. Ссылка кампании выбирается из последних пяти своей серии.
const SPOT_SERIES: Record<number, "spain" | "latam" | "riki"> = { 9796: "spain", 14036: "latam", 14753: "riki" };
export type Landing = { id: number; name: string; url: string; series: "spain" | "latam" | "riki" | null };

export async function myLandings(me: Profile): Promise<Landing[]> {
  const conn = await getConnection(me.id);
  if (!conn?.torroToken) return [];
  const [rows, spots] = await Promise.all([
    listLandings(conn.torroToken),
    callTool<{ id: number; title: string }[]>(conn.torroToken, "get_spots", {}).catch(() => []),
  ]);
  const spotId = new Map((Array.isArray(spots) ? spots : []).map((s) => [s.title.trim(), s.id]));
  return rows.filter((l) => /^https:\/\//i.test(l.url ?? ""))
    .map((l) => ({ id: l.id, name: l.name, url: l.url, series: SPOT_SERIES[spotId.get((l.spot ?? "").trim()) ?? 0] ?? null }))
    .sort((a, b) => b.id - a.id);
}

export interface LibraryItem {
  key: string; code: string; kind: "video" | "image";
  approach: string; version: string; bytes: number; uploadedAt: string; thumb: string | null;
  face: Face | null;          // Роман / Рики — ставится при загрузке (Decision 086)
}

// Креативы — только те, что человек сам загрузил в Медиатеку, легаси-библиотеки здесь нет.
// У баера это его папка bN/ (её задаёт сервер при загрузке, Decision 077), у владельца и
// тимлида папки нет — их загрузки по creative_uploads. Как в библиотеке Артёма: вкладки по
// лицу, внутри папки «подход → версия» (подход и версия — из кода). Старое имя — «Без подхода» / «Без версии».
export async function myCreatives(me: Profile): Promise<LibraryItem[]> {
  let mine: (key: string) => boolean;
  if (me.role === "buyer") mine = (key) => mayManageKey(me, key);
  else {
    const { data } = await warehouse().from("creative_uploads").select("object_key").eq("user_id", me.id);
    const keys = new Set((data ?? []).map((r) => r.object_key as string));
    mine = (key) => keys.has(key);
  }
  const out: LibraryItem[] = [];
  const thumbs = new Map<string, string>();
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME, ContinuationToken: token }));
    for (const o of r.Contents ?? []) {
      const key = o.Key ?? "";
      if (key.startsWith("thumbnails/")) { thumbs.set(baseName(key), key); continue; }
      if (/^(variants|originals)\//.test(key) || !mine(key)) continue;
      const m = /\.(mp4|mov|jpg|jpeg|png|webp)$/i.exec(key);
      if (!m) continue;
      const code = baseName(key);
      const parsed = parseCreativeCode(code);
      out.push({
        key, code, kind: /mp4|mov/i.test(m[1]) ? "video" : "image",
        approach: parsed.scheme === "v2" ? parsed.approach : "",
        version: parsed.scheme === "v2" ? `v${parsed.version}` : (/(?:^|-)(v\d+)(?:-|$)/.exec(code)?.[1] ?? ""),
        bytes: o.Size ?? 0, uploadedAt: o.LastModified?.toISOString() ?? "", thumb: null, face: null,
      });
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  const pub = process.env.R2_PUBLIC_URL;
  const faces = await facesOf(out.map((c) => c.key));
  for (const c of out) {
    c.face = faces.get(c.key) ?? null;
    const t = c.kind === "image" ? c.key : thumbs.get(c.code);
    c.thumb = t ? `${pub}/${t}` : null;
  }
  // Свежие сверху — как у Артёма.
  return out.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

const baseName = (key: string) => (key.split("/").pop() ?? "").replace(/\.[^.]+$/, "").toLowerCase();
