// Самопроверка QR заявок. Запуск: npx tsx lib/topups/qr.test.ts
import assert from "node:assert/strict";
import { paymentUri, qrPng, units } from "./qr";

assert.equal(units(12.5, 6), "12500000");
assert.equal(units(0.1 + 0.2, 6), "300000");
assert.equal(units(3, 9), "3000000000");
assert.equal(paymentUri({ network: "TON", asset: "GRAM", address: "UQabc", amount: 1.5 }).uri, "ton://transfer/UQabc?amount=1500000000");
assert.match(paymentUri({ network: "TON", asset: "USDT", address: "UQabc", amount: 100 }).uri, /jetton=EQCx.*&amount=100000000$/);
assert.deepEqual(paymentUri({ network: "TRC20", asset: "USDT", address: "TXyz", amount: 100 }), { uri: "TXyz", withAmount: false });
qrPng("TXyz").then((png) => {
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  console.log("topups qr: ok");
});
