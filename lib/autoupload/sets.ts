import type { CampaignRow, SharedAdset } from "./plan";

// Сеты 1-1-1 — как у Артёма (syncOneToOneSets): строка кампании в режиме 1-1-1 — шаблон
// сета, из него раскрывается по кампании на каждый «адсет × креатив» общего набора.
// Кампанию можно убрать из сета (omitted) или поменять ей любое поле (overrides) —
// остальное она берёт у сета, и правка сета до неё доезжает.
// Чистые функции: форма хранит сеты, правки и убранные, сюда — за готовыми строками.

export type SetForm = Omit<CampaignRow, "unit" | "setKey" | "set">;
export type ChildOverride = Partial<Omit<SetForm, "key" | "adsetNames">> & { adsetName?: string };

export const childKey = (setKey: string, adsetId: string, creativeKey: string) => `${setKey}::${adsetId}::${creativeKey}`;

export interface SetChild { key: string; setKey: string; adsetIndex: number; adIndex: number; code: string; row: CampaignRow; overridden: boolean }

export function expandSet(set: SetForm, setNumber: number, adsets: SharedAdset[], omitted: Set<string>, overrides: Record<string, ChildOverride>): SetChild[] {
  const out: SetChild[] = [];
  adsets.forEach((a, ai) => a.creatives.forEach((c, ci) => {
    const key = childKey(set.key, a.id, c.key);
    if (omitted.has(key)) return;
    const { adsetName, ...own } = overrides[key] ?? {};
    out.push({
      key, setKey: set.key, adsetIndex: ai, adIndex: ci, code: c.code, overridden: Boolean(overrides[key]),
      row: {
        ...set, ...own, key, setKey: set.key, set: setNumber,
        startAtByAccount: { ...set.startAtByAccount, ...own.startAtByAccount },
        adsetNames: [adsetName ?? set.adsetNames?.[ai] ?? ""],
        unit: { adset: ai, ad: ci, key: c.key },
      },
    });
  }));
  return out;
}

// Что уйдёт в сборку: в обычном режиме — сами строки, в 1-1-1 — кампании всех сетов.
export function rowsFor(oneToOne: boolean, campaigns: SetForm[], adsets: SharedAdset[], omitted: Set<string>, overrides: Record<string, ChildOverride>): CampaignRow[] {
  if (!oneToOne) return campaigns;
  return campaigns.flatMap((s, i) => expandSet(s, i + 1, adsets, omitted, overrides).map((c) => c.row));
}
