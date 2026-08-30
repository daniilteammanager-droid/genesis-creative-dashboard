import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";

// Заглушка. Здесь баер подключит свои источники, и отчёты начнут читать их
// вместо общих переменных окружения — сейчас ключ Meta и таблицы одни на всех.
const PLANNED = [
  {
    title: "Meta Marketing API",
    what: "Свой токен доступа. Расход, клики, показы и статусы Reports будет тянуть из твоих кабинетов.",
    now: "Пока используется общий ключ из переменных окружения.",
  },
  {
    title: "Выгрузки Torro CRM",
    what: "Ссылки на твои Google-таблицы с выгрузками по кампаниям и объявлениям.",
    now: "Пока таблицы прописаны в коде одним списком на команду.",
  },
  {
    title: "Таблица General Report 3.0",
    what: "Твоя байерская таблица. Появится в переключателе источников сводного отчёта.",
    now: "Пока список байерских таблиц зашит в переменные окружения.",
  },
];

export default async function IntegrationsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <div className="space-y-4">
      <div className="bg-violet-950/20 border border-violet-800/30 rounded-2xl px-5 py-4">
        <p className="text-sm text-violet-200/80">
          Раздел в работе. Здесь будут храниться твои личные подключения — сейчас все
          отчёты работают на общих ключах команды.
        </p>
      </div>

      {PLANNED.map((p) => (
        <div key={p.title} className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <h2 className="text-lg font-semibold text-white">{p.title}</h2>
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-zinc-800/60 text-zinc-500 border border-zinc-700/40">
              скоро
            </span>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed">{p.what}</p>
          <p className="text-[11px] text-zinc-600 leading-relaxed mt-2">{p.now}</p>
        </div>
      ))}
    </div>
  );
}
