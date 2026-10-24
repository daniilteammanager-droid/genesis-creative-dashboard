import { after } from "next/server";
import { ingestForUser } from "./ingest";

// Загрузка сразу после подключения, не дожидаясь крона (до 15 минут). Без неё
// кабинеты нового ключа не закреплены, и чек с Reports говорят «кабинетов нет»
// ровно до ближайшего прогона. Сразу же — первая неделя истории расхода и Torro,
// чтобы «вчера» и «7 дней» не были пустыми; остальное — кроном.
// after(): ответ уходит сразу, загрузка идёт следом в той же функции.
export function ingestSoon(userId: string): void {
  after(async () => {
    try {
      await ingestForUser(userId, "today", { backfill: true });
    } catch (e) {
      console.warn("ingestSoon:", e instanceof Error ? e.message : e);
    }
  });
}
