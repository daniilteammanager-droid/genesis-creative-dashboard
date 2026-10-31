"use client";

import { useState } from "react";
import type { ConnectionView } from "@/lib/connections/store";

// Torro CRM — только по API (Decision 061): выгрузки в таблицы убраны, чтобы
// склад совпадал с CRM целиком. Ключи Meta — отдельной карточкой (MetaKeys).

const field =
  "w-full bg-panel border border-line rounded-xl px-4 py-3 outline-none " +
  "focus:border-violet-600/50 transition placeholder:text-hint text-white text-sm";

const card = "bg-card border border-line rounded-2xl p-6";

export default function ConnectionsForm({
  initial,
  loadError,
  grSheetId,
  isMain,
}: {
  initial: ConnectionView | null;
  loadError: string | null;
  grSheetId: string | null;
  isMain: boolean;
}) {
  const [view, setView] = useState(initial);
  const [torroToken, setTorroToken] = useState("");
  const [torroBuyer, setTorroBuyer] = useState(initial?.torroBuyerId ? String(initial.torroBuyerId) : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Удаление в два клика: ключ обратно не читается.
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function post(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // Ответ не всегда JSON: упавшая или обрубленная по времени функция отдаёт
    // HTML, и без этого форма застряла бы на «Проверяю…».
    let data: (ConnectionView & { error?: string }) | null = null;
    try { data = (await res.json()) as ConnectionView & { error?: string }; } catch { /* не JSON */ }
    setBusy(false);
    if (!res.ok || !data) {
      setMsg({ ok: false, text: data?.error ?? "Не удалось сохранить — попробуй ещё раз" });
      return false;
    }
    setView(data);
    setMsg({ ok: true, text: ok });
    return true;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // Шлём только изменённое: пустое поле ключа — «не трогать», прочитать его
    // назад нельзя, поэтому оно всегда пустое при открытии страницы.
    const done = await post({
      ...(torroToken.trim() ? { torroToken: torroToken.trim() } : {}),
      ...(torroBuyer.trim() && torroBuyer.trim() !== String(initial?.torroBuyerId ?? "")
        ? { torroBuyerId: torroBuyer.trim() } : {}),
    }, "Проверено и сохранено. История догрузится сама");
    if (done) setTorroToken("");
  }

  async function disconnect() {
    const done = await post({ torroToken: null }, "Ключ удалён");
    if (done) { setConfirmDelete(false); setTorroBuyer(""); }
  }

  if (loadError) {
    return (
      <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm">
        {loadError}
      </div>
    );
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className={card}>
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <h2 className="text-lg font-semibold text-white">Torro CRM</h2>
          {view?.torroConnected && (
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-green-900/30 text-green-400 border border-green-800/30">
              подключено {view.torroHint}
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-400 leading-relaxed mb-4">
          Подписки, диалоги и депозиты напрямую из Torro, по дням. Ключ MCP и свой id баера берутся в Torro.
        </p>

        <input
          type="password"
          placeholder={view?.torroConnected ? "Вставь новый ключ, чтобы заменить" : "Ключ Torro MCP"}
          value={torroToken}
          onChange={(e) => setTorroToken(e.target.value)}
          autoComplete="off"
          className={`${field} mb-3`}
        />
        <label className="block text-[11px] text-hint mb-1">id баера в Torro</label>
        <input type="text" inputMode="numeric" placeholder="5183" value={torroBuyer}
               onChange={(e) => setTorroBuyer(e.target.value)} className={field} />

        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <button type="submit" disabled={busy}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm hover:from-violet-500 hover:to-violet-400 transition disabled:opacity-50">
            {busy ? "Проверяю…" : "Проверить и сохранить"}
          </button>
          {view?.torroConnected && (
            <button type="button" disabled={busy}
                    onClick={() => (confirmDelete ? disconnect() : setConfirmDelete(true))}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-red-800/40 text-red-300 hover:bg-red-900/20 transition disabled:opacity-50">
              {confirmDelete ? "точно удалить? вернуть будет нельзя" : "удалить ключ"}
            </button>
          )}
        </div>

        {msg && (
          <div className={`rounded-xl px-4 py-3 text-sm border mt-3 ${
            msg.ok ? "bg-green-950/30 border-green-700/30 text-green-300"
                   : "bg-red-950/40 border-red-700/30 text-red-300"
          }`}>
            {msg.text}
          </div>
        )}
      </div>

      {!isMain && (
        <div className={card}>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <h2 className="text-lg font-semibold text-white">Таблица General Report 3.0</h2>
            <span className={`text-[11px] px-2.5 py-1 rounded-full border ${
              grSheetId
                ? "bg-green-900/30 text-green-400 border-green-800/30"
                : "bg-zinc-800/60 text-hint border-zinc-700/40"
            }`}>
              {grSheetId ? "подключена" : "не подключена"}
            </span>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Её заводит и подключает владелец — таблицы его, и доступ к ним выдаёт он.
            Здесь показано только состояние.
          </p>
        </div>
      )}
    </form>
  );
}
