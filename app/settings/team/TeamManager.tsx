"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/client";
import { ROLE_LABELS, normalizeBuyerCode, type Profile, type UserRole } from "@/lib/auth/types";

export default function TeamManager({ people, meId }: { people: Profile[]; meId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Код правится в поле и уходит по Enter или потере фокуса, а не на каждый символ.
  const [codeDraft, setCodeDraft] = useState<Record<string, string>>({});
  const [sheetDraft, setSheetDraft] = useState<Record<string, string>>({});

  async function update(id: string, patch: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    setSaved(null);
    // Прямой update роли и кода закрыт грантами — идём через функцию, которая
    // сама проверяет, что зовущий действительно владелец.
    const { error } = await createClient().rpc("admin_update_profile", { p_id: id, ...patch });
    setBusy(null);
    if (error) {
      setError(error.message);
      // Черновик кода откатываем: иначе поле продолжает показывать то, что база
      // не приняла, и выглядит это как сохранённое значение.
      setCodeDraft((d) => { const rest = { ...d }; delete rest[id]; return rest; });
      return;
    }
    setSaved(id);
    router.refresh();
  }

  // Таблицу проверяем до записи: непошаренная на сервисный аккаунт таблица
  // сохранится молча и обернётся пустым отчётом через неделю.
  async function commitSheet(p: Profile) {
    const draft = (sheetDraft[p.id] ?? "").trim();
    if (draft === (p.gr_spreadsheet_id ?? "")) return;

    if (draft === "") { update(p.id, { p_clear_gr: true }); return; }

    setBusy(p.id);
    setError(null);
    setSaved(null);
    const res = await fetch("/api/sheets/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spreadsheetId: draft }),
    });
    if (!res.ok) {
      const d = (await res.json()) as { error?: string };
      setBusy(null);
      setError(d.error ?? "Таблица не читается");
      setSheetDraft((s) => { const rest = { ...s }; delete rest[p.id]; return rest; });
      return;
    }
    update(p.id, { p_gr_sheet: draft });
  }

  function commitCode(p: Profile) {
    const draft = normalizeBuyerCode(codeDraft[p.id] ?? "");
    if (draft === (p.buyer_code ?? "")) return;
    update(p.id, draft === "" ? { p_clear_code: true } : { p_buyer_code: draft });
  }

  const field =
    "bg-[#0d0b14] border border-violet-900/40 rounded-lg px-2.5 py-1.5 text-sm outline-none " +
    "focus:border-violet-600/50 transition placeholder:text-zinc-600 text-white";

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      <div className="bg-[#111118] border border-violet-900/30 rounded-2xl divide-y divide-violet-900/20">
        {people.length === 0 && <p className="text-sm text-zinc-600 p-5">Пока никого нет.</p>}

        {people.map((p) => {
          const isMe = p.id === meId;
          return (
            <div key={p.id} className="flex items-center gap-3 px-5 py-3.5 flex-wrap">
              <div className="min-w-[180px] flex-1">
                <p className="text-sm text-zinc-200 truncate">
                  {p.name || "без имени"}
                  {isMe && <span className="text-violet-400/70 ml-1.5 text-[11px]">это ты</span>}
                </p>
                <p className="text-[11px] text-zinc-600 truncate">{p.email}</p>
              </div>

              <select
                value={p.role}
                disabled={busy === p.id}
                onChange={(e) => update(p.id, { p_role: e.target.value as UserRole })}
                className={`${field} cursor-pointer disabled:opacity-50`}
              >
                {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>

              <input
                type="text"
                placeholder="код"
                value={codeDraft[p.id] ?? p.buyer_code ?? ""}
                disabled={busy === p.id}
                onChange={(e) => setCodeDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                onBlur={() => commitCode(p)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className={`${field} w-20 disabled:opacity-50`}
              />

              <button
                disabled={busy === p.id || isMe}
                onClick={() => update(p.id, { p_status: p.status === "active" ? "disabled" : "active" })}
                title={isMe ? "Себя отключить нельзя" : undefined}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition disabled:opacity-40 ${
                  p.status === "active"
                    ? "bg-green-900/30 text-green-400 border-green-800/30 hover:border-green-600/50"
                    : "bg-zinc-800/50 text-zinc-500 border-zinc-700/40 hover:border-zinc-500/50"
                }`}
              >
                {p.status === "active" ? "активен" : "отключён"}
              </button>

              <span className="text-[11px] w-16 text-right">
                {busy === p.id ? <span className="text-zinc-500">…</span>
                 : saved === p.id ? <span className="text-green-400">сохранено</span>
                 : null}
              </span>

              {/* Таблицу General 3.0 подключает владелец: таблицы его и доступ к ним
                  выдаёт он, баеру там нечего вводить. */}
              {p.role === "buyer" && (
                <div className="w-full flex items-center gap-2">
                  <span className="text-[11px] text-zinc-600 whitespace-nowrap">General 3.0</span>
                  <input
                    type="text"
                    placeholder="ключ таблицы"
                    value={sheetDraft[p.id] ?? p.gr_spreadsheet_id ?? ""}
                    disabled={busy === p.id}
                    onChange={(e) => setSheetDraft((s) => ({ ...s, [p.id]: e.target.value }))}
                    onBlur={() => commitSheet(p)}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    className={`${field} flex-1 min-w-0 disabled:opacity-50`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-zinc-600 leading-relaxed">
        Код баера — вида <code className="text-zinc-500">b5</code> или просто <code className="text-zinc-500">5</code>,
        пустое поле убирает код. Последнего владельца разжаловать нельзя, иначе администрировать станет некому.
        Таблица General 3.0 проверяется при сохранении: если она не открыта на чтение сервисному аккаунту,
        сохранить её не получится.
      </p>
    </div>
  );
}
