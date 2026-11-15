// Тема интерфейса (15.11.2026): тёмная по умолчанию, светлая или как в системе.
// Хранится в profiles.theme — едет за человеком на телефон и другой компьютер.
// Layout ставит <html data-theme> на сервере, поэтому страница не мигает тёмным;
// «как в системе» сервер не знает — решает THEME_SCRIPT в <head> до первой отрисовки.
// Цвета обеих тем — app/globals.css.

export type ThemePref = "dark" | "light" | "system";

export const THEMES: { id: ThemePref; label: string }[] = [
  { id: "dark", label: "Тёмная" },
  { id: "light", label: "Светлая" },
  { id: "system", label: "Как в системе" },
];

export const themeOf = (v: string | null | undefined): ThemePref => (v === "light" || v === "system" ? v : "dark");

// «Как в системе»: тема по prefers-color-scheme и следом за её сменой (вечером телефон темнеет).
// Слушатель стоит всегда и смотрит на выбор в момент смены: выбрал «как в системе» без
// перезагрузки — работает и так.
export const THEME_SCRIPT = `(function(){var d=document.documentElement,m=matchMedia("(prefers-color-scheme: light)");function f(){if(d.dataset.themePref==="system")d.dataset.theme=m.matches?"light":"dark"}f();m.addEventListener("change",f)})()`;

// Сразу после выбора в настройках — без перезагрузки.
export function applyTheme(pref: ThemePref) {
  const d = document.documentElement;
  d.dataset.themePref = pref;
  d.dataset.theme = pref === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : pref;
}
