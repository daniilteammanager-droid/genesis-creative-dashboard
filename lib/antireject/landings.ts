import type { TorroLanding } from "@/lib/torro/mcp";
import { parseName } from "@/lib/creatives/code";

// Какой лендинг подставить вместо отклонённого (Decision 067).
//
// У Артёма воронка угадывалась по зашитым id спотов и по имени кампании. Здесь
// проще и без справочника: находим в Torro лендинг, на который ведёт объявление
// сейчас, и предлагаем лендинги того же спота (та же воронка, тот же канал) на
// другом домене — отклонение часто держится именно за домен.
//
// Не нашли текущий (Torro отдаёт только последние 20 лендингов, а старые
// объявления ведут на ссылки другого вида) — воронка по имени кампании.

export const host = (url: string) => {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
};
const key = (url: string) => {
  try { const u = new URL(url); return `${host(u.href)}${u.pathname.replace(/\/+$/, "")}`; }
  catch { return ""; }
};

export interface LandingChoices {
  current: TorroLanding | null;
  candidates: TorroLanding[];
  reason?: string;     // почему вариантов нет — человеку в чат
}

// ponytail: названия спотов команды словами из их имён; появится новая воронка — сюда строку.
export function spotOfCampaign(campaignName: string): string | null {
  const { face, geo } = parseName(campaignName);
  if (face === "RICKY") return "РИКАРДО";
  // Лица нет в старых РК (до 10.2026) — тогда лилось только на Романа; Рики в имени подписан всегда.
  if (face === "ROMAN" || (!face && geo)) return geo === "ES" ? "ИСПАНИЯ РОМАН" : "ЛАТАМ РОМАН";
  return null;
}

// Тестовые лендинги в выбор не попадают: «Matvey Test» лежит в боевом споте.
const isTest = (l: TorroLanding) => /\b(test|тест)/i.test(l.name);

export function landingChoices(currentUrl: string, landings: TorroLanding[], campaignName = "", limit = 8): LandingChoices {
  const current = landings.find((l) => key(l.url) === key(currentUrl)) ?? null;
  const spotWord = current ? null : spotOfCampaign(campaignName);
  if (!current && !spotWord) return { current, candidates: [], reason: "текущей ссылки нет среди лендингов Torro, а воронку по имени кампании не понять" };
  const sameFunnel = (l: TorroLanding) => current
    ? l.spot === current.spot && (l.theme ?? "") === (current.theme ?? "")
    : (l.spot ?? "").toUpperCase().includes(spotWord!) && (l.theme ?? "telegram") === "telegram";
  const was = host(current?.url ?? currentUrl);
  const candidates = landings
    .filter((l) => l.id !== current?.id && sameFunnel(l) && !isTest(l) && host(l.url) && host(l.url) !== was)
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
  return candidates.length ? { current, candidates }
    : { current, candidates, reason: `в воронке «${current?.spot ?? spotWord}» нет лендингов на другом домене` };
}

// Новая ссылка — путь нового лендинга, а параметры старой: в них id баера,
// пиксель и макросы Meta, терять их нельзя.
export function makeLink(currentUrl: string, landing: TorroLanding): string {
  const old = new URL(currentUrl), next = new URL(landing.url);
  if (!["http:", "https:"].includes(old.protocol) || !["http:", "https:"].includes(next.protocol)) throw new Error("Ссылка должна быть http(s)");
  next.search = old.search;
  next.hash = old.hash;
  return next.href;
}
