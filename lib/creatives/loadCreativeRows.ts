import Papa from "papaparse";
import type { CreativeRow } from "./types";

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSr4-3RDwlc7vXIbnBBkZVO9UY8QOxzqSYLceOCU-aHAHM3ETMQP9g7LMtDZORuyafkvAvm4TmCEawl/pub?gid=1832093387&single=true&output=csv";

// Fetches and parses the main analytics CSV — the one true source for "Creative Code"
// + its all-time Spend/Revenue/Deposits/ROMI. Shared by the Creative Library page and
// Reports (Ads mode opens this same data for a clicked creative's all-time view).
export async function loadCreativeRows(): Promise<CreativeRow[]> {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`CSV: ошибка сети ${res.status}`);
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
