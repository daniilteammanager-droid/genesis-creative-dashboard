// Поиск оплаты заявки в блокчейне по адресу получателя (Decision 072).
//
// Ходим только в открытые API без ключей — кошельков и ключей не нужно: смотрим
// входящие на адрес из заявки после её создания и берём перевод на сумму заявки
// (комиссия агента в перевод не входит).
//   TRC20 — TronGrid; TON (USDT и GRAM) — toncenter;
//   BEP20 — публичный узел BSC (publicnode), логи Transfer на адрес;
//   ERC20 — Ethplorer с открытым ключом freekey (публичные узлы Ethereum
//           ищут логи максимум по 25–50 блоков).

export type Network = "TRC20" | "TON" | "BEP20" | "ERC20";
export type Asset = "USDT" | "GRAM";

export interface Transfer { hash: string; amount: number; at: number }   // at — ms

// Знаков после точки, которые монета переводит: USDT — 6, GRAM (TON) — 9. Платёжки узнают
// перевод по точной сумме, поэтому сумма заявки хранится и показывается до последнего знака.
export const DECIMALS: Record<Asset, number> = { USDT: 6, GRAM: 9 };

// Сумма так, как её вводят в кошелёк: точка, без разделителей и хвостовых нулей — 1000.4531.
export const exact = (n: number, asset: Asset) => n.toFixed(DECIMALS[asset]).replace(/\.?0+$/, "");

const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_TON = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const USDT_BEP20 = "0x55d398326f99059ff775485246999027b3197955";   // 18 знаков
const USDT_ERC20 = "0xdac17f958d2ee523a2206206994597c13d831ec7";   // 6 знаков
// Логи Transfer по адресу. BSC_RPC_URL — ссылка publicnode с личным токеном.
const BSC_RPC = process.env.BSC_RPC_URL || "https://bsc-rpc.publicnode.com";
const BSC_RECEIPTS = "https://bsc-dataseed.bnbchain.org"; // квитанции по хэшу, любой давности
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
// BSC: блок ~0,45 с. Без токена publicnode отдаёт логи только за последние ~10 000
// блоков (~75 минут), шагом до 4000; с токеном — глубже, шагом 10 000: ищем до
// суток назад (~20 запросов). Перевод раньше окна — хэш ответом.
const BSC_TOKEN = Boolean(process.env.BSC_RPC_URL);
const BSC_BLOCK_S = 0.45, BSC_DEPTH = BSC_TOKEN ? 192_000 : 9000, BSC_STEP = BSC_TOKEN ? 10_000 : 3000;

export const AUTO_SEARCH: Network[] = ["TRC20", "TON", "BEP20", "ERC20"];

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

async function bsc<T>(method: string, params: unknown[], rpc = BSC_RPC): Promise<T> {
  const res = await fetch(rpc, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20_000),
  });
  const d = (await res.json().catch(() => null)) as { result?: T; error?: { message?: string } } | null;
  if (!d || d.error || d.result === undefined) throw new Error(`BSC ${method}: ${d?.error?.message ?? `HTTP ${res.status}`}`);
  return d.result;
}
const hexNum = (h: string) => Number(BigInt(h));
const topicOf = (address: string) => `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
interface Log { transactionHash: string; data: string; blockNumber: string; address: string; topics: string[] }

async function bscIncoming(address: string, sinceMs: number): Promise<Transfer[]> {
  const latest = hexNum(await bsc<string>("eth_blockNumber", []));
  const back = Math.min(BSC_DEPTH, Math.ceil((Date.now() - sinceMs) / 1000 / BSC_BLOCK_S));
  const out: Transfer[] = [];
  for (let from = latest - back; from <= latest; from += BSC_STEP) {
    const logs = await bsc<Log[]>("eth_getLogs", [{
      fromBlock: `0x${from.toString(16)}`, toBlock: `0x${Math.min(latest, from + BSC_STEP - 1).toString(16)}`,
      address: USDT_BEP20, topics: [TRANSFER, null, topicOf(address)],
    }]);
    for (const l of logs) {
      out.push({ hash: l.transactionHash, amount: Number(BigInt(l.data) / BigInt(1e12)) / 1e6, at: Date.now() - (latest - hexNum(l.blockNumber)) * BSC_BLOCK_S * 1000 });
    }
  }
  return out;
}

export async function incoming(network: Network, asset: Asset, address: string, sinceMs: number): Promise<Transfer[]> {
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
  if (network === "BEP20") return bscIncoming(address, sinceMs);
  if (network === "ERC20") {
    const q = new URLSearchParams({ apiKey: "freekey", token: USDT_ERC20, type: "transfer", limit: "50" });
    const d = await getJson<{ operations?: { transactionHash: string; value: string; timestamp: number; to: string }[] }>(
      `https://api.ethplorer.io/getAddressHistory/${address}?${q}`);
    return (d.operations ?? []).filter((o) => o.to.toLowerCase() === address.toLowerCase() && o.timestamp * 1000 >= sinceMs)
      .map((o) => ({ hash: o.transactionHash, amount: Number(o.value) / 1e6, at: o.timestamp * 1000 }));
  }
  return [];
}

// Сумма совпала с суммой заявки, с допуском на копейки и округление (0,1%, но не
// меньше 0,02). Комиссия агента и платёжки в перевод не входит.
export function matches(paid: number, amount: number): boolean {
  return Math.abs(paid - amount) <= Math.max(0.02, amount * 0.001);
}

// Самый ранний подходящий перевод, ещё не записанный за другой заявкой.
export async function findPayment(
  req: { network: Network; asset: Asset; address: string; amount: number; createdAt: string },
  taken: (hash: string) => Promise<boolean>,
  recentMs?: number,   // крон: только последние N мс — на BSC полное окно это десятки запросов
): Promise<Transfer | null> {
  if (!AUTO_SEARCH.includes(req.network)) return null;
  // Минуты до заявки — запас на расхождение часов и «заплатил, потом оформил».
  let since = Date.parse(req.createdAt) - 10 * 60_000;
  if (recentMs && req.network === "BEP20") since = Math.max(since, Date.now() - recentMs);
  const list = await incoming(req.network, req.asset, req.address, since);
  for (const t of list.filter((t) => matches(t.amount, req.amount)).sort((a, b) => a.at - b.at)) {
    if (!(await taken(t.hash))) return t;
  }
  return null;
}

// Перевод по хэшу среди входящих на адрес — сутки до заявки и всё после.
// BEP20/ERC20 и не найденный — null: хэш тогда пишется как есть.
export async function transferByHash(network: Network, asset: Asset, address: string, hash: string, createdMs: number): Promise<Transfer | null> {
  const h = hash.toLowerCase().replace(/^0x/, "");
  // EVM — прямо по хэшу: окно истории тут не нужно.
  if (network === "BEP20") {
    const r = await bsc<{ logs: Log[] } | null>("eth_getTransactionReceipt", [`0x${h}`], BSC_RECEIPTS);
    const l = r?.logs.find((l) => l.address.toLowerCase() === USDT_BEP20 && l.topics[0] === TRANSFER && l.topics[2]?.toLowerCase() === topicOf(address));
    return l ? { hash: `0x${h}`, amount: Number(BigInt(l.data) / BigInt(1e12)) / 1e6, at: Date.now() } : null;
  }
  if (network === "ERC20") {
    const d = await getJson<{ timestamp?: number; operations?: { to: string; value: string; type: string; tokenInfo?: { address: string } }[] }>(
      `https://api.ethplorer.io/getTxInfo/0x${h}?apiKey=freekey`).catch(() => null);
    const o = d?.operations?.find((o) => o.type === "transfer" && o.tokenInfo?.address.toLowerCase() === USDT_ERC20 && o.to.toLowerCase() === address.toLowerCase());
    return o ? { hash: `0x${h}`, amount: Number(o.value) / 1e6, at: (d!.timestamp ?? 0) * 1000 } : null;
  }
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
