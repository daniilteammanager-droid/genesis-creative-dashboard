import { NextResponse } from "next/server";
import { CORS, protectedResource } from "@/lib/mcp/oauth";

// /.well-known/oauth-protected-resource[/api/mcp] (rewrite в next.config.ts) — RFC 9728, Decision 116.
export function GET(req: Request) {
  return NextResponse.json(protectedResource(new URL(req.url).origin), { headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
