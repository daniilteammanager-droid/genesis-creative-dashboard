import { warehouse } from "@/lib/warehouse/read";

// Лицо файла в Медиатеке (Decision 086): ставит тот, кто загружает. Хранится по ключу
// R2 в media_faces; переименование и удаление ведут строку за файлом.

export const FACES = ["ROMAN", "RICKY"] as const;
export type Face = (typeof FACES)[number];
export const isFace = (v: unknown): v is Face => FACES.includes(v as Face);

const db = () => warehouse().from("media_faces");

export async function setFace(key: string, face: Face, userId: string): Promise<void> {
  const { error } = await db().upsert({ object_key: key, face, set_by: userId, set_at: new Date().toISOString() });
  if (error) throw new Error(`media_faces: ${error.message}`);
}

export async function facesOf(keys: string[]): Promise<Map<string, Face>> {
  const out = new Map<string, Face>();
  for (let i = 0; i < keys.length; i += 500) {
    const { data } = await db().select("object_key, face").in("object_key", keys.slice(i, i + 500));
    for (const r of data ?? []) out.set(r.object_key as string, r.face as Face);
  }
  return out;
}

export async function moveFace(from: string, to: string): Promise<void> {
  await db().update({ object_key: to }).eq("object_key", from);
}

export async function dropFace(key: string): Promise<void> {
  await db().delete().eq("object_key", key);
}
