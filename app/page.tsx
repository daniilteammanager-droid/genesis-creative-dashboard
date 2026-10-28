import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import { startPageOf } from "@/lib/nav";

// «/» — не страница, а вход: ведёт на стартовую из профиля (по умолчанию Главная).
// Легаси-библиотека переехала на /library.
export default async function Root() {
  const me = await getProfile();
  redirect(startPageOf(me?.start_page));
}
