"use client";

import { useState } from "react";
import ReportTree from "./ReportTree";
import CreativesTable from "@/app/creatives/CreativesTable";
import { seg } from "@/components/ui";

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
    <main className="min-h-screen bg-background text-white p-4 md:p-8">
      <div className="w-full">
        <h1 className="page-title mb-6">Live Manager</h1>

        <div data-tour="reports-views" className="seg mb-6">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              {...seg(view === v.id)}
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
