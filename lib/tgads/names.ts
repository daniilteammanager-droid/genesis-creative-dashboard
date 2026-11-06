import { parseCreativeCode } from "@/lib/creatives/code";

// Разбор имён TG Ads — без сети, чтобы им пользовался и чистый код отчётов.

// ─── Имя объявления ─────────────────────────────────────────────────────────
// Слова стран — как в боте; PR у Павла — опечатка Перу (Daniil 21.10.2026).
const GEO_WORDS: [string, string][] = [
  ["spain", "ES"], ["argentina", "AR"], ["mexico", "MX"], ["chile", "CL"], ["peru", "PE"], ["ecuador", "EC"],
  ["colombia", "CO"], ["uruguay", "UY"], ["paraguay", "PY"], ["panama", "PA"],
];
const GEO_CODES: Record<string, string> = { ES: "ES", AR: "AR", MX: "MX", CL: "CL", PE: "PE", PR: "PE", EC: "EC", CO: "CO" };

// Кампании на каналы (Павел, 06.11.2026): «Channels» в имени — не страна, а гео «Без гео»,
// как в таблицах; тип канала — Invest / Crypto / Parsing. Страна в имени при этом не считается.
export const NO_GEO = "🌐 Без гео";
const CHANNELS = /\bchannels?\b/i;

export function geoOfTitle(title: string): string | null {
  if (CHANNELS.test(title)) return NO_GEO;
  // Код крео v2 (stat-balance-t4-v1-b9-es-ar): страна — последняя позиция, а не язык.
  const v2 = parseCreativeCode(title.trim().split(/\s+/)[0]);
  if (v2.scheme === "v2" && v2.geo.toUpperCase() in GEO_CODES) return GEO_CODES[v2.geo.toUpperCase()];
  const t = title.toLowerCase();
  const word = GEO_WORDS.find(([w]) => t.includes(w));
  if (word) return word[1];
  const code = title.toUpperCase().split(/[\s_\-|/.,()]+/).find((tok) => tok in GEO_CODES);
  return code ? GEO_CODES[code] : null;
}

// Крео — имя без страны и без «TG Ads»: так его пишет Torro в ad_name.
export function creativeOfTitle(title: string): string {
  // Канальное объявление: крео — всё до «Channels» («Static 6 channels PARSING FOREX» → «Static 6»),
  // после — тип и подтип канала, в Torro их в имени объявления нет.
  const ch = CHANNELS.exec(title);
  let s = (ch ? title.slice(0, ch.index) : title).replace(/\btg[\s_]*ads\b/gi, " ");
  for (const [w] of GEO_WORDS) s = s.replace(new RegExp(`\\b${w}\\b`, "gi"), " ");
  s = s.split(/\s+/).filter((tok) => !(tok.toUpperCase() in GEO_CODES))
    // Код v2 — без страны в конце: Torro пишет «stat-balance-t4-v1-b9-es», объявление «…-es-ar».
    .map((tok) => (parseCreativeCode(tok).scheme === "v2" ? tok.replace(/-[a-z]{2}$/i, "") : tok)).join(" ");
  return s.replace(/\s+/g, " ").trim() || title.trim();
}

// Имя кампании в Torro баер пишет руками, и регистр расходится с объявлением
// («Static 4 Channels» / «Static 4 channels») — доход тогда не клеится. Имя Torro главнее.
export const nameKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
export function torroSpelling(title: string, torroNames: string[] = []): string {
  return torroNames.find((n) => nameKey(n) === nameKey(title))?.trim() ?? title;
}
