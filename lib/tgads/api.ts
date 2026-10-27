import { mskDay } from "@/lib/day";
import { usdRate } from "@/lib/fx";
import type { DolphinAdDay } from "@/lib/dolphin/api";

// Telegram Ads как источник расхода (Decision 068).
//
// Правила метрик — из бота-авточекера (Hetzner, tg_ads.py, порт из архива Павла):
//   - расход — все объявления, включая остановленные, за московские сутки, по
//     5-минутным блокам: дневные интервалы Telegram отдаёт по UTC;
//   - деньги — в валюте кабинета (у нас TON), в доллары по курсу Coinbase;
//   - страна — по явному названию страны или коду в имени объявления.
//
// В склад TG-объявление ложится и кампанией, и объявлением сразу: в Torro имя
// кампании TG Ads — ровно имя объявления («Static 2 Mexico»), а имя объявления —
// крео без страны («Static 2»).

const BASE = "https://promoteapi.telegram.org";
const BLOCK = 300;                    // 5 минут
const MAX_BLOCKS = 1000;              // потолок getAdStats за запрос

async function call<T>(token: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(30_000),
    }).catch((e) => { throw new Error(`Telegram Ads недоступен: ${e instanceof Error ? e.message : e}`); });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 3) * 1000));
      continue;
    }
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; error?: string } | null;
    // Лимит частоты Telegram отдаёт не 429, а ошибкой FLOOD_WAIT_<секунды> (замер 24.10.2026).
    const flood = /^FLOOD_WAIT_(\d+)$/.exec(body?.error ?? "");
    if (flood && attempt < 5) {
      await new Promise((r) => setTimeout(r, (Number(flood[1]) + 1) * 1000));
      continue;
    }
    if (!body?.ok) {
      if (/TOKEN|UNAUTHORIZED|ACCESS/i.test(body?.error ?? "") || res.status === 401) throw new Error("Telegram Ads не принял ключ");
      throw new Error(`Telegram Ads ${method}: ${body?.error ?? `HTTP ${res.status}`}`);
    }
    return body.result as T;
  }
}

export interface TgAccount { account_id: string; title: string; currency: string; spent_budget: number; remaining_budget: number }
export interface TgAd {
  ad_id: number; title: string; status: string; is_paused?: boolean; created_date: number;
  daily_budget_limit?: number; currency?: string; promote_url?: string;
  decline_reason?: { text?: string };
}

export const currentAccount = (token: string) => call<TgAccount>(token, "getCurrentAccount");

export async function listAds(token: string): Promise<TgAd[]> {
  const out: TgAd[] = [];
  let offset: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = await call<{ ads: TgAd[]; next_offset?: string }>(token, "getAdsList", { limit: 100, ...(offset ? { offset } : {}) });
    out.push(...page.ads);
    if (!page.next_offset) break;
    offset = page.next_offset;
  }
  return out;
}

// Курс — общий (lib/fx.ts): свой день — свой курс.
export const tonUsd = (day: string) => usdRate("TON", day);

// ─── Имя объявления ─────────────────────────────────────────────────────────
// Слова стран — как в боте; PR у Павла — опечатка Перу (Daniil 21.10.2026).
const GEO_WORDS: [string, string][] = [
  ["spain", "ES"], ["argentina", "AR"], ["mexico", "MX"], ["chile", "CL"], ["peru", "PE"], ["ecuador", "EC"],
  ["colombia", "CO"], ["uruguay", "UY"], ["paraguay", "PY"], ["panama", "PA"],
];
const GEO_CODES: Record<string, string> = { ES: "ES", AR: "AR", MX: "MX", CL: "CL", PE: "PE", PR: "PE", EC: "EC", CO: "CO" };

export function geoOfTitle(title: string): string | null {
  const t = title.toLowerCase();
  const word = GEO_WORDS.find(([w]) => t.includes(w));
  if (word) return word[1];
  const code = title.toUpperCase().split(/[\s_\-|/.,()]+/).find((tok) => tok in GEO_CODES);
  return code ? GEO_CODES[code] : null;
}

// Крео — имя без страны и без «TG Ads»: так его пишет Torro в ad_name.
export function creativeOfTitle(title: string): string {
  let s = title.replace(/\btg[\s_]*ads\b/gi, " ");
  for (const [w] of GEO_WORDS) s = s.replace(new RegExp(`\\b${w}\\b`, "gi"), " ");
  s = s.split(/\s+/).filter((tok) => !(tok.toUpperCase() in GEO_CODES)).join(" ");
  return s.replace(/\s+/g, " ").trim() || title.trim();
}

// ─── Расход по дням ─────────────────────────────────────────────────────────

interface StatItem { from_time: number; spent_budget?: number; views?: number; clicks?: number; actions?: number }

const mskMidnight = (day: string) => Math.floor(Date.parse(`${day}T00:00:00+03:00`) / 1000);
const nextDay = (day: string) => mskDay(new Date((mskMidnight(day) + 36 * 3600) * 1000));

// 5-минутные блоки одного объявления за [since, until] по МСК, сложенные в дни.
async function adDays(token: string, adId: number, since: string, until: string) {
  const start = mskMidnight(since);
  // Текущий неполный блок включаем, как бот: иначе «сегодня» отстаёт на 5 минут.
  const end = Math.min(mskMidnight(nextDay(until)), (Math.floor(Date.now() / 1000 / BLOCK) + 1) * BLOCK);
  const days = new Map<string, { spend: number; views: number; clicks: number }>();
  for (let from = start; from < end; from += BLOCK * MAX_BLOCKS) {
    const to = Math.min(end, from + BLOCK * MAX_BLOCKS);
    for (const s of await call<StatItem[]>(token, "getAdStats", { ad_id: adId, from_time: from, to_time: to, interval: BLOCK })) {
      const spend = Number(s.spent_budget) || 0, views = Number(s.views) || 0;
      if (!spend && !views) continue;
      const day = mskDay(new Date(s.from_time * 1000));
      const d = days.get(day) ?? { spend: 0, views: 0, clicks: 0 };
      d.spend += spend; d.views += views; d.clicks += Number(s.clicks) || 0;
      days.set(day, d);
    }
  }
  return days;
}

// По четыре объявления за раз — как у бота: у кабинета десятки объявлений.
async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

export const tgId = (accountId: string, adId: number) => `tg:${accountId}:${adId}`;

// Строки склада в той же форме, что у Dolphin: кампания = адсет = объявление.
export async function tgadsAdDays(key: { token: string; accountId: string; accountTitle: string }, since: string, until: string): Promise<DolphinAdDay[]> {
  const ads = (await listAds(key.token)).filter((a) => mskDay(new Date(a.created_date * 1000)) <= until);
  const perAd = await mapLimit(ads, 4, (a) => adDays(key.token, a.ad_id, since, until));
  const out: DolphinAdDay[] = [];
  for (const [i, a] of ads.entries()) {
    const id = tgId(key.accountId, a.ad_id);
    const geo = geoOfTitle(a.title);
    const live = a.status === "active" && !a.is_paused;
    for (const [day, d] of perAd[i]) {
      const rate = await tonUsd(day);
      out.push({
        date: day, adId: id, adName: creativeOfTitle(a.title),
        adsetId: id, adsetName: a.title, campaignId: id, campaignName: a.title,
        accountId: key.accountId, accountName: key.accountTitle,
        spend: Math.round(d.spend * rate * 100) / 100, clicks: d.clicks, impressions: d.views,
        // Клик в TG Ads — это и есть переход по ссылке; охвата и результатов API не отдаёт.
        linkClicks: d.clicks, reach: null, results: null,
        campaignDailyBudget: live && a.daily_budget_limit ? Math.round(a.daily_budget_limit * rate * 100) / 100 : null,
        countries: geo ? [geo] : [],
      });
    }
  }
  return out;
}

// Самое старое объявление кабинета — раньше истории нет.
export async function oldestAdDay(token: string): Promise<string | null> {
  const ads = await listAds(token);
  return ads.length ? mskDay(new Date(Math.min(...ads.map((a) => a.created_date)) * 1000)) : null;
}
