import { warehouse } from "@/lib/warehouse/read";
import { resolveScope } from "@/lib/warehouse/accounts";
import type { Profile } from "@/lib/auth/types";
import { ToolError } from "./protocol";

// Параметр buyer у инструментов чтения (tools.ts, rejects.ts) — отдельно, чтобы файлы инструментов не импортировали друг друга.

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// buyer для владельца и тимлида: id, имя, код (b1) или почта. Баеру — всегда он сам.
export async function pickBuyer(me: Profile, v: unknown): Promise<{ id?: string; label: string }> {
  if (me.role === "buyer") return { id: undefined, label: me.name || me.buyer_code || me.email };
  const want = str(v).toLowerCase();
  if (!want) return { id: undefined, label: "вся команда" };
  const db = warehouse();
  const { buyers } = await resolveScope(db, me);
  const { data } = await db.from("profiles").select("id, name, email, buyer_code").in("id", buyers.map((b) => b.id));
  const hit = (data ?? []).find((p) => [p.id, p.name, p.email, p.buyer_code].some((x) => typeof x === "string" && x.toLowerCase() === want));
  if (!hit) throw new ToolError(`Баер «${str(v)}» не найден. Есть: ${buyers.map((b) => b.label).join(", ")}`);
  return { id: hit.id as string, label: buyers.find((b) => b.id === hit.id)?.label ?? want };
}

// Кабинет по запросу человека: id, act_<id> или CAB и последние 4 цифры, как в имени кампании (CAB0956). Пусто — любой.
export function accountMatches(id: string, q: string): boolean {
  const v = q.trim().toLowerCase().replace(/^act_/, "");
  return !v || id === v || (/^cab\d{4}$/.test(v) && id.endsWith(v.slice(3)));
}

// BM по запросу: id или часть имени без учёта регистра. Пусто — любой; BM не знаем — не подходит.
export function bmMatches(bm: { id: string | null; name: string | null }, q: string): boolean {
  const v = q.trim().toLowerCase();
  return !v || bm.id === v || (!!bm.name && bm.name.toLowerCase().includes(v));
}
