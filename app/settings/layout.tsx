import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import SettingsNav from "./SettingsNav";

// Всё, что касается аккаунта и администрирования, живёт под /settings и делит
// одну шапку с вкладками. Так раздел растёт вкладкой, а не пунктом в левой панели.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <main className="min-h-screen bg-[#0a080f] text-white p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-white text-3xl font-semibold tracking-wide mb-6">Настройки</h1>
        <SettingsNav isMain={profile.role === "main"} />
        {children}
      </div>
    </main>
  );
}
