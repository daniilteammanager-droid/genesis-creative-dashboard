// Подсветка ячеек (Daniil 26.10.2026): мягкий фон ячейки, а не светящийся текст.
//   ROMI — 130% и выше зелёный, 100–129% жёлтый, 100% и ниже красный;
//   цена подписки и диалога — к цели из листа «Настройки»: не дороже цели зелёный,
//   до +20% к цели жёлтый, дороже красный.
// Общие пороги для всех таблиц — меняются здесь.

export type Tone = "good" | "warn" | "bad" | null;

export function romiTone(romi: number | null): Tone {
  if (romi === null) return null;
  return romi >= 1.3 ? "good" : romi > 1.0 ? "warn" : "bad";
}

export function costTone(cost: number | null, goal: number | null): Tone {
  if (cost === null || goal === null || goal <= 0) return null;
  return cost <= goal ? "good" : cost <= goal * 1.2 + 1e-9 ? "warn" : "bad";
}

export const TONE_CLASS: Record<Exclude<Tone, null>, string> = {
  good: "bg-green-500/10 text-green-300",
  warn: "bg-amber-500/10 text-amber-200",
  bad: "bg-red-500/10 text-red-300",
};
export const toneClass = (t: Tone) => (t ? TONE_CLASS[t] : "");
