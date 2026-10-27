"use client";

import { useEffect, useState } from "react";

// Кабинеты и чьи они — только просмотр. Кабинет принадлежит тому, чей ключ
// его видит, закрепляет загрузка сама (Decision 061). Ручной раздачи нет.

interface AccountRow {
  accountId: string;
  accountName: string;
  ownerUserId: string | null;
  spend: number;
  adCount: number;
  lastSpendDate: string | null;
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/accounts?days=30")
      .then((r) => r.json() as Promise<Data>)
      .then((d) => { if (d.error) throw new Error(d.error); setData(d); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, []);

  const label = (id: string | null) => (id ? data?.buyers.find((b) => b.id === id)?.label ?? "—" : null);

  return (
    <div className="mt-10">
      <h2 className="text-lg font-semibold text-white mb-1">Рекламные кабинеты</h2>
      <p className="text-zinc-500 text-sm mb-4">
        Кабинет принадлежит тому, чей ключ Meta его видит — закрепляется сам при загрузке.
        По этому делится расход в Live Manager, Креативах и чеке.
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

      {data && !loading && (data.accounts.length === 0 ? (
        <p className="text-zinc-500 text-sm">Кабинетов пока нет — появятся, когда кто-то подключит ключ Meta.</p>
      ) : (
        <div className="bg-[#111118] border border-violet-900/30 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-violet-900/25">
                {["Кабинет", "Чей", "Расход за 30 дней", "Объявлений"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-violet-900/15">
              {data.accounts.map((a) => (
                <tr key={a.accountId}>
                  <td className="px-4 py-3">
                    <p className="text-zinc-200">{a.accountName}</p>
                    <p className="text-[11px] text-zinc-600">{a.accountId}</p>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{label(a.ownerUserId) ?? <span className="text-zinc-600">ничей</span>}</td>
                  <td className="px-4 py-3 text-zinc-200 whitespace-nowrap">{a.spend > 0 ? money(a.spend) : <span className="text-zinc-600">—</span>}</td>
                  <td className="px-4 py-3 text-zinc-400">{a.adCount || <span className="text-zinc-600">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
