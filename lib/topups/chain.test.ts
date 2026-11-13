// Самопроверка поиска оплаты. Запуск: npx tsx lib/topups/chain.test.ts
// С LIVE=1 ещё и живой поиск в TronGrid / toncenter по известным переводам.
import assert from "node:assert/strict";
import { addressFits, exact, findPayment, matches, PAIRS, parseHash, tronHex } from "./chain";

// Точная сумма заявки: не округляется до копеек, без хвостовых нулей, лишний знак виден.
assert.equal(exact(1000.4531, "USDT"), "1000.4531");
assert.equal(exact(1000, "USDT"), "1000");
assert.equal(exact(10.5, "USDT"), "10.5");
assert.equal(exact(1.123456789, "GRAM"), "1.123456789");
assert.notEqual(Number(exact(1000.4531234, "USDT")), 1000.4531234);   // 7-й знак USDT не перевести
assert.ok(matches(1000.4531, 1000.4531, "USDT"));

assert.ok(matches(1000, 1000, "USDT"));
assert.ok(matches(1000.5, 1000, "USDT"));
assert.ok(!matches(1050, 1000, "USDT"));   // сумма с комиссией — уже не та сумма
assert.ok(!matches(998, 1000, "USDT"));
// BTC: допуск не 0,02 монеты, а копейки — 0,0154 и 0,0254 BTC разные переводы.
assert.ok(matches(0.0154, 0.0154, "BTC"));
assert.ok(!matches(0.0254, 0.0154, "BTC"));
assert.equal(exact(0.01540000, "BTC"), "0.0154");
assert.equal(exact(0.123456789, "BTC"), "0.12345679");   // 9-й знак BTC не перевести

// Монета → сети: TRX только в Tron, USDC не в TON.
assert.deepEqual(PAIRS.TRX, ["TRC20"]);
assert.ok(!PAIRS.USDC.includes("TON"));
assert.equal(tronHex("TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G"), "4189cbcb2372e1c2fbc00f24895a406a0c722c89f3");

const hex = "68249536c54c4482b744d010947692a6eba6242d4af5c4be8ff00ce53f4effd4";
assert.equal(parseHash(`https://tronscan.org/#/transaction/${hex}`), hex);
assert.equal(parseHash(`0x${hex}`), `0x${hex}`);
assert.equal(parseHash("9SMlL0C3WbjAHcoeWf7t1hfbg/mVyUDbUQRekT2XZ94="), Buffer.from("9SMlL0C3WbjAHcoeWf7t1hfbg/mVyUDbUQRekT2XZ94=", "base64").toString("hex"));
assert.equal(parseHash("оплатил"), null);

assert.ok(addressFits("TRC20", "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G"));
assert.ok(!addressFits("TRC20", "UQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqEBI"));
assert.ok(addressFits("TON", "UQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqEBI"));
assert.ok(addressFits("BEP20", "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3"));
assert.ok(addressFits("BTC", "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"));
assert.ok(addressFits("BTC", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"));
assert.ok(!addressFits("BTC", "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G"));

(async () => {
if (process.env.LIVE) {
  const none = async () => false;
  const tron = await findPayment({ network: "TRC20", asset: "USDT", address: "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G",
    amount: 38131315.653804, createdAt: new Date(1792862424000 - 60_000).toISOString() }, none);
  assert.equal(tron?.hash, hex);
  const ton = await findPayment({ network: "TON", asset: "USDT", address: "UQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqEBI",
    amount: 0.001, createdAt: new Date(1773046928000 - 60_000).toISOString() }, none);
  // На этот адрес сыплются копеечные «salary»-переводы — берётся самый ранний подходящий.
  assert.equal(ton?.amount, 0.001);
  assert.match(ton!.hash, /^[0-9a-f]{64}$/);
  await new Promise((r) => setTimeout(r, 3000));   // лимит TronGrid без ключа
  // Тот же перевод уже записан за другой заявкой — не берём.
  assert.equal(await findPayment({ network: "TRC20", asset: "USDT", address: "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G",
    amount: 38131315.653804, createdAt: new Date(1792862424000 - 60_000).toISOString() }, async () => true), null);
  // BEP20 и ERC20: свежий входящий на оживлённые адреса (горячий кошелёк Binance, контракты DEX на BSC;
  // на 13.11.2026 — затихнет адрес, взять другой) — найти по сумме и по хэшу.
  const { incoming, transferByHash } = await import("./chain");
  for (const [network, asset, address] of [
    ["BEP20", "USDT", "0x47a90a2d92a8367a91efa1906bfc8c1e05bf10c4"], ["BEP20", "USDC", "0xf2688fb5b81049dfb7703ada5e770543770612c4"],
    ["ERC20", "USDT", "0x28C6c06298d514Db089934071355E5743bf21d60"], ["ERC20", "USDC", "0x28C6c06298d514Db089934071355E5743bf21d60"],
  ] as const) {
    const since = Date.now() - (network === "ERC20" ? 30 * 24 * 3600_000 : 30 * 60_000);   // у Ethplorer без ключа история с задержкой в часы
    const list = await incoming(network, asset, address, since);
    assert.ok(list.length > 0, `${network} ${asset}: входящих нет`);
    const t = list[list.length - 1];
    const found = await findPayment({ network, asset, address, amount: t.amount, createdAt: new Date(since + 10 * 60_000).toISOString() }, none);
    assert.ok(found && matches(found.amount, t.amount, asset));
    assert.equal((await transferByHash(network, asset, address, t.hash, Date.now()))?.amount, t.amount);
    console.log(network, list.length, "входящих,", t.amount, asset, t.hash);
  }
  // Новые монеты: BTC (mempool.space) и TRX (TronGrid) — найти по сумме и по хэшу.
  for (const [network, asset, address] of [["BTC", "BTC", "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"], ["TRC20", "TRX", "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G"]] as const) {
    await new Promise((r) => setTimeout(r, 2000));
    const list = await incoming(network, asset, address, Date.now() - 30 * 24 * 3600_000);
    assert.ok(list.length > 0, `${asset}: входящих за 30 дней нет`);
    const t = list[0];
    assert.ok(t.amount > 0 && /^[0-9a-f]{64}$/.test(t.hash));
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal((await transferByHash(network, asset, address, t.hash, t.at))?.amount, t.amount);
    console.log(asset, list.length, "входящих,", t.amount, asset, t.hash);
  }
  console.log("live ok");
}
console.log("ok");
})();
