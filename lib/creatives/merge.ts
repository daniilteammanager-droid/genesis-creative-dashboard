import type { CreativeRow } from "@/lib/warehouse/creatives";
import type { Quals } from "@/lib/warehouse/reportTree";

// Склейка версий креатива (v1, v2, v3…) в одну строку — как «Дашборд» у Артёма:
// весь расход и результат по коду, все версии и кабинеты вместе. Чистая функция.

export const versionKey = (code: string) => code.replace(/-v\d+(?=-)/i, "-v*");
const add = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);
const addQuals = (a: Quals | null, b: Quals | null): Quals | null =>
  !a ? b : !b ? a : (a.map((v, i) => v + b[i]) as Quals);
const union = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort();

// Код без версии и без гео залива: «vid-storytell-t30-v9-b3-es-ar» → «vid-storytell-t30-v*-b3-es».
// Так склеивает «Дашборд» Артёма: все версии и все GEO одного креатива — одна строка.
export const baseKey = (code: string) => versionKey(code).replace(/^(.+-b\d+-[a-z]{2,3})-[a-z]{2,3}$/i, "$1").replace(/^(?!.*-b\d+-)(.+)-(?:es|ar|mx|cl|pe|co|ec|py|uy|pa)$/i, "$1");

export type Merged = CreativeRow & { versions: number; details: CreativeRow[] };

export function mergeVersions(rows: CreativeRow[], keyOf: (code: string) => string = versionKey): Merged[] {
  const by = new Map<string, Merged>();
  for (const r of rows) {
    const key = keyOf(r.code);
    const cur = by.get(key);
    if (!cur) { by.set(key, { ...r, code: key, versions: 1, details: [r] }); continue; }
    by.set(key, {
      ...cur, versions: cur.versions + 1, details: [...cur.details, r],
      spend: cur.spend + r.spend, clicks: cur.clicks + r.clicks, impressions: cur.impressions + r.impressions,
      adCount: cur.adCount + r.adCount, campaigns: cur.campaigns + r.campaigns,
      crmClicks: add(cur.crmClicks, r.crmClicks), subscribers: add(cur.subscribers, r.subscribers),
      dialogs: add(cur.dialogs, r.dialogs), registrations: add(cur.registrations, r.registrations),
      depCount: add(cur.depCount, r.depCount), depSum: add(cur.depSum, r.depSum),
      redepCount: add(cur.redepCount, r.redepCount), redepSum: add(cur.redepSum, r.redepSum),
      quals: addQuals(cur.quals, r.quals),
      countries: union(cur.countries, r.countries), faces: union(cur.faces, r.faces), owners: union(cur.owners, r.owners),
      geoMismatch: cur.geoMismatch || r.geoMismatch,
    });
  }
  return [...by.values()].sort((a, b) => b.spend - a.spend);
}

// CSV для Excel/Google Sheets: «;» и BOM — иначе русский Excel ломает кириллицу и колонки.
export function toCsv(rows: string[][]): string {
  const cell = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\n");
}
