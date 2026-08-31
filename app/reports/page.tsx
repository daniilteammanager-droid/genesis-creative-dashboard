"use client";

import { useState } from "react";
import ReportTree from "./ReportTree";
import CreativesTable from "@/app/creatives/CreativesTable";

// Reports — аналог FB Tool: смотреть свою статистику в двух разрезах.
//
// Раньше здесь было деление на Auto и Manual. Auto ходил в Meta на каждое
// открытие отчёта, то есть тратил лимит пропорционально просмотрам; теперь всё
// читается из склада, который наполняет крон (Decision 040). Manual переезжает
// в Checks запасным путём на случай проблем с токеном — там ему и место, потому
// что чек как раз и собирают руками, когда что-то сломалось.

type View = "campaigns" | "creatives";

const VIEWS: { id: View; label: string }[] = [
  { id: "campaigns", label: "По кампаниям" },
  { id: "creatives", label: "По креативам" },
];

export default function ReportsPage() {
  const [view, setView] = useState<View>("campaigns");

  return (
    <main className="min-h-screen bg-[#0a080f] text-white p-8">
      <div className="max-w-screen-2xl mx-auto">
        <h1 className="text-white text-3xl font-semibold tracking-wide mb-6">Reports</h1>

        <div className="flex gap-1 mb-6 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 w-fit">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition ${
                view === v.id
                  ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm"
                  : "text-zinc-400 hover:text-violet-300"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {view === "campaigns" ? <ReportTree /> : <CreativesTable />}
      </div>
    </main>
  );
}
