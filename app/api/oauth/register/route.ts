import { NextResponse } from "next/server";
import { OAuthError, registerClient } from "@/lib/mcp/store";
import { CORS } from "@/lib/mcp/oauth";

// DCR, RFC 7591 (Decision 116): AI-клиент регистрирует себя сам перед входом.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    return NextResponse.json(await registerClient(body), { status: 201, headers: { ...CORS, "Cache-Control": "no-store" } });
  } catch (e) {
    const code = e instanceof OAuthError ? e.code : "server_error";
    return NextResponse.json({ error: code, error_description: e instanceof Error ? e.message : String(e) },
      { status: e instanceof OAuthError ? e.status : 500, headers: CORS });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
