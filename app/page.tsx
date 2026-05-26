"use client";

import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSr4-3RDwlc7vXIbnBBkZVO9UY8QOxzqSYLceOCU-aHAHM3ETMQP9g7LMtDZORuyafkvAvm4TmCEawl/pub?gid=1832093387&single=true&output=csv";

type CreativeRow = {
  creative: string;
  spend: string;
  revenue: string;
  deposits: string;
  pdp: string;
  dia: string;
  romi: string;
  text: string;
};

type MediaFile = {
  key: string;
  url: string;
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\.(mov|mp4|jpg|jpeg|png|webp)$/i, "");
}

function getFileBaseName(key: string) {
  const fileName = key.split("/").pop() || "";
  return normalize(fileName);
}

function isVideo(url: string) {
  return /\.(mov|mp4)$/i.test(url);
}

function isImage(url: string) {
  return /\.(jpg|jpeg|png|webp)$/i.test(url);
}

function findMedia(creative: string, media: MediaFile[]) {
  const creativeKey = normalize(creative);

  return media.find((file) => {
    const baseName = getFileBaseName(file.key);
    return baseName === creativeKey;
  });
}

// Превращает строку вида "1 234,56", "$1,234.56", "150%", "-50%" в число.
function parseNumber(value: string): number {
  const s = value.replace(/[^0-9.,-]/g, "").trim();
  if (!s || s === "-") return NaN;
  // Запятая без точки → десятичный разделитель ("1,5" = 1.5)
  if (s.includes(",") && !s.includes(".")) {
    return parseFloat(s.replace(",", "."));
  }
  // Иначе запятая — разделитель тысяч ("1,234.56")
  return parseFloat(s.replace(/,/g, ""));
}

// "QA/QA-1.mp4" → "QA",  "STATICSOFT-ES/file.png" → "STATICSOFT-ES",  "file.mp4" → "unknown"
function getApproach(key: string): string {
  const slash = key.indexOf("/");
  return slash > 0 ? key.slice(0, slash) : "unknown";
}

export default function Home() {
  const [rows, setRows] = useState<CreativeRow[]>([]);
  const [media, setMedia] = useState<MediaFile[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CreativeRow | null>(null);
  const [csvLoading, setCsvLoading] = useState(true);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "win" | "lose" | "test">("all");
  const [activeApproach, setActiveApproach] = useState("all");
  const [activeSort, setActiveSort] = useState<"none" | "romi" | "spend" | "deposits">("none");

  useEffect(() => {
    async function loadCSV() {
      try {
        const res = await fetch(CSV_URL);
        if (!res.ok) throw new Error(`CSV: ошибка сети ${res.status}`);
        const text = await res.text();

        // Парсим без header:true — Papa обрабатывает кавычки/запятые/переносы,
        // а строку-заголовок ищем сами (таблица может иметь служебные строки выше).
        const result = Papa.parse<string[]>(text, {
          header: false,
          skipEmptyLines: true,
        });

        const allRows = result.data;

        const headerIndex = allRows.findIndex((row) =>
          row.some((cell) => cell.trim() === "Creative Code")
        );

        if (headerIndex === -1) {
          throw new Error("CSV: строка с заголовком 'Creative Code' не найдена");
        }

        const headers = allRows[headerIndex].map((h) => h.trim());
        const dataRows = allRows.slice(headerIndex + 1);

        const get = (row: string[], name: string) => {
          const i = headers.findIndex(
            (h) => h.toLowerCase() === name.toLowerCase()
          );
          return i >= 0 ? (row[i] ?? "").trim() : "";
        };

        const formatted = dataRows
          .map((row) => ({
            creative: get(row, "Creative Code"),
            spend: get(row, "Spend"),
            revenue: get(row, "Revenue"),
            deposits: get(row, "Deposits"),
            pdp: get(row, "Цена пдп"),
            dia: get(row, "Цена Диа"),
            romi: get(row, "ROMI"),
            text: get(row, "TEXT"),
          }))
          .filter((item) => item.creative);

        setRows(formatted);
      } catch (e) {
        setCsvError(e instanceof Error ? e.message : "Не удалось загрузить данные");
      } finally {
        setCsvLoading(false);
      }
    }

    async function loadMedia() {
      try {
        const res = await fetch("/api/media");
        if (!res.ok) throw new Error(`Media: ошибка сети ${res.status}`);
        const data = await res.json();
        setMedia(Array.isArray(data) ? data : []);
      } catch (e) {
        setMediaError(e instanceof Error ? e.message : "Не удалось загрузить медиа");
      } finally {
        setMediaLoading(false);
      }
    }

    loadCSV();
    loadMedia();
  }, []);

  const loading = csvLoading || mediaLoading;
  const error = csvError || mediaError;

  // Уникальные папки из R2, отсортированные по алфавиту
  const approaches = useMemo(() => {
    const set = new Set(media.map((f) => getApproach(f.key)));
    return Array.from(set).sort();
  }, [media]);

  // Счётчики для вкладок (учитывают поиск и approach, но не активную вкладку)
  const tabCounts = useMemo(() => {
    const base = rows
      .filter((item) =>
        item.creative.toLowerCase().includes(search.toLowerCase())
      )
      .filter((item) => {
        if (activeApproach === "all") return true;
        const file = findMedia(item.creative, media);
        const approach = file ? getApproach(file.key) : "unknown";
        return approach === activeApproach;
      });
    return {
      all: base.length,
      win: base.filter((item) => parseNumber(item.romi) >= 150).length,
      lose: base.filter(
        (item) => parseNumber(item.romi) < 0 && parseNumber(item.spend) > 1000
      ).length,
      test: base.filter((item) => parseNumber(item.spend) < 1000).length,
    };
  }, [rows, search, activeApproach, media]);

  const filtered = useMemo(() => {
    const sortFn = (a: CreativeRow, b: CreativeRow) => {
      if (activeSort === "none") return 0;
      const get = (item: CreativeRow) => {
        if (activeSort === "romi") return parseNumber(item.romi);
        if (activeSort === "spend") return parseNumber(item.spend);
        if (activeSort === "deposits") return parseNumber(item.deposits);
        return 0;
      };
      const aVal = get(a);
      const bVal = get(b);
      if (isNaN(aVal) && isNaN(bVal)) return 0;
      if (isNaN(aVal)) return 1;   // NaN — в конец
      if (isNaN(bVal)) return -1;
      return bVal - aVal;          // по убыванию
    };

    return rows
      .filter((item) =>
        item.creative.toLowerCase().includes(search.toLowerCase())
      )
      .filter((item) => {
        if (activeTab === "all") return true;
        const romi = parseNumber(item.romi);
        const spend = parseNumber(item.spend);
        if (activeTab === "win") return romi >= 150;
        if (activeTab === "lose") return romi < 0 && spend > 1000;
        if (activeTab === "test") return spend < 1000;
        return true;
      })
      .filter((item) => {
        if (activeApproach === "all") return true;
        const file = findMedia(item.creative, media);
        const approach = file ? getApproach(file.key) : "unknown";
        return approach === activeApproach;
      })
      .sort(sortFn);
  }, [rows, search, activeTab, activeApproach, activeSort, media]);

  return (
    <main className="min-h-screen bg-black text-white p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-5xl font-bold mb-8">
          Genesis Creative Dashboard
        </h1>

        <div className="sticky top-0 z-20 -mx-8 px-8 pt-4 pb-4 mb-6 bg-black/85 backdrop-blur-md border-b border-zinc-800/50">
          <input
            type="text"
            placeholder="Поиск крео..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 mb-3 outline-none"
          />

          <div className="flex items-center gap-2 flex-wrap">
          {(["all", "win", "lose", "test"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold capitalize transition flex items-center gap-1.5 ${
                activeTab === tab
                  ? "bg-white text-black"
                  : "bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
              }`}
            >
              {tab}
              <span className={`text-xs font-normal tabular-nums ${
                activeTab === tab ? "text-black/50" : "text-zinc-600"
              }`}>
                {tabCounts[tab]}
              </span>
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <select
              value={activeSort}
              onChange={(e) => setActiveSort(e.target.value as typeof activeSort)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-xl px-3 py-2 outline-none cursor-pointer hover:border-zinc-600 transition"
            >
              <option value="none">Sort: default</option>
              <option value="romi">ROMI ↓</option>
              <option value="spend">Spend ↓</option>
              <option value="deposits">Deposits ↓</option>
            </select>

            <select
              value={activeApproach}
              onChange={(e) => setActiveApproach(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-xl px-3 py-2 outline-none cursor-pointer hover:border-zinc-600 transition"
            >
              <option value="all">All approaches</option>
              {approaches.map((ap) => (
                <option key={ap} value={ap}>{ap}</option>
              ))}
            </select>

            {(search !== "" || activeTab !== "all" || activeApproach !== "all" || activeSort !== "none") && (
              <button
                onClick={() => {
                  setSearch("");
                  setActiveTab("all");
                  setActiveApproach("all");
                  setActiveSort("none");
                }}
                className="px-3 py-2 rounded-xl text-sm text-zinc-400 border border-zinc-800 hover:text-white hover:border-zinc-600 transition"
              >
                ✕ Сбросить
              </button>
            )}
          </div>
        </div>
        </div>

        {error && (
          <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl px-4 py-3 mb-8">
            ⚠ {error}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col gap-3 md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 md:gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden animate-pulse"
              >
                {/* desktop: media at top */}
                <div className="hidden md:block aspect-square bg-zinc-800" />
                {/* header */}
                <div className="flex items-center justify-between px-4 pt-4 pb-3 gap-3">
                  <div className="h-4 bg-zinc-800 rounded w-2/5" />
                  <div className="h-5 w-14 bg-zinc-800 rounded-full" />
                </div>
                {/* mobile: square + metrics row */}
                <div className="flex gap-3 px-4 pb-4 md:hidden">
                  <div className="w-24 h-24 flex-shrink-0 rounded-xl bg-zinc-800" />
                  <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-3 content-start">
                    <div className="h-3 bg-zinc-800 rounded" />
                    <div className="h-3 bg-zinc-800 rounded" />
                    <div className="h-3 bg-zinc-800 rounded" />
                    <div className="h-3 bg-zinc-800 rounded" />
                    <div className="h-3 bg-zinc-800 rounded" />
                  </div>
                </div>
                {/* desktop: metrics below header */}
                <div className="hidden md:block px-4 pb-4">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div className="h-3 bg-zinc-800 rounded" />
                    <div className="h-3 bg-zinc-800 rounded" />
                    <div className="h-3 bg-zinc-800 rounded" />
                    <div className="h-3 bg-zinc-800 rounded" />
                    <div className="h-3 bg-zinc-800 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3 md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 md:gap-4">
            {filtered.map((item, index) => {
              const itemMedia = findMedia(item.creative, media);
              const itemApproach = itemMedia ? getApproach(itemMedia.key) : "unknown";

              return (
                <div
                  key={`${item.creative}-${index}`}
                  onClick={() => setSelected(item)}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden cursor-pointer hover:border-zinc-500 transition"
                >
                  {/* desktop only: full-width media at top */}
                  <div className="hidden md:block">
                    <MediaWide file={itemMedia} />
                  </div>

                  {/* header: always visible */}
                  <div className="flex items-center justify-between px-4 pt-4 pb-3 gap-3 border-b border-zinc-800/60">
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-bold truncate">{item.creative}</div>
                      {itemApproach !== "unknown" && (
                        <div className="text-xs text-zinc-500 mt-0.5 truncate">{itemApproach}</div>
                      )}
                    </div>
                    <RomiBadge value={item.romi} />
                  </div>

                  {/* mobile only: square preview + metrics side by side */}
                  <div className="flex gap-4 p-4 md:hidden">
                    <MediaSquare file={itemMedia} />
                    <MetricsGrid item={item} />
                  </div>

                  {/* desktop only: metrics below header */}
                  <div className="hidden md:block px-4 pt-3 pb-4">
                    <MetricsGrid item={item} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <CreativeModal
          item={selected}
          mediaFile={findMedia(selected.creative, media)}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}

function RomiBadge({ value }: { value: string }) {
  const num = parseNumber(value);
  const colorClass = isNaN(num)
    ? "bg-zinc-800 text-zinc-400"
    : num >= 150
    ? "bg-green-900/60 text-green-300 border border-green-700"
    : num >= 0
    ? "bg-yellow-900/60 text-yellow-300 border border-yellow-700"
    : "bg-red-900/60 text-red-300 border border-red-700";

  return (
    <span className={`inline-block text-xs font-bold px-2.5 py-0.5 rounded-full ${colorClass}`}>
      {value || "—"}
    </span>
  );
}

function MediaSquare({ file }: { file?: MediaFile }) {
  const wrapCls = "w-24 h-24 flex-shrink-0 rounded-xl overflow-hidden bg-zinc-800";
  const mediaCls = "w-full h-full object-cover";

  if (!file) {
    return (
      <div className={`${wrapCls} flex items-center justify-center text-zinc-600 text-lg`}>
        —
      </div>
    );
  }

  if (isVideo(file.url)) {
    return (
      <div className={wrapCls}>
        <video src={file.url} muted loop playsInline className={mediaCls} />
      </div>
    );
  }

  if (isImage(file.url)) {
    return (
      <div className={wrapCls}>
        <img src={file.url} alt="" className={mediaCls} />
      </div>
    );
  }

  return (
    <div className={`${wrapCls} flex items-center justify-center text-zinc-600 text-lg`}>
      —
    </div>
  );
}

function MediaWide({ file }: { file?: MediaFile }) {
  const wrapCls = "w-full aspect-square bg-zinc-800";
  const mediaCls = "w-full h-full object-cover";

  if (!file) {
    return (
      <div className={`${wrapCls} flex items-center justify-center text-zinc-600 text-2xl`}>
        —
      </div>
    );
  }

  if (isVideo(file.url)) {
    return (
      <div className={wrapCls}>
        <video src={file.url} muted loop playsInline className={mediaCls} />
      </div>
    );
  }

  if (isImage(file.url)) {
    return (
      <div className={wrapCls}>
        <img src={file.url} alt="" className={mediaCls} />
      </div>
    );
  }

  return (
    <div className={`${wrapCls} flex items-center justify-center text-zinc-600 text-2xl`}>
      —
    </div>
  );
}

function MetricsGrid({ item }: { item: CreativeRow }) {
  return (
    <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-4 gap-y-2 content-start">
      <MetricCell label="Spend" value={item.spend} emphasis />
      <MetricCell label="Revenue" value={item.revenue} />
      <MetricCell label="Deposits" value={item.deposits} />
      <MetricCell label="Цена PDP" value={item.pdp} />
      <MetricCell label="Цена DIA" value={item.dia} />
    </div>
  );
}

function MetricCell({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div className="text-zinc-500 text-xs leading-none mb-0.5">{label}</div>
      <div className={`text-sm font-semibold truncate ${emphasis ? "text-white" : "text-zinc-200"}`}>
        {value || "—"}
      </div>
    </div>
  );
}

function MediaPreview({ file }: { file?: MediaFile }) {
  if (!file) {
    return (
      <div className="w-full h-[340px] bg-zinc-950 flex items-center justify-center text-zinc-600">
        Media not found
      </div>
    );
  }

  if (isVideo(file.url)) {
    return (
      <video
        src={file.url}
        muted
        loop
        playsInline
        className="w-full h-[340px] object-cover bg-zinc-950"
      />
    );
  }

  if (isImage(file.url)) {
    return (
      <img
        src={file.url}
        alt=""
        className="w-full h-[340px] object-cover bg-zinc-950"
      />
    );
  }

  return (
    <div className="w-full h-[340px] bg-zinc-950 flex items-center justify-center text-zinc-600">
      Unsupported media
    </div>
  );
}

function CreativeModal({
  item,
  mediaFile,
  onClose,
}: {
  item: CreativeRow;
  mediaFile?: MediaFile;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="max-w-5xl mx-auto bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-4 p-6 border-b border-zinc-800">
          <div>
            <h2 className="text-4xl font-bold">{item.creative}</h2>
            <p className="text-zinc-400 mt-2">
              Full creative view
            </p>
          </div>

          <button
            onClick={onClose}
            className="bg-zinc-800 hover:bg-zinc-700 rounded-xl px-4 py-2"
          >
            Закрыть
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
          <div className="bg-black flex items-center justify-center min-h-[600px]">
            {mediaFile ? (
              isVideo(mediaFile.url) ? (
                <video
                  src={mediaFile.url}
                  controls
                  autoPlay
                  loop
                  className="w-full h-full max-h-[760px] object-contain"
                />
              ) : (
                <img
                  src={mediaFile.url}
                  alt={item.creative}
                  className="w-full h-full max-h-[760px] object-contain"
                />
              )
            ) : (
              <div className="text-zinc-600">Media not found</div>
            )}
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <BigMetric label="Spend" value={item.spend} />
              <BigMetric label="Revenue" value={item.revenue} />
              <BigMetric label="Deposits" value={item.deposits} />
              <BigMetric label="ROMI" value={item.romi} />
              <BigMetric label="Цена PDP" value={item.pdp} />
              <BigMetric label="Цена DIA" value={item.dia} />
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
              <div className="text-zinc-400 text-sm mb-2">Расшифровка</div>
              {item.text ? (
                <p className="text-zinc-300 text-sm whitespace-pre-wrap leading-relaxed">
                  {item.text}
                </p>
              ) : (
                <p className="text-zinc-600 text-sm">Нет описания</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metrics({ item }: { item: CreativeRow }) {
  return (
    <div className="space-y-2 text-zinc-300">
      <div>Spend: {item.spend}</div>
      <div>Revenue: {item.revenue}</div>
      <div>Deposits: {item.deposits}</div>
      <div>Цена PDP: {item.pdp}</div>
      <div>Цена DIA: {item.dia}</div>
      <div className="flex items-center gap-2">
        <span>ROMI:</span>
        <RomiBadge value={item.romi} />
      </div>
    </div>
  );
}

function BigMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <div className="text-zinc-500 text-sm">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}