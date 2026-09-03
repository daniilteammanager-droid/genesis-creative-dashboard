"use client";

import { useEffect, useState } from "react";

// Раздача рекламных кабинетов баерам.
//
// Разграничение по кабинету, а не по тому, чей токен принёс строку: токены
// баеров сняты с аккаунта владельца и видят все кабинеты команды, поэтому
// «чьими ключами добыто» ничего не разделяет (Decision 052).
//
// Подсказка рядом с кабинетом — сколько его объявлений нашлось в личной
// выгрузке Torro каждого баера. Это подсказка, а не решение: ставит человек.

interface AccountRow {
  accountId: string;
  accountName: string;
  spend: number;
  adCount: number;
  lastSpendDate: string | null;
  ownerUserId: string | null;
  hints: { userId: string; matched: number }[];
}

interface Data {
  accounts: AccountRow[];
  buyers: { id: string; label: string }[];
  days: number;
  error?: string;
}

const money = (v: number) =>
  `$${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AccountOwners() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch("/api/accounts?days=30")
      .then((r) => r.json() as Promise<Data>)
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d); setError(null); setLoading(false);
      })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  };

  useEffect(load, []);

  async function assign(accountId: string, ownerUserId: string) {
    setBusy(accountId);
    setError(null);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, ownerUserId: ownerUserId || null }),
    });
    const body = (await res.json()) as { error?: string };
    setBusy(null);
    if (body.error) { setError(body.error); return; }
    load();
  }

  const unassigned = (data?.accounts ?? []).filter((a) => !a.ownerUserId);
  const unassignedSpend = unassigned.reduce((s, a) => s + a.spend, 0);

  return (
    <div className="mt-10">
      <h2 className="text-lg font-semibold text-white mb-1">Рекламные кабинеты</h2>
      <p className="text-zinc-500 text-sm mb-4">
        Кому принадлежит кабинет. По этому и делится расход в Reports, Креативах и чеке —
        ключ Meta для этого не годится: он у всех показывает все кабинеты команды.
      </p>

      {error && (
        <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">{error}</div>
      )}

      {loading && (
        <div className="flex items-center gap-3 text-zinc-500 text-sm py-6">
          <span className="w-4 h-4 rounded-full border-2 border-violet-600/40 border-t-violet-400 animate-spin" />
          Считаю расход по кабинетам за 30 дней…
        </div>
      )}

      {data && !loading && (
        <>
          {unassigned.length > 0 && (
            <div className="bg-amber-950/30 border border-amber-700/30 rounded-xl px-4 py-3 text-amber-200/90 text-sm mb-4">
              Не распределено кабинетов: {unassigned.length}, расход по ним {money(unassignedSpend)}.
              Пока у кабинета нет владельца, его расход не видит ни один баер.
            </div>
          )}

          {data.accounts.length === 0 ? (
            <p className="text-zinc-500 text-sm">
              За 30 дней расхода не было ни в одном кабинете — раздавать пока нечего.
            </p>
          ) : (
            <div className="bg-[#111118] border border-violet-900/30 rounded-2xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-violet-900/25">
                    {["Кабинет", "Расход за 30 дней", "Объявлений", "Чьи крео крутятся", "Владелец"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-violet-900/15">
                  {data.accounts.map((a) => (
                    <tr key={a.accountId} className={`transition ${a.ownerUserId ? "" : "bg-amber-950/10"}`}>
                      <td className="px-4 py-3">
                        <p className="text-zinc-200">{a.accountName}</p>
                        <p className="text-[11px] text-zinc-600">{a.accountId}</p>
                      </td>
                      <td className="px-4 py-3 text-zinc-200 whitespace-nowrap">{money(a.spend)}</td>
                      <td className="px-4 py-3 text-zinc-400">{a.adCount}</td>
                      <td className="px-4 py-3 text-zinc-400 text-[13px]">
                        {a.hints.length === 0 ? (
                          <span className="text-zinc-600">никто не опознан</span>
                        ) : (
                          a.hints.map((h) => {
                            const b = data.buyers.find((x) => x.id === h.userId);
                            return (
                              <span key={h.userId} className="mr-3 whitespace-nowrap">
                                {b?.label ?? h.userId}: <span className="text-violet-300">{h.matched}</span>
                              </span>
                            );
                          })
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={a.ownerUserId ?? ""}
                          disabled={busy === a.accountId}
                          onChange={(e) => assign(a.accountId, e.target.value)}
                          className="bg-[#0d0b14] border border-violet-900/40 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-600/50 transition text-white disabled:opacity-50"
                        >
                          <option value="">— не распределён —</option>
                          {data.buyers.map((b) => (
                            <option key={b.id} value={b.id}>{b.label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[11px] text-zinc-600 mt-3">
            Один кабинет принадлежит одному баеру: иначе его расход попал бы в сводные
            цифры дважды. Менять можно когда угодно, отчёты подхватят сразу.
          </p>
        </>
      )}
    </div>
  );
}
