// Naming convention: "{формат}{номер}-{гео}[-{воронка}]", e.g. "balance5-es-tg" —
// гео всегда второй dash-сегмент. Код не распознан → бакет "Без гео" (не догадываемся).
const GEO_NAMES: Record<string, string> = {
  es: "Испания", mx: "Мексика", ar: "Аргентина", co: "Колумбия", de: "Германия",
  fr: "Франция", it: "Италия", pl: "Польша", pt: "Португалия", nl: "Нидерланды",
  no: "Норвегия", be: "Бельгия", cz: "Чехия", hu: "Венгрия", uk: "Великобритания",
  gb: "Великобритания", us: "США", ca: "Канада", ch: "Швейцария", at: "Австрия",
  se: "Швеция", dk: "Дания", fi: "Финляндия", gr: "Греция", ro: "Румыния",
  bg: "Болгария", hr: "Хорватия", si: "Словения", sk: "Словакия", lt: "Литва",
  lv: "Латвия", ee: "Эстония",
};

export const UNKNOWN_GEO = "Без гео";

export function extractGeoName(creativeCode: string): string {
  const raw = (creativeCode.split("-")[1] ?? "").toLowerCase();
  return GEO_NAMES[raw] ?? UNKNOWN_GEO;
}
