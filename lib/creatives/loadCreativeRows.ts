import Papa from "papaparse";
import type { CreativeRow } from "./types";

// Fetches and parses the main analytics CSV — the one true source for "Creative Code"
// + its all-time Spend/Revenue/Deposits/ROMI. Used by the legacy Creative Library.
// Идёт через /api/legacy: он проверяет доступ к легаси (Decision 119) и прячет адрес таблицы.
export async function loadCreativeRows(): Promise<CreativeRow[]> {
  const res = await fetch("/api/legacy", { cache: "no-store" });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `CSV: ошибка сети ${res.status}`);
  const text = await res.text();

  const result = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
  const allRows = result.data;

  const headerIndex = allRows.findIndex((row) => row.some((cell) => cell.trim() === "Creative Code"));
  if (headerIndex === -1) throw new Error("CSV: строка с заголовком 'Creative Code' не найдена");

  const headers = allRows[headerIndex].map((h) => h.trim());
  const dataRows = allRows.slice(headerIndex + 1);

  const get = (row: string[], name: string) => {
    const i = headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    return i >= 0 ? (row[i] ?? "").trim() : "";
  };

  return dataRows
    .map((row) => ({
      creative: get(row, "Creative Code"),
      spend:    get(row, "Spend"),
      revenue:  get(row, "Revenue"),
      deposits: get(row, "Deposits"),
      pdp:      get(row, "Цена пдп"),
      dia:      get(row, "Цена Диа"),
      romi:     get(row, "ROMI"),
      text:     get(row, "TEXT"),
    }))
    .filter((item) => item.creative);
}
