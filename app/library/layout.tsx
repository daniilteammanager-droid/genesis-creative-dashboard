import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import { canSeeLegacy } from "@/lib/auth/types";

// «Легаси крео» закрыты новому баеру, пока владелец не откроет их на «Команде» (Decision 119).
// Проверка здесь, а не в панели: адрес можно набрать руками. Данные — /api/legacy, он проверяет сам.
export default async function LegacyLayout({ children }: { children: React.ReactNode }) {
  if (!canSeeLegacy(await getProfile())) redirect("/home");
  return children;
}
