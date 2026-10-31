"use client";

// Граница ошибок на всё приложение. До неё непойманное исключение в серверном
// компоненте отдавало стандартную страницу Next с одним лишь digest — человек
// видел «Application error» и не знал ни что случилось, ни что делать.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen bg-background text-white p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-3">Здесь что-то сломалось</h1>
        <p className="text-sm text-zinc-400 leading-relaxed mb-4">
          Остальные разделы работают — панель слева на месте.
        </p>
        <div className="card p-5 mb-4">
          <p className="text-sm text-zinc-300 break-words">{error.message || "Причина не названа"}</p>
          {error.digest && <p className="text-[11px] text-hint mt-2">Код: {error.digest}</p>}
        </div>
        <button
          onClick={reset}
          className="btn btn-primary"
        >
          Попробовать снова
        </button>
      </div>
    </main>
  );
}
