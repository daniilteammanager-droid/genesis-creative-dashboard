// Самопроверка поиска оплаты. Запуск: npx tsx lib/topups/chain.test.ts
// С LIVE=1 ещё и живой поиск в TronGrid / toncenter по известным переводам.
import assert from "node:assert/strict";
import { addressFits, findPayment, matches, parseHash } from "./chain";

assert.ok(matches(1050, 1000, 50));
assert.ok(matches(1000, 1000, 50));
assert.ok(matches(1049.99, 1000, 50));
assert.ok(!matches(1025, 1000, 50));
assert.ok(!matches(998, 1000, 0));

const hex = "68249536c54c4482b744d010947692a6eba6242d4af5c4be8ff00ce53f4effd4";
assert.equal(parseHash(`https://tronscan.org/#/transaction/${hex}`), hex);
assert.equal(parseHash(`0x${hex}`), `0x${hex}`);
assert.equal(parseHash("9SMlL0C3WbjAHcoeWf7t1hfbg/mVyUDbUQRekT2XZ94="), Buffer.from("9SMlL0C3WbjAHcoeWf7t1hfbg/mVyUDbUQRekT2XZ94=", "base64").toString("hex"));
assert.equal(parseHash("оплатил"), null);

assert.ok(addressFits("TRC20", "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G"));
assert.ok(!addressFits("TRC20", "UQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqEBI"));
assert.ok(addressFits("TON", "UQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqEBI"));
assert.ok(addressFits("BEP20", "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3"));

(async () => {
if (process.env.LIVE) {
  const none = async () => false;
  const tron = await findPayment({ network: "TRC20", asset: "USDT", address: "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G",
    amount: 38131315.653804, fee: 0, createdAt: new Date(1792862424000 - 60_000).toISOString() }, none);
  assert.equal(tron?.hash, hex);
  const ton = await findPayment({ network: "TON", asset: "USDT", address: "UQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqEBI",
    amount: 0.001, fee: 0, createdAt: new Date(1773046928000 - 60_000).toISOString() }, none);
  // На этот адрес сыплются копеечные «salary»-переводы — берётся самый ранний подходящий.
  assert.equal(ton?.amount, 0.001);
  assert.match(ton!.hash, /^[0-9a-f]{64}$/);
  await new Promise((r) => setTimeout(r, 3000));   // лимит TronGrid без ключа
  // Тот же перевод уже записан за другой заявкой — не берём.
  assert.equal(await findPayment({ network: "TRC20", asset: "USDT", address: "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G",
    amount: 38131315.653804, fee: 0, createdAt: new Date(1792862424000 - 60_000).toISOString() }, async () => true), null);
  console.log("live ok");
}
console.log("ok");
})();
