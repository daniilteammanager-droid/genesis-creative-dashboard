import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { canSeeLegacy } from "@/lib/auth/types";

// CSV легаси-библиотеки (опубликованная Google-таблица). Раньше браузер ходил за ним сам и адрес
// лежал в бандле — закрытому баеру (Decision 119) хватило бы открыть его руками. Теперь адрес только тут.
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSr4-3RDwlc7vXIbnBBkZVO9UY8QOxzqSYLceOCU-aHAHM3ETMQP9g7LMtDZORuyafkvAvm4TmCEawl/pub?gid=1832093387&single=true&output=csv";

export async function GET() {
  if (!canSeeLegacy(await getProfile())) {
    return NextResponse.json({ error: "Легаси крео тебе пока закрыты — их открывает владелец" }, { status: 403 });
  }
  const res = await fetch(CSV_URL, { cache: "no-store" });
  if (!res.ok) return NextResponse.json({ error: `CSV: ошибка сети ${res.status}` }, { status: 502 });
  return new NextResponse(await res.text(), { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" } });
}
