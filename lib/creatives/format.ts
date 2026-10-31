export function parseNumber(value: string): number {
  const s = value.replace(/[^0-9.,-]/g, "").trim();
  if (!s || s === "-") return NaN;
  if (s.includes(",") && !s.includes(".")) return parseFloat(s.replace(",", "."));
  return parseFloat(s.replace(/,/g, ""));
}

export function formatSummaryNumber(n: number): string {
  if (isNaN(n) || !isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

export function formatRomiPct(n: number): string {
  if (isNaN(n) || !isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

// Деньги и ROMI на карточках и в модале крео — как везде в дашборде: «$1 360,26», «153,79%».
export function formatUsd(n: number | null, digits = 2): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return n < 0 ? `−$${abs}` : `$${abs}`;
}

export function formatRomi(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}
