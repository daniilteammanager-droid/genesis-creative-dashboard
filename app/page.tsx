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

export default function Home() {
  const [rows, setRows] = useState<CreativeRow[]>([]);
  const [media, setMedia] = useState<MediaFile[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CreativeRow | null>(null);
  const [csvLoading, setCsvLoading] = useState(true);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

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

  const filtered = useMemo(() => {
    return rows.filter((item) =>
      item.creative.toLowerCase().includes(search.toLowerCase())
    );
  }, [rows, search]);

  return (
    <main className="min-h-screen bg-black text-white p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-5xl font-bold mb-8">
          Genesis Creative Dashboard
        </h1>

        <input
          type="text"
          placeholder="Поиск крео..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 mb-8 outline-none"
        />

        {error && (
          <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl px-4 py-3 mb-8">
            ⚠ {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden animate-pulse"
              >
                <div className="w-full h-[340px] bg-zinc-800" />
                <div className="p-5 space-y-3">
                  <div className="h-6 bg-zinc-800 rounded w-2/3" />
                  <div className="h-4 bg-zinc-800 rounded w-full" />
                  <div className="h-4 bg-zinc-800 rounded w-5/6" />
                  <div className="h-4 bg-zinc-800 rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filtered.map((item, index) => {
              const itemMedia = findMedia(item.creative, media);

              return (
                <div
                  key={`${item.creative}-${index}`}
                  onClick={() => setSelected(item)}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden cursor-pointer hover:border-zinc-500 transition"
                >
                  <MediaPreview file={itemMedia} />

                  <div className="p-5">
                    <div className="text-2xl font-bold mb-4">
                      {item.creative}
                    </div>

                    <Metrics item={item} />
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
  return (
    <div className="fixed inset-0 bg-black/80 z-50 p-6 overflow-y-auto">
      <div className="max-w-5xl mx-auto bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden">
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
      <div>ROMI: {item.romi}</div>
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