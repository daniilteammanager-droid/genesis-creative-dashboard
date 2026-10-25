// Поиск оплаты заявки в блокчейне по адресу получателя (Decision 072).
//
// Ходим только в открытые API обозревателей (TronGrid, toncenter) — ключей и
// кошельков не нужно: смотрим входящие на адрес из заявки после её создания и
// берём перевод на сумму заявки (с комиссией или без). BEP20/ERC20 пока без
// автопоиска — хэш присылают ответом на сообщение.

export type Network = "TRC20" | "TON" | "BEP20" | "ERC20";
export type Asset = "USDT" | "GRAM";

export interface Transfer { hash: string; amount: number; at: number }   // at — ms

const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_TON = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";

export const AUTO_SEARCH: Network[] = ["TRC20", "TON"];

// Без ключа у TronGrid и toncenter жёсткий лимит в секунду — на 429 одна пауза и повтор.
async function getJson<T>(url: string, retry = true): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 429 && retry) {
    await new Promise((r) => setTimeout(r, 2000));
    return getJson<T>(url, false);
  }
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

const b64ToHex = (s: string) => Buffer.from(s, "base64").toString("hex");

async function incoming(network: Network, asset: Asset, address: string, sinceMs: number): Promise<Transfer[]> {
  const since = Math.floor(sinceMs / 1000);
  if (network === "TRC20") {
    const q = new URLSearchParams({ only_to: "true", limit: "50", contract_address: USDT_TRC20, min_timestamp: String(sinceMs) });
    const d = await getJson<{ data?: { transaction_id: string; value: string; block_timestamp: number; to: string; token_info?: { decimals?: number } }[] }>(
      `https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}/transactions/trc20?${q}`);
    return (d.data ?? []).filter((t) => t.to === address)
      .map((t) => ({ hash: t.transaction_id, amount: Number(t.value) / 10 ** (t.token_info?.decimals ?? 6), at: t.block_timestamp }));
  }
  if (network === "TON" && asset === "USDT") {
    const q = new URLSearchParams({ owner_address: address, jetton_master: USDT_TON, direction: "in", start_utime: String(since), limit: "50" });
    const d = await getJson<{ jetton_transfers?: { transaction_hash: string; amount: string; transaction_now: number; transaction_aborted: boolean }[] }>(
      `https://toncenter.com/api/v3/jetton/transfers?${q}`);
    return (d.jetton_transfers ?? []).filter((t) => !t.transaction_aborted)
      .map((t) => ({ hash: b64ToHex(t.transaction_hash), amount: Number(t.amount) / 1e6, at: t.transaction_now * 1000 }));
  }
  if (network === "TON" && asset === "GRAM") {
    // GRAM — родная монета сети (бывший Toncoin): обычный входящий перевод в нанограммах.
    const q = new URLSearchParams({ account: address, start_utime: String(since), limit: "50", sort: "desc" });
    const d = await getJson<{ transactions?: { hash: string; now: number; in_msg?: { source?: string | null; value?: string | null } }[] }>(
      `https://toncenter.com/api/v3/transactions?${q}`);
    return (d.transactions ?? []).filter((t) => t.in_msg?.source && Number(t.in_msg.value) > 0)
      .map((t) => ({ hash: b64ToHex(t.hash), amount: Number(t.in_msg!.value) / 1e9, at: t.now * 1000 }));
  }
  return [];
}

// Сумма совпала: ровно сумма или сумма с комиссией, с допуском на копейки и
// округление (0,1%, но не меньше 0,02).
export function matches(paid: number, amount: number, fee: number): boolean {
  return [amount, amount + fee].some((want) => Math.abs(paid - want) <= Math.max(0.02, want * 0.001));
}

// Самый ранний подходящий перевод, ещё не записанный за другой заявкой.
export async function findPayment(
  req: { network: Network; asset: Asset; address: string; amount: number; fee: number; createdAt: string },
  taken: (hash: string) => Promise<boolean>,
): Promise<Transfer | null> {
  if (!AUTO_SEARCH.includes(req.network)) return null;
  // Минуты до заявки — запас на расхождение часов и «заплатил, потом оформил».
  const list = await incoming(req.network, req.asset, req.address, Date.parse(req.createdAt) - 10 * 60_000);
  for (const t of list.filter((t) => matches(t.amount, req.amount, req.fee)).sort((a, b) => a.at - b.at)) {
    if (!(await taken(t.hash))) return t;
  }
  return null;
}

// Перевод по хэшу среди входящих на адрес — сутки до заявки и всё после.
// BEP20/ERC20 и не найденный — null: хэш тогда пишется как есть.
export async function transferByHash(network: Network, asset: Asset, address: string, hash: string, createdMs: number): Promise<Transfer | null> {
  const h = hash.toLowerCase().replace(/^0x/, "");
  return (await incoming(network, asset, address, createdMs - 24 * 3600_000)).find((t) => t.hash.toLowerCase() === h) ?? null;
}

export function txUrl(network: Network, hash: string): string {
  switch (network) {
    case "TRC20": return `https://tronscan.org/#/transaction/${hash}`;
    case "TON": return `https://tonviewer.com/transaction/${hash}`;
    case "BEP20": return `https://bscscan.com/tx/${hash}`;
    case "ERC20": return `https://etherscan.io/tx/${hash}`;
  }
}

// Хэш из текста ответа: голый или ссылкой обозревателя.
export function parseHash(text: string): string | null {
  const m = /(?:0x)?[0-9a-f]{64}/i.exec(text);
  if (m) return m[0];
  const b = /[A-Za-z0-9+/_-]{43}=?/.exec(text);   // TON в base64
  return b ? b64ToHex(b[0].replace(/-/g, "+").replace(/_/g, "/")) : null;
}

// Адрес похож на сеть — ловим опечатку «TRC20 + адрес TON» до отправки в чат.
export function addressFits(network: Network, address: string): boolean {
  if (network === "TRC20") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  if (network === "TON") return /^(?:[EU]Q[A-Za-z0-9_-]{46}|0:[0-9a-fA-F]{64})$/.test(address);
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}
