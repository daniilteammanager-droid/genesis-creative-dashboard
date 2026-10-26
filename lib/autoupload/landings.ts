import type { Landing } from "./options";

// Ссылки MVP для кампании — как у Артёма: серия по лицу и GEO (Рики — свой спот,
// Роман: ESP — Испания, остальные — Латам), последние пять, по умолчанию — свежая.
export function landingChoices(all: Landing[], geo: string, actor: string): Landing[] {
  const series = actor === "RICKY" ? "riki" : geo === "ESP" ? "spain" : "latam";
  return all.filter((l) => l.series === series).slice(0, 5);
}
