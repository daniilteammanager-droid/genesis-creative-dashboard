import type { CampaignRow, PlanInput, SharedAdset } from "./plan";
import type { Landing } from "./options";
import { landingChoices } from "./landings";

// Сеты 1-1-1 — как у Артёма (syncOneToOneSets): строка кампании в режиме 1-1-1 — шаблон
// сета, из него раскрывается по кампании на каждый «адсет × креатив» общего набора.
// Кампанию можно убрать из сета (omitted) или поменять ей любое поле (overrides) —
// остальное она берёт у сета, и правка сета до неё доезжает.
// Чистые функции: форма хранит сеты, правки и убранные, сюда — за готовыми строками.

export type SetForm = Omit<CampaignRow, "unit" | "setKey" | "set">;
export type ChildOverride = Partial<Omit<SetForm, "key" | "adsetNames" | "adsetBudgets">> & { adsetName?: string; adsetBudget?: string };

export const childKey = (setKey: string, adsetId: string, creativeKey: string) => `${setKey}::${adsetId}::${creativeKey}`;

export interface SetChild { key: string; setKey: string; adsetIndex: number; adIndex: number; code: string; row: CampaignRow; overridden: boolean }

export function expandSet(set: SetForm, setNumber: number, adsets: SharedAdset[], omitted: Set<string>, overrides: Record<string, ChildOverride>): SetChild[] {
  const out: SetChild[] = [];
  adsets.forEach((a, ai) => a.creatives.forEach((c, ci) => {
    const key = childKey(set.key, a.id, c.key);
    if (omitted.has(key)) return;
    const { adsetName, adsetBudget, ...own } = overrides[key] ?? {};
    out.push({
      key, setKey: set.key, adsetIndex: ai, adIndex: ci, code: c.code, overridden: Boolean(overrides[key]),
      row: {
        ...set, ...own, key, setKey: set.key, set: setNumber,
        startAtByAccount: { ...set.startAtByAccount, ...own.startAtByAccount },
        adsetNames: [adsetName ?? set.adsetNames?.[ai] ?? ""],
        adsetBudgets: [adsetBudget ?? set.adsetBudgets?.[ai] ?? ""],
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

// Форма страницы — она же сохранённая сборка (autoupload_drafts.form, Decision 092).
export interface DraftForm {
  accountIds: string[]; pixelId: string; pageId: string; date: string; campaignNumber: number; budget: string;
  oneToOne: boolean; abo: boolean; paused: boolean; campaigns: SetForm[]; adsets: SharedAdset[]; omitted: string[];
  overrides: Record<string, ChildOverride>; text: PlanInput["text"];
}

// Форма → вход плана, как «Проверить сборку» на странице: кабинеты — только живые (alive), строки — rowsFor,
// ссылка MVP по умолчанию — свежая своей серии. Сборки, сохранённые до 1-1-1 и ABO, без этих полей — их значения по умолчанию.
export function draftInput(f: DraftForm, alive: Set<string>, landings: Landing[]): PlanInput {
  const withLanding = (r: CampaignRow): CampaignRow => ({ ...r, landingUrl: r.landingUrl || landingChoices(landings, r.geo, r.actor)[0]?.url || "" });
  return {
    accountIds: f.accountIds.filter((id) => alive.has(id)), pixelId: f.pixelId, pageId: f.pageId, date: f.date, campaignNumber: f.campaignNumber,
    dailyBudgetUsd: f.budget, oneToOne: !!f.oneToOne, abo: !!f.abo, paused: !!f.paused, adsets: f.adsets, text: f.text,
    campaigns: rowsFor(!!f.oneToOne, f.campaigns, f.adsets, new Set(f.omitted ?? []), f.overrides ?? {}).map(withLanding),
  };
}
