import { formatRomi } from "@/lib/creatives/format";

export default function RomiBadge({ value }: { value: number | null }) {
  const colorClass = value === null
    ? "bg-zinc-800 text-zinc-400"
    : value >= 150
    ? "bg-green-900/60 text-green-300 border border-green-700"
    : value >= 0
    ? "bg-yellow-900/60 text-yellow-300 border border-yellow-700"
    : "bg-red-900/60 text-red-300 border border-red-700";

  return (
    <span className={`inline-block text-xs font-bold tabular-nums whitespace-nowrap px-2.5 py-0.5 rounded-full ${colorClass}`}>
      {formatRomi(value)}
    </span>
  );
}
