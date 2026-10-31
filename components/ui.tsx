// Общие кусочки интерфейса. Внешний вид — классы в app/globals.css (card, field, btn,
// seg, chip, label), здесь только то, что удобнее отдать функцией или компонентом.

// Кнопка переключателя внутри `seg`: <button {...seg(view === "cards")}>. Выбранная
// отмечается aria-pressed — по нему её подсвечивает CSS и слышит экранный чтец.
export const seg = (on: boolean) => ({ className: "seg-btn", "aria-pressed": on });

// Чип фильтра, где выбранных может быть несколько: <button {...chip(on)}>.
export const chip = (on: boolean) => ({ className: "chip", "aria-pressed": on });

export function Spinner({ small = false }: { small?: boolean }) {
  return (
    <span
      role="status"
      aria-label="Загрузка"
      className={`inline-block rounded-full border-2 border-violet-600/40 border-t-violet-400 animate-spin ${small ? "w-4 h-4" : "w-10 h-10"}`}
    />
  );
}

// Иконки вместо эмодзи: эмодзи на каждой системе своего цвета и размера.
type IconName = "folder" | "upload" | "save" | "link" | "file" | "repeat" | "film" | "image";
const PATHS: Record<IconName, string[]> = {
  folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  upload: ["M12 15V3", "m7 8 5-5 5 5", "M5 21h14"],
  save: ["M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M7 3v5h8", "M7 21v-7h10v7"],
  link: ["M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7", "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"],
  file: ["M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z", "M14 3v6h6"],
  repeat: ["m17 2 4 4-4 4", "M3 11V9a3 3 0 0 1 3-3h15", "m7 22-4-4 4-4", "M21 13v2a3 3 0 0 1-3 3H3"],
  film: ["M4 4h16v16H4z", "M8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4"],
  image: ["M4 5h16v14H4z", "m4 16 5-5 4 4 3-3 4 4", "M15 9.5h.01"],
};

export function Icon({ name, className = "w-4 h-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`flex-none ${className}`}>
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
