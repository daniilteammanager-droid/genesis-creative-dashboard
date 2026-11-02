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

// Пока едет ответ на новый фильтр (дата, баер, страна): прежние цифры приглушены и не
// нажимаются, поверх — кружок, видный и в прокрученной таблице. Без этого экран стоял
// как есть, а потом цифры резко менялись (31.10.2026). Фильтры в обёртку не кладём.
export function Busy({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <div className="relative" aria-busy={on}>
      <div className={`transition-opacity ${on ? "opacity-40 pointer-events-none select-none" : ""}`}>{children}</div>
      {on && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="sticky top-[35vh] flex justify-center py-6"><Spinner /></div>
        </div>
      )}
    </div>
  );
}

// Иконки вместо эмодзи: эмодзи на каждой системе своего цвета и размера.
export type IconName = "folder" | "upload" | "save" | "link" | "file" | "repeat" | "film" | "image" | "user" | "users" | "lock"
  | "home" | "tasks" | "archive" | "check" | "pulse" | "chart" | "table" | "rocket" | "shield" | "layers" | "wallet";
const PATHS: Record<IconName, string[]> = {
  folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  upload: ["M12 15V3", "m7 8 5-5 5 5", "M5 21h14"],
  save: ["M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M7 3v5h8", "M7 21v-7h10v7"],
  link: ["M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7", "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"],
  file: ["M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z", "M14 3v6h6"],
  repeat: ["m17 2 4 4-4 4", "M3 11V9a3 3 0 0 1 3-3h15", "m7 22-4-4 4-4", "M21 13v2a3 3 0 0 1-3 3H3"],
  film: ["M4 4h16v16H4z", "M8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4"],
  image: ["M4 5h16v14H4z", "m4 16 5-5 4 4 3-3 4 4", "M15 9.5h.01"],
  user: ["M20 21a8 8 0 0 0-16 0", "M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  users: ["M16 21a6 6 0 0 0-12 0", "M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M22 21a6 6 0 0 0-4-5.7", "M15 4.2a4 4 0 0 1 0 7.6"],
  lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"],
  // Разделы левой панели (lib/nav.ts).
  home: ["M3 10.5 12 3l9 7.5", "M5 9v12h14V9", "M10 21v-6h4v6"],
  tasks: ["m9 11 3 3L22 4", "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"],
  archive: ["M3 4h18v4H3z", "M5 8v12h14V8", "M10 12h4"],
  check: ["M8 2h8v4H8z", "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2", "m9 14 2 2 4-4"],
  pulse: ["M22 12h-4l-3 9L9 3l-3 9H2"],
  chart: ["M3 3v18h18", "M8 17v-5", "M13 17V7", "M18 17v-8"],
  table: ["M3 3h18v18H3z", "M3 9h18", "M3 15h18", "M9 9v12"],
  rocket: [
    "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z",
    "m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",
    "M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0",
    "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",
  ],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "m9 12 2 2 4-4"],
  layers: ["M12 2 2 7l10 5 10-5z", "m2 17 10 5 10-5", "m2 12 10 5 10-5"],
  wallet: ["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1", "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"],
};

export function Icon({ name, className = "w-4 h-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`flex-none ${className}`}>
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
