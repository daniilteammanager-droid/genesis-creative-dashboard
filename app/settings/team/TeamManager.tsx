"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/client";
import { ROLE_LABELS, normalizeBuyerCode, type Profile, type UserRole } from "@/lib/auth/types";

// Две таблицы баера: General 3.0 (старый формат) и 4.0 (новый). Каждая — своё
// поле профиля и своя пара аргументов admin_update_profile.
const SHEET_FIELDS = {
  gr:  { label: "General 3.0", column: "gr_spreadsheet_id",  set: "p_gr_sheet",  clear: "p_clear_gr" },
  gr4: { label: "General 4.0", column: "gr4_spreadsheet_id", set: "p_gr4_sheet", clear: "p_clear_gr4" },
} as const;
type SheetField = keyof typeof SHEET_FIELDS;

export default function TeamManager({ people, meId }: { people: Profile[]; meId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Код правится в поле и уходит по Enter или потере фокуса, а не на каждый символ.
  const [codeDraft, setCodeDraft] = useState<Record<string, string>>({});
  // Черновики таблиц по ключу «id|поле»: у баера их две — General 3.0 и 4.0.
  const [sheetDraft, setSheetDraft] = useState<Record<string, string>>({});
  // Месячный лимит AI-разборов баера (Decision 101) — своя таблица, мимо admin_update_profile.
  const [budgets, setBudgets] = useState<Record<string, { limit: number; used: number }>>({});
  const [budgetDraft, setBudgetDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/api/ai/budget").then((r) => r.json()).then((j) => j.budgets && setBudgets(j.budgets)).catch(() => {});
  }, []);

  async function commitBudget(id: string) {
    const raw = budgetDraft[id];
    if (raw === undefined || Number(raw) === budgets[id]?.limit) return;
    setBusy(id); setError(null); setSaved(null);
    const r = await fetch("/api/ai/budget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buyer: id, usd: Number(raw.replace(",", ".")) }) })
      .then((x) => x.json()).catch(() => ({ error: "Не сохранилось" }));
    setBusy(null);
    setBudgetDraft((d) => { const rest = { ...d }; delete rest[id]; return rest; });
    if (r.error) { setError(r.error); return; }
    setBudgets((b) => ({ ...b, [id]: r.budget }));
    setSaved(id);
  }

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
      // Черновики откатываем: иначе поле продолжает показывать то, что база не
      // приняла, и выглядит это как сохранённое значение.
      setCodeDraft((d) => { const rest = { ...d }; delete rest[id]; return rest; });
      setSheetDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(`${id}|`))));
      return;
    }
    setSaved(id);
    router.refresh();
  }

  // Таблицу проверяем до записи: непошаренная на сервисный аккаунт таблица
  // сохранится молча и обернётся пустым отчётом через неделю.
  async function commitSheet(p: Profile, which: SheetField) {
    const { column, set, clear } = SHEET_FIELDS[which];
    const key = `${p.id}|${which}`;
    const draft = (sheetDraft[key] ?? "").trim();
    if (draft === (p[column] ?? "")) return;

    if (draft === "") { update(p.id, { [clear]: true }); return; }

    setBusy(p.id);
    setError(null);
    setSaved(null);

    let ok = false;
    let problem = "Таблица не читается";
    try {
      const res = await fetch("/api/sheets/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetId: draft }),
      });
      ok = res.ok;
      if (!ok) {
        // Ответ не всегда JSON: упавшая функция отдаёт HTML. Без try строка
        // осталась бы заблокированной навсегда — busy никто бы не снял.
        try {
          const d = (await res.json()) as { error?: string };
          if (d.error) problem = d.error;
        } catch { /* не JSON — оставляем общий текст */ }
      }
    } catch {
      problem = "Не удалось проверить таблицу — попробуй ещё раз";
    }

    if (!ok) {
      setBusy(null);
      setError(problem);
      setSheetDraft((s) => { const rest = { ...s }; delete rest[key]; return rest; });
      return;
    }
    update(p.id, { [set]: draft });
  }

  function commitCode(p: Profile) {
    const draft = normalizeBuyerCode(codeDraft[p.id] ?? "");
    if (draft === (p.buyer_code ?? "")) return;
    update(p.id, draft === "" ? { p_clear_code: true } : { p_buyer_code: draft });
  }


  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      <div className="card divide-y divide-line">
        {people.length === 0 && <p className="text-sm text-hint p-5">Пока никого нет.</p>}

        {people.map((p) => {
          const isMe = p.id === meId;
          return (
            <div key={p.id} className="flex items-center gap-3 px-5 py-3.5 flex-wrap">
              <div className="min-w-[180px] flex-1">
                <p className="text-sm text-zinc-200 truncate">
                  {p.name || "без имени"}
                  {isMe && <span className="text-violet-400/70 ml-1.5 text-[11px]">это ты</span>}
                </p>
                <p className="text-[11px] text-hint truncate">{p.email}</p>
              </div>

              <select
                value={p.role}
                disabled={busy === p.id}
                onChange={(e) => update(p.id, { p_role: e.target.value as UserRole })}
                className={`field cursor-pointer disabled:opacity-50`}
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
                className={`field w-20 disabled:opacity-50`}
              />

              <button
                disabled={busy === p.id || isMe}
                onClick={() => update(p.id, { p_status: p.status === "active" ? "disabled" : "active" })}
                title={isMe ? "Себя отключить нельзя" : undefined}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition disabled:opacity-40 ${
                  p.status === "active"
                    ? "bg-green-900/30 text-green-400 border-green-800/30 hover:border-green-600/50"
                    : "bg-zinc-800/50 text-hint border-zinc-700/40 hover:border-zinc-500/50"
                }`}
              >
                {p.status === "active" ? "активен" : "отключён"}
              </button>

              <span className="text-[11px] w-16 text-right">
                {busy === p.id ? <span className="text-hint">…</span>
                 : saved === p.id ? <span className="text-green-400">сохранено</span>
                 : null}
              </span>

              {/* Таблицы General подключает владелец: таблицы его и доступ к ним
                  выдаёт он, баеру там нечего вводить. */}
              {p.role === "buyer" && (Object.keys(SHEET_FIELDS) as SheetField[]).map((which) => (
                <div key={which} className="w-full flex items-center gap-2">
                  <span className="text-[11px] text-hint whitespace-nowrap w-[72px]">{SHEET_FIELDS[which].label}</span>
                  <input
                    type="text"
                    placeholder="ключ таблицы"
                    value={sheetDraft[`${p.id}|${which}`] ?? p[SHEET_FIELDS[which].column] ?? ""}
                    disabled={busy === p.id}
                    onChange={(e) => setSheetDraft((s) => ({ ...s, [`${p.id}|${which}`]: e.target.value }))}
                    onBlur={() => commitSheet(p, which)}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    className={`field flex-1 min-w-0 disabled:opacity-50`}
                  />
                </div>
              ))}
              {p.role === "buyer" && budgets[p.id] && (
                <div className="w-full flex items-center gap-2">
                  <span className="text-[11px] text-hint whitespace-nowrap w-[72px]">AI-лимит</span>
                  <span className="text-sm text-hint">$</span>
                  <input
                    type="text" inputMode="decimal"
                    value={budgetDraft[p.id] ?? String(budgets[p.id].limit)}
                    disabled={busy === p.id}
                    onChange={(e) => setBudgetDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                    onBlur={() => commitBudget(p.id)}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    className={`field w-20 disabled:opacity-50`}
                  />
                  <span className="text-[11px] text-hint">в месяц · потрачено ${budgets[p.id].used.toFixed(2)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-hint leading-relaxed">
        Код баера — вида <code className="text-hint">b5</code> или просто <code className="text-hint">5</code>,
        пустое поле убирает код. Последнего владельца разжаловать нельзя, иначе администрировать станет некому.
        Таблицы General 3.0 и 4.0 проверяются при сохранении: если она не открыта на чтение сервисному аккаунту,
        сохранить её не получится. AI-лимит — сколько долларов в месяц баер может потратить на AI-разборы своих крео
        (кнопка в «Отчётах» и автоматические разборы в Telegram); разборы, которые запускаешь ты, в него не идут.
      </p>
    </div>
  );
}
