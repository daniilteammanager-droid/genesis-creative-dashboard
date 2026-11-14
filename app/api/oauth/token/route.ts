import { NextResponse } from "next/server";
import { exchangeCode, OAuthError, refreshTokens } from "@/lib/mcp/store";
import { CORS } from "@/lib/mcp/oauth";

// Token endpoint (Decision 116): код → токены и обновление с ротацией refresh. Тело —
// application/x-www-form-urlencoded (RFC 6749), JSON тоже принимаем.
export async function POST(req: Request) {
  const headers = { ...CORS, "Cache-Control": "no-store" };
  try {
    const raw = await req.text();
    const form = (req.headers.get("content-type") ?? "").includes("application/json")
      ? new URLSearchParams(Object.entries(JSON.parse(raw || "{}")).map(([k, v]) => [k, String(v)]))
      : new URLSearchParams(raw);
    const get = (k: string) => form.get(k);
    const grant = get("grant_type");
    const body = grant === "authorization_code" ? await exchangeCode(get)
      : grant === "refresh_token" ? await refreshTokens(get)
        : (() => { throw new OAuthError("unsupported_grant_type", "Поддерживаются authorization_code и refresh_token"); })();
    return NextResponse.json(body, { headers });
  } catch (e) {
    const code = e instanceof OAuthError ? e.code : "server_error";
    return NextResponse.json({ error: code, error_description: e instanceof Error ? e.message : String(e) },
      { status: e instanceof OAuthError ? e.status : 500, headers });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
