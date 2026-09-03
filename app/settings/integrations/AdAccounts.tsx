"use client";

import { useEffect, useState } from "react";

// Рекламные кабинеты баера — вводятся по id, как теги.
//
// Ввод по id, а не выбор из списка — сознательно: ключ Meta видит все кабинеты
// команды, и список дал бы возможность взять чужой. Id надо знать. А занятый
// кабинет сервер всё равно не отдаст.
//
// Ключ проверяет id и возвращает имя — набор цифр сам по себе ни о чём не
// говорит, а с именем кабинет узнаётся сразу.

interface Acc { accountId: string; accountName: string }

const chipCls =
  "inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-xl bg-[#0d0b14] border border-violet-900/40 text-sm";

export default function AdAccounts({ metaConnected }: { metaConnected: boolean }) {
  const [accounts, setAccounts] = useState<Acc[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json() as Promise<{ accounts?: Acc[]; error?: string }>)
      .then((d) => { if (d.error) throw new Error(d.error); setAccounts(d.accounts ?? []); })
      .catch((e: Error) => { setError(e.message); setAccounts([]); });
  }, []);

  async function add() {
    const id = draft.trim();
    if (!id) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: id }),
    });
    let body: (Acc & { error?: string }) | null = null;
    try { body = (await res.json()) as Acc & { error?: string }; } catch { /* не JSON */ }
    setBusy(false);
    if (!res.ok || !body || body.error) { setError(body?.error ?? "Не удалось закрепить — попробуй ещё раз"); return; }
    setAccounts((list) => [...(list ?? []).filter((a) => a.accountId !== body!.accountId), body!]);
    setDraft("");
  }

  async function remove(accountId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/accounts?accountId=${encodeURIComponent(accountId)}`, { method: "DELETE" });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok || body.error) { setError(body.error ?? "Не удалось снять"); return; }
    setAccounts((list) => (list ?? []).filter((a) => a.accountId !== accountId));
  }

  return (
    <div className="mt-5 pt-5 border-t border-violet-900/25">
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <h3 className="text-sm font-semibold text-white">Рекламные кабинеты</h3>
        {accounts && accounts.length > 0 && (
          <span className="text-[11px] text-zinc-600">{accounts.length} шт</span>
        )}
      </div>
      <p className="text-[13px] text-zinc-500 leading-relaxed mb-3">
        По этим кабинетам считается твой расход. Вставь id кабинета — ключ проверит,
        что видит его, и покажет имя. Кабинет, закреплённый за другим, взять нельзя.
      </p>

      {!metaConnected ? (
        <p className="text-[13px] text-zinc-600">Сначала подключи ключ Meta — им и проверяются кабинеты.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            {accounts === null && <span className="text-[13px] text-zinc-600">Загружаю…</span>}
            {accounts?.map((a) => (
              <span key={a.accountId} className={chipCls}>
                <span className="text-zinc-200">{a.accountName}</span>
                <span className="text-[11px] text-zinc-600">{a.accountId}</span>
                <button type="button" disabled={busy} onClick={() => remove(a.accountId)}
                        aria-label="Снять кабинет"
                        className="ml-1 h-5 w-5 rounded-md text-zinc-500 hover:text-red-300 hover:bg-red-900/20 transition disabled:opacity-50">
                  ✕
                </button>
              </span>
            ))}
            {accounts && accounts.length === 0 && (
              <span className="text-[13px] text-amber-200/80">
                Ни одного кабинета — пока их нет, твой расход в отчётах не показывается.
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              placeholder="id кабинета, например 1430143725623036"
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              // Enter добавляет кабинет, а не отправляет форму с ключом вокруг.
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
              className="flex-1 bg-[#0d0b14] border border-violet-900/40 rounded-xl px-4 py-2.5 outline-none focus:border-violet-600/50 transition placeholder:text-zinc-600 text-white text-sm disabled:opacity-50"
            />
            <button type="button" disabled={busy || !draft.trim()} onClick={add}
                    className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-violet-900/40 text-violet-200 hover:bg-violet-900/60 transition disabled:opacity-50">
              {busy ? "Проверяю…" : "Добавить"}
            </button>
          </div>
          <p className="text-[11px] text-zinc-600 mt-2">
            Id — число из адреса кабинета в Ads Manager (<code>act=…</code>), без <code>act_</code>.
          </p>
        </>
      )}

      {error && (
        <div className="mt-3 bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-2.5 text-red-300 text-sm">{error}</div>
      )}
    </div>
  );
}
