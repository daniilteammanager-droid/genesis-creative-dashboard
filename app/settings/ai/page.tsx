import { headers } from "next/headers";
import AiAccess from "./AiAccess";

// Настройки → AI-доступ (Decision 116): подключить свой Claude или Codex к дашборду по MCP.
export default async function AiPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return <AiAccess url={`${proto}://${host}/api/mcp`} />;
}
