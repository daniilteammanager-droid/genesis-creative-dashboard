import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { warehouse } from "@/lib/warehouse/read";
import { metaTokensOf } from "@/lib/connections/metaKeys";
import { getConnection } from "@/lib/connections/store";
import { listLandings } from "@/lib/torro/mcp";
import { accountPages } from "@/lib/antireject/meta";
import { maySeeKey } from "@/lib/creatives/access";
import type { Profile } from "@/lib/auth/types";

// Что можно выбрать в форме автозалива (Decision 081): свои кабинеты, их пиксели и
// страницы, MVP-лендинги из Torro, свои креативы из библиотеки R2.

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
});

// Кабинеты, закреплённые за мной (Decision 061): заливаю только в свои.
export async function myAccounts(me: Profile): Promise<{ id: string; name: string; status: string }[]> {
  const { data: own } = await warehouse().from("wh_account_owners").select("account_id").eq("owner_user_id", me.id);
  const ids = (own ?? []).map((r) => r.account_id as string);
  if (!ids.length) return [];
  const { data: st } = await warehouse().from("wh_cabinet_states").select("account_id, name, status").in("account_id", ids);
  const by = new Map((st ?? []).map((s) => [s.account_id as string, s]));
  return ids.map((id) => ({ id, name: (by.get(id)?.name as string) || `act_${id}`, status: (by.get(id)?.status as string) || "?" }))
    .sort((a, b) => (a.status === "ACTIVE" ? 0 : 1) - (b.status === "ACTIVE" ? 0 : 1) || a.name.localeCompare(b.name));
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

export async function myLandings(me: Profile): Promise<{ id: number; name: string; url: string }[]> {
  const conn = await getConnection(me.id);
  if (!conn?.torroToken) return [];
  return (await listLandings(conn.torroToken)).filter((l) => /^https:\/\//i.test(l.url ?? "")).map((l) => ({ id: l.id, name: l.name, url: l.url }));
}

// Креативы библиотеки — те, что человеку видно в Медиатеке (Decision 077). По неймингу
// или нет — решает сборка: старое имя уходит в объявление как есть.
export async function myCreatives(me: Profile): Promise<{ key: string; code: string; kind: "video" | "image" }[]> {
  const out: { key: string; code: string; kind: "video" | "image" }[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME, ContinuationToken: token }));
    for (const o of r.Contents ?? []) {
      const key = o.Key ?? "";
      if (/^(thumbnails|variants|originals)\//.test(key) || !maySeeKey(me, key)) continue;
      const m = /\.(mp4|mov|jpg|jpeg|png|webp)$/i.exec(key);
      if (!m) continue;
      const code = (key.split("/").pop() ?? "").replace(/\.[^.]+$/, "").toLowerCase();
      out.push({ key, code, kind: /mp4|mov/i.test(m[1]) ? "video" : "image" });
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out.sort((a, b) => a.code.localeCompare(b.code));
}
