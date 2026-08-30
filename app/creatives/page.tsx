import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";

// Заглушка новой картотеки креативов. Легаси-страница «/» остаётся как есть и не
// трогается: она живёт на опубликованном CSV со старыми именами файлов, а эта
// собирается по новому коду крео (носитель-подход-tN-vN-bN-язык-гео).
const SOURCES = [
  ["Meta Marketing API", "расход, показы, клики — по объявлениям с кодом крео в имени"],
  ["Выгрузки Torro CRM", "депозиты и доходы, матч по тому же коду"],
  ["Загруженные файлы R2", "само видео или картинка, превью и транскрипция"],
];

export default async function CreativesPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <main className="min-h-screen bg-[#0a080f] text-white p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-white text-3xl font-semibold tracking-wide mb-6">Креативы</h1>

        <div className="bg-violet-950/20 border border-violet-800/30 rounded-2xl px-5 py-4 mb-4">
          <p className="text-sm text-violet-200/80 leading-relaxed">
            Новая картотека, собирается сама. Ключ строки — код крео, а не имя файла,
            поэтому расход, депозиты и сам файл сходятся без ручной сверки.
          </p>
          <p className="text-sm text-violet-200/50 leading-relaxed mt-2">
            Пока пусто: страница ждёт склад данных. Старая библиотека на месте —
            «Легаси крео» в панели слева.
          </p>
        </div>

        <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Из чего будет собираться</h2>
          <dl className="space-y-3">
            {SOURCES.map(([title, what]) => (
              <div key={title}>
                <dt className="text-sm text-zinc-300">{title}</dt>
                <dd className="text-[13px] text-zinc-600 leading-relaxed">{what}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </main>
  );
}
