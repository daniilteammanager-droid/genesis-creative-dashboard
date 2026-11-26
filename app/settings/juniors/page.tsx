import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/server";
import { warehouse } from "@/lib/warehouse/read";
import { areasFor } from "@/lib/nav";
import JuniorsManager, { type Junior } from "./JuniorsManager";

// Баер настраивает своих джунов (060_junior.sql): разделы — не больше своих, AI-доступ, ссылка новому джуну.
// Роль, привязку и отключение меняет владелец на «Команде».
export default async function JuniorsPage() {
  const me = await requireRole("buyer");
  if (!me) redirect("/settings");

  // Строки джунов баеру политика profiles не отдаёт — читаем сервером и только его.
  const { data } = await warehouse().from("profiles")
    .select("id, name, email, status, junior_areas, junior_mcp, created_at")
    .eq("role", "junior").eq("junior_of", me.id).order("created_at");

  return (
    <>
      <p className="text-hint text-sm mb-5">
        Джун видит твои кабинеты, цифры и крео в открытых разделах — не больше, чем видишь ты. «Интеграции» по умолчанию
        закрыты; откроешь — он ведёт твои ключи и подключения так же, как ты, а тебе в Telegram приходит, что он поменял.
        Что он запустил или загрузил, ложится к тебе с его именем. Отключить или перепривязать джуна может владелец.
      </p>
      <JuniorsManager juniors={(data as Junior[]) ?? []} allowed={areasFor(me).map((a) => a.href)} />
    </>
  );
}
