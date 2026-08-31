import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { loadCreatives } from "@/lib/warehouse/creatives";

// Диапазон по умолчанию — последние 14 дней, столько же, сколько перечитывает
// загрузка. Просить больше можно, но за пределами окна цифры Meta уже не
// обновляются, и это стоит понимать.
const DEFAULT_DAYS = 14;

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });

  const p = new URL(req.url).searchParams;
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - (DEFAULT_DAYS - 1));

  const since = DAY_RE.test(p.get("since") ?? "") ? (p.get("since") as string) : isoDay(from);
  const until = DAY_RE.test(p.get("until") ?? "") ? (p.get("until") as string) : isoDay(today);
  if (since > until) {
    return NextResponse.json({ error: "Начало диапазона позже конца" }, { status: 400 });
  }

  try {
    // Фильтр по баеру приходит из запроса, но проверяется внутри: баеру он
    // ничего не даёт, он всегда видит только себя.
    const data = await loadCreatives(me, since, until, p.get("buyer") ?? undefined, p.get("country") ?? undefined);
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ошибка";
    console.error("Creatives API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
