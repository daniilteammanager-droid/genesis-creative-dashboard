// Экран «подключений пока нет». Не ошибка и не пустота: человек должен понимать,
// что раздел рабочий, а не сломанный, и что нужно сделать, чтобы он ожил.
export default function NoConnections({ title, what }: { title: string; what: string }) {
  return (
    <main className="min-h-screen bg-[#0a080f] text-white p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-white text-3xl font-semibold tracking-wide mb-6">{title}</h1>

        <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-2">Подключений пока нет</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">{what}</p>
          <p className="text-[13px] text-zinc-600 leading-relaxed mt-3">
            Общие ключи команды здесь больше не используются — раздел показывает только твои
            данные. Пока подключения не заведены, показывать нечего.
          </p>
        </div>
      </div>
    </main>
  );
}
