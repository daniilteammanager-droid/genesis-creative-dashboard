import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { checkAuthorize, deniedRedirect, issueCode } from "@/lib/mcp/store";

// Кнопка экрана согласия (Decision 116). Под сессией дашборда (middleware); запрос разбирается
// заново — скрытым полям формы не верим. Origin — свой: чужая страница не отправит форму за
// вошедшего человека (cookie Lax и так не уйдут, это второй рубеж).
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  if (req.headers.get("origin") !== origin) return NextResponse.json({ error: "Чужой источник запроса" }, { status: 403 });
  const me = await getProfile();
  if (!me || me.status !== "active") return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const form = await req.formData();
  const get = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : null; };
  try {
    const request = await checkAuthorize(get);
    const to = get("decision") === "allow" ? await issueCode(me, request) : deniedRedirect(request);
    return NextResponse.redirect(to, 303);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
