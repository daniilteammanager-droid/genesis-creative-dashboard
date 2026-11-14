import { NextResponse } from "next/server";
import { authorizationServer, CORS } from "@/lib/mcp/oauth";

// /.well-known/oauth-authorization-server (rewrite в next.config.ts) — RFC 8414, Decision 116.
export function GET(req: Request) {
  return NextResponse.json(authorizationServer(new URL(req.url).origin), { headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
