import { warehouse } from "@/lib/warehouse/read";
import type { Profile } from "@/lib/auth/types";

// Избранные крео в «Отчётах»: личный список «баер × крео» (traffic_favorites).
// Баер отмечает только свои крео — чужих в его отчёте и нет.

export interface Favorite { buyer: string; creo: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listFavorites(me: Profile): Promise<Favorite[]> {
  const { data, error } = await warehouse().from("traffic_favorites").select("buyer_id, creo").eq("user_id", me.id);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ buyer: r.buyer_id as string, creo: r.creo as string }));
}

export async function setFavorite(me: Profile, buyer: string, creo: string, on: boolean): Promise<void> {
  creo = creo.trim();
  if (!UUID.test(buyer) || !creo || creo.length > 300) throw new Error("Неверное крео");
  if (me.role === "buyer" && buyer !== me.id) throw new Error("Можно отмечать только свои крео");
  const t = warehouse().from("traffic_favorites");
  const { error } = on
    ? await t.upsert({ user_id: me.id, buyer_id: buyer, creo }, { onConflict: "user_id,buyer_id,creo", ignoreDuplicates: true })
    : await t.delete().eq("user_id", me.id).eq("buyer_id", buyer).eq("creo", creo);
  if (error) throw new Error(error.message);
}
