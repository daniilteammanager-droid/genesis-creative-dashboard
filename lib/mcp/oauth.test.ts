// Самопроверка OAuth и протокола AI-доступа (Decision 116). Запуск: npx tsx lib/mcp/oauth.test.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { authorizationServer, hashToken, isCimdClientId, newToken, pkceOk, protectedResource, redirectMatches, redirectUsable } from "./oauth";
import { handleRpc, ToolError, type ToolDef } from "./protocol";
import { budgetTarget } from "./manage";

// PKCE S256 — пример из RFC 7636, приложение B.
assert.ok(pkceOk("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
assert.ok(!pkceOk("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "не тот"));
assert.ok(!pkceOk("короткий", createHash("sha256").update("короткий").digest("base64url")), "verifier короче 43 знаков — нет");

// Адреса возврата: https и loopback; loopback — без учёта порта (Claude Code, RFC 8252).
assert.ok(redirectUsable("https://claude.ai/api/mcp/auth_callback"));
assert.ok(redirectUsable("http://127.0.0.1:5555/callback"));
assert.ok(!redirectUsable("http://evil.example/cb"), "http не на свою машину — нет");
assert.ok(!redirectUsable("javascript:alert(1)"));
assert.ok(redirectMatches(["https://claude.ai/api/mcp/auth_callback"], "https://claude.ai/api/mcp/auth_callback"));
assert.ok(!redirectMatches(["https://claude.ai/api/mcp/auth_callback"], "https://claude.ai/api/mcp/auth_callback2"));
assert.ok(redirectMatches(["http://localhost/callback"], "http://localhost:3118/callback"));
assert.ok(redirectMatches(["http://127.0.0.1/callback"], "http://127.0.0.1:61000/callback"));
assert.ok(!redirectMatches(["http://localhost/callback"], "http://localhost:3118/other"), "другой путь — нет");
assert.ok(!redirectMatches(["http://localhost/callback"], "http://127.0.0.1:3118/callback"), "другой хост — нет");

// CIMD: https-адрес документа, не IP и не голый домен.
assert.ok(isCimdClientId("https://claude.ai/oauth/claude-code-client-metadata"));
assert.ok(!isCimdClientId("gncl_abc"));
assert.ok(!isCimdClientId("https://10.0.0.1/meta"));
assert.ok(!isCimdClientId("http://claude.ai/meta"));

// Токены: разные, хэш стабильный.
const t = newToken("gna");
assert.ok(t.startsWith("gna_") && t.length > 40 && t !== newToken("gna"));
assert.equal(hashToken(t), hashToken(t));

// Метаданные: resource — ровно адрес сервера; CIMD выбирается только вместе с "none".
const o = "https://dash.example";
assert.equal(protectedResource(o).resource, "https://dash.example/api/mcp");
assert.deepEqual(protectedResource(o).authorization_servers, [o]);
assert.ok(authorizationServer(o).client_id_metadata_document_supported && authorizationServer(o).token_endpoint_auth_methods_supported.includes("none"));
assert.deepEqual(authorizationServer(o).code_challenge_methods_supported, ["S256"]);

// Бюджет через AI (Decision 117): не дальше чем вдвое от текущего, проценты от текущего.
assert.deepEqual(budgetTarget(50, 100, null), { usd: 100 });
assert.deepEqual(budgetTarget(50, null, 20), { usd: 60 });
assert.deepEqual(budgetTarget(50, null, -50), { usd: 25 });
assert.ok("error" in budgetTarget(50, 100.01, null), "больше чем вдвое — нет");
assert.ok("error" in budgetTarget(50, 24.99, null), "меньше чем вдвое — нет");
assert.ok("error" in budgetTarget(null, 30, null), "бюджет не на этом уровне");
assert.ok("error" in budgetTarget(50, null, -100), "ноль — нет");
assert.deepEqual(budgetTarget(33.33, null, 100), { usd: 66.66 }, "граница вдвое — с округлением до цента");

async function protocol() {
  const info = { name: "t", title: "T", version: "1", instructions: "инструкция" };
  const calls: string[] = [];
  const tools: ToolDef<{ who: string }>[] = [
    { name: "echo", title: "Echo", description: "d", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true },
      run: async (ctx, a) => ({ who: ctx.who, a }) },
    { name: "boom", title: "Boom", description: "d", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true },
      run: async () => { throw new ToolError("понятная ошибка"); } },
  ];
  const rpc = (m: unknown) => handleRpc(m, { who: "баер" }, tools, info, (tool, _a, ok) => calls.push(`${tool}:${ok}`));

  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) as { result: { protocolVersion: string; instructions: string } };
  assert.equal(init.result.protocolVersion, "2025-06-18", "версию клиента принимаем, если знаем");
  assert.equal(init.result.instructions, "инструкция");
  const unknownVer = await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }) as { result: { protocolVersion: string } };
  assert.equal(unknownVer.result.protocolVersion, "2025-11-25", "незнакомую — предлагаем свою свежую");

  assert.equal(await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }), null, "уведомление — без ответа");
  const list = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }) as { result: { tools: Record<string, unknown>[] } };
  assert.deepEqual(list.result.tools.map((x) => x.name), ["echo", "boom"]);
  assert.ok(!("run" in list.result.tools[0]), "функция инструмента наружу не уходит");

  const echo = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "echo", arguments: { x: 1 } } }) as { result: { content: { text: string }[] } };
  assert.deepEqual(JSON.parse(echo.result.content[0].text), { who: "баер", a: { x: 1 } });
  const boom = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "boom" } }) as { result: { isError: boolean; content: { text: string }[] } };
  assert.ok(boom.result.isError && boom.result.content[0].text === "понятная ошибка", "ошибка инструмента — текстом модели, не ошибкой протокола");
  const missing = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "нет" } }) as { error: { code: number } };
  assert.equal(missing.error.code, -32602);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 7, method: "resources/list" }) as { error: { code: number } }).error.code, -32601);
  assert.equal((await rpc([{ jsonrpc: "2.0", id: 8, method: "ping" }]) as { error: { code: number } }).error.code, -32600, "пачки — нет");
  assert.deepEqual(calls, ["echo:true", "boom:false"], "журнал вызовов");
}

protocol().then(() => console.log("mcp: oauth и протокол ok")).catch((e) => { console.error(e); process.exit(1); });
