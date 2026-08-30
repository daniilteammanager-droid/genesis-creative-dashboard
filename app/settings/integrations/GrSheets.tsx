"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface GrSheet {
  id: string;
  name: string;
  spreadsheet_id: string;
  kind: "country" | "wa";
}

const field =
  "bg-[#0d0b14] border border-violet-900/40 rounded-xl px-4 py-3 outline-none " +
  "focus:border-violet-600/50 transition placeholder:text-zinc-600 text-white text-sm";

export default function GrSheets({ sheets, serviceAccount }: { sheets: GrSheet[]; serviceAccount: string | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [kind, setKind] = useState<"country" | "wa">("country");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(init: RequestInit, url = "/api/gr-sheets") {
    setBusy(true);
    setError(null);
    let ok = false;
    let text = "Не получилось";
    try {
      const res = await fetch(url, init);
      ok = res.ok;
      if (!ok) {
        // Ответ не всегда JSON: упавшая функция отдаёт HTML.
        try {
          const d = (await res.json()) as { error?: string };
          if (d.error) text = d.error;
        } catch { /* не JSON */ }
      }
    } catch {
      text = "Сеть не ответила — попробуй ещё раз";
    }
    setBusy(false);
    if (!ok) { setError(text); return false; }
    router.refresh();
    return true;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const done = await send({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, spreadsheetId: sheetId, kind }),
    });
    if (done) { setName(""); setSheetId(""); setKind("country"); }
  }

  return (
    <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
      <h2 className="text-lg font-semibold text-white mb-2">Таблицы General Report 3.0</h2>
      <p className="text-[13px] text-zinc-600 leading-relaxed mb-4">
        Общие таблицы команды. Байерские подключаются отдельно, на вкладке «Команда».
        {serviceAccount && (
          <>
            {" "}Каждую таблицу открой на чтение для{" "}
            <code className="text-zinc-400 break-all">{serviceAccount}</code>.
          </>
        )}
      </p>

      {sheets.length > 0 && (
        <div className="divide-y divide-violet-900/20 border border-violet-900/25 rounded-xl mb-4">
          {sheets.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
              <span className="text-sm text-zinc-200 flex-1 min-w-[120px]">{s.name}</span>
              <span className="text-[11px] text-zinc-600">{s.kind === "wa" ? "WhatsApp" : "страновая"}</span>
              <button
                disabled={busy}
                onClick={() => send({ method: "DELETE" }, `/api/gr-sheets?id=${s.id}`)}
                className="text-[11px] px-2.5 py-1 rounded-full border border-red-800/40 text-red-300 hover:bg-red-900/20 transition disabled:opacity-50"
              >
                убрать
              </button>
            </div>
          ))}
        </div>
      )}

      {sheets.length === 0 && (
        <p className="text-[13px] text-zinc-500 leading-relaxed mb-4">
          Пока пусто, и отчёт читает таблицы из переменных окружения — как раньше.
          Добавь первую, и источником станет этот список.
        </p>
      )}

      <form onSubmit={add} className="flex gap-2 flex-wrap items-start">
        <input type="text" placeholder="Имя, например EU" value={name}
               onChange={(e) => setName(e.target.value)} required
               className={`${field} flex-1 min-w-[140px]`} />
        <input type="text" placeholder="Ключ таблицы" value={sheetId}
               onChange={(e) => setSheetId(e.target.value)} required
               className={`${field} flex-1 min-w-[160px]`} />
        {/* Тип обязателен: у WA-таблиц другой парсер, и ошибка здесь даёт
            таблицу, которая разберётся молча и неверно. */}
        <select value={kind} onChange={(e) => setKind(e.target.value as "country" | "wa")}
                className={`${field} cursor-pointer`}>
          <option value="country">страновая</option>
          <option value="wa">WhatsApp</option>
        </select>
        <button type="submit" disabled={busy}
                className="px-4 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm hover:from-violet-500 hover:to-violet-400 transition disabled:opacity-50">
          {busy ? "Проверяю…" : "Добавить"}
        </button>
      </form>

      {error && (
        <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm mt-3">
          {error}
        </div>
      )}
    </div>
  );
}
