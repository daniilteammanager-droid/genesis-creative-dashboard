import QRCode from "qrcode";
import type { Topup } from "./requests";

// QR для оплаты заявки (Decision 088). TON — ссылка ton://transfer с суммой: Tonkeeper и
// Wallet в Telegram подставят адрес, сумму и монету сами. Остальные сети — только адрес:
// общей ссылки с суммой у TRC20 нет, а EIP-681 для токенов кошельки читают по-разному, и
// ошибка там — перевод на контракт токена вместо получателя. Сумма — в подписи.

const USDT_TON = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";

// Сумма в минимальных единицах без плавающей точки: 12.5 → "12500000" при 6 знаках.
export function units(amount: number, digits: number): string {
  const [int, frac = ""] = amount.toFixed(digits).split(".");
  return BigInt(int + frac).toString();
}

export function paymentUri(r: Pick<Topup, "network" | "asset" | "address" | "amount">): { uri: string; withAmount: boolean } {
  if (r.network === "TON" && r.asset === "GRAM") return { uri: `ton://transfer/${r.address}?amount=${units(r.amount, 9)}`, withAmount: true };
  if (r.network === "TON" && r.asset === "USDT") return { uri: `ton://transfer/${r.address}?jetton=${USDT_TON}&amount=${units(r.amount, 6)}`, withAmount: true };
  return { uri: r.address, withAmount: false };
}

export const qrPng = (text: string) => QRCode.toBuffer(text, { errorCorrectionLevel: "M", margin: 2, width: 512 });
