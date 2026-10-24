import { mskDay } from "@/lib/day";

// Курс валюты к доллару на день — склад хранит расход в долларах.
//
// Свой день — свой курс: Coinbase отдаёт и исторический (?date=), сегодня — текущий
// (кэш на 10 минут). TON у Telegram Ads (Decision 068), EUR у кабинетов FB Tool
// (Decision 071). Доллар — без запроса.
const rates = new Map<string, Promise<number>>();

export function usdRate(currency: string, day: string): Promise<number> {
  const cur = currency.toUpperCase();
  if (cur === "USD") return Promise.resolve(1);
  const today = day === mskDay();
  const key = `${cur}|${today ? `now|${Math.floor(Date.now() / 600_000)}` : day}`;
  if (!rates.has(key)) {
    rates.set(key, (async () => {
      const res = await fetch(`https://api.coinbase.com/v2/prices/${cur}-USD/spot${today ? "" : `?date=${day}`}`,
        { headers: { "User-Agent": "curl/8.5.0" }, signal: AbortSignal.timeout(20_000) });
      const d = ((await res.json().catch(() => null)) as { data?: { base?: string; currency?: string; amount?: string } } | null)?.data;
      const v = Number(d?.amount);
      if (d?.base !== cur || d?.currency !== "USD" || !(v > 0)) throw new Error(`Курс ${cur}/USD за ${day} не получен`);
      return v;
    })().catch((e) => { rates.delete(key); throw e; }));
  }
  return rates.get(key)!;
}
