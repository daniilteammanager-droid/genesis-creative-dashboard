// Скелет вкладок настроек. Без него переход между Профилем, Интеграциями и
// Командой ждёт сервер молча, и клик выглядит как «ничего не произошло».
export default function SettingsLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      {[0, 1].map((i) => (
        <div key={i} className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
          <div className="h-5 w-40 bg-violet-900/20 rounded mb-4" />
          <div className="h-3 w-full bg-violet-900/10 rounded mb-2" />
          <div className="h-3 w-2/3 bg-violet-900/10 rounded" />
        </div>
      ))}
    </div>
  );
}
