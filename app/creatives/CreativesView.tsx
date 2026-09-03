"use client";

import { useState } from "react";
import CreativeCards from "./CreativeCards";
import CreativesTable from "./CreativesTable";

// Плитка по умолчанию — раздел про сами креативы, и смотрят их глазами.
// Таблица рядом: когда нужно быстро сравнить цифры столбцом, она удобнее.
// Reports пользуется той же таблицей отдельно, там плитки нет намеренно.
export default function CreativesView() {
  const [view, setView] = useState<"cards" | "table">("cards");

  const tab = (on: boolean) =>
    `px-4 py-2 rounded-xl text-sm font-semibold transition ${
      on ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm" : "text-zinc-400 hover:text-violet-300"
    }`;

  return (
    <>
      <div className="flex gap-1 mb-5 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 w-fit">
        <button onClick={() => setView("cards")} className={tab(view === "cards")}>Плитка</button>
        <button onClick={() => setView("table")} className={tab(view === "table")}>Таблица</button>
      </div>
      {view === "cards" ? <CreativeCards /> : <CreativesTable />}
    </>
  );
}
