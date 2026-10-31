import type { MediaFile } from "@/lib/creatives/media";
import type { TileMetrics } from "@/lib/creatives/tile";
import { formatUsd } from "@/lib/creatives/format";
import { MediaSquare, MediaWide } from "./CreativeMedia";
import RomiBadge from "./RomiBadge";

// Карточка крео — одна на легаси-библиотеку и новую картотеку (31.10.2026): превью,
// имя, подход, страны, подсказки про файл, ROMI и пять цифр. Цифры готовит lib/creatives/tile.

const TAG = "text-[11px] font-medium px-1.5 py-0.5 rounded-md border whitespace-nowrap";

export default function CreativeTile({
  code, approach, countries, file, exact, geoMismatch, m, favorite, canFavorite, onOpen, onFavorite,
}: {
  code: string;
  approach: string;
  countries?: string[];
  file?: MediaFile;
  exact?: boolean;
  geoMismatch?: boolean;
  m: TileMetrics;
  favorite: boolean;
  canFavorite: boolean;
  onOpen: () => void;
  onFavorite: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      className="card overflow-hidden cursor-pointer hover:border-violet-500/50 hover:shadow-[0_4px_24px_rgb(109_40_217/0.12)] transition"
    >
      {/* ПК: превью сверху */}
      <div className="hidden md:block"><MediaWide file={file} /></div>

      <div className="flex items-start justify-between px-4 pt-4 pb-3 gap-3 border-b border-line">
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold text-white truncate" title={code}>{code}</div>
          <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
            {approach !== "unknown" && <span className={`${TAG} bg-violet-800/35 text-violet-100 border-violet-700/40`}>{approach}</span>}
            {countries?.map((c) => <span key={c} className={`${TAG} bg-zinc-800/60 text-zinc-300 border-zinc-700/40`}>{c}</span>)}
            {file && exact === false && (
              <span title="Точного файла нет — превью подставлено по похожему названию"
                    className={`${TAG} bg-amber-800/25 text-amber-300/90 border-amber-700/40`}>≈ похоже</span>
            )}
            {!file && <span className={`${TAG} bg-zinc-800/60 text-hint border-zinc-700/40`}>файл не загружен</span>}
            {geoMismatch && (
              <span title="Гео в имени не совпало со странами таргета"
                    className={`${TAG} bg-amber-800/25 text-amber-300/90 border-amber-700/40`}>≠ гео</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); if (canFavorite) onFavorite(); }}
            disabled={!canFavorite}
            aria-label={favorite ? "Убрать из избранного" : "В избранное"}
            title={!canFavorite ? "Избранное временно недоступно" : favorite ? "Убрать из избранного" : "В избранное"}
            className={`text-base leading-none transition-colors ${
              !canFavorite ? "text-zinc-700 opacity-30 cursor-not-allowed" : favorite ? "text-yellow-400" : "text-zinc-700 hover:text-yellow-400"
            }`}
          >
            ★
          </button>
          <RomiBadge value={m.romi} />
        </div>
      </div>

      {/* Телефон: квадратное превью и цифры рядом */}
      <div className="flex gap-4 p-4 md:hidden">
        <MediaSquare file={file} />
        <Metrics m={m} />
      </div>
      <div className="hidden md:block px-4 pt-3 pb-4"><Metrics m={m} /></div>
    </div>
  );
}

function Metrics({ m }: { m: TileMetrics }) {
  return (
    <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-4 gap-y-2.5 content-start">
      <Cell label="Спенд" value={formatUsd(m.spend)} strong />
      <Cell label="Ревенью" value={formatUsd(m.revenue)} />
      <Cell label="Цена ПДП" value={formatUsd(m.cpdp)} />
      <Cell label="Цена ДИА" value={formatUsd(m.cdia)} />
      <Cell label="Цена депа" value={formatUsd(m.cdep)} />
    </div>
  );
}

function Cell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-hint leading-none mb-1">{label}</div>
      <div className={`text-sm font-semibold tabular-nums truncate ${strong ? "text-white" : "text-zinc-200"}`}>{value}</div>
    </div>
  );
}
