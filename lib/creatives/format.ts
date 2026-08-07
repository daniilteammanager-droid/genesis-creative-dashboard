export function parseNumber(value: string): number {
  const s = value.replace(/[^0-9.,-]/g, "").trim();
  if (!s || s === "-") return NaN;
  if (s.includes(",") && !s.includes(".")) return parseFloat(s.replace(",", "."));
  return parseFloat(s.replace(/,/g, ""));
}

export function formatSummaryNumber(n: number): string {
  if (isNaN(n) || !isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

export function formatRomiPct(n: number): string {
  if (isNaN(n) || !isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}
