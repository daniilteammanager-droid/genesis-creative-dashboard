import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import CreativesTable from "./CreativesTable";

// Новая картотека. Строки задают подключения баера — его объявления из Meta и
// его выгрузки Torro (Decision 036). Файлы в R2 по владельцу не фильтруются:
// легаси-крео, которыми льют до сих пор, лежат в общих папках.
export default async function CreativesPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <main className="min-h-screen bg-[#0a080f] text-white p-8">
      <div className="max-w-screen-2xl mx-auto">
        <h1 className="text-white text-3xl font-semibold tracking-wide mb-6">Креативы</h1>
        <CreativesTable />
      </div>
    </main>
  );
}
