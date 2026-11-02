import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import Tasks from "./Tasks";

// Задачи — у каждого свой холст; что кому видно, проверяет /api/tasks (lib/tasks/store.ts).
export default async function TasksPage() {
  const me = await getProfile();
  if (!me) redirect("/login");
  return <Tasks me={me.id} />;
}
