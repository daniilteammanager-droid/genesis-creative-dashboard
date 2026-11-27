// Комментарий заявки (27.11.2026, Даниил: «ссылки не кликабельны, всё в одну строку»): строки, списки и ссылки.
// Чистые функции — ими пользуются страница (вид и поле ввода) и сообщение в платёжном чате (requests.ts).

// Пункт списка: «- текст», «• текст», «1. текст», «2) текст». Один «-» без текста — не пункт: это «нечего добавить».
const ITEM = /^(\s*)([-–—•*]|(\d+)([.)]))\s+(.*)$/;

export type Block = { kind: "p"; text: string } | { kind: "ul"; items: string[] } | { kind: "ol"; items: string[]; start: number };

// Текст → абзацы и списки: каждая строка — свой абзац, подряд идущие пункты — один список.
export function blocksOf(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const m = raw.match(ITEM);
    const last = out[out.length - 1];
    if (m && !m[3]) {
      if (last?.kind === "ul") last.items.push(m[5].trim()); else out.push({ kind: "ul", items: [m[5].trim()] });
    } else if (m) {
      if (last?.kind === "ol") last.items.push(m[5].trim()); else out.push({ kind: "ol", items: [m[5].trim()], start: Number(m[3]) });
    } else if (raw.trim()) out.push({ kind: "p", text: raw.trim() });
  }
  return out;
}

// Строка → куски текста и ссылки http(s). Точка, запятая или скобка в конце — не часть ссылки.
export function linksOf(s: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  let i = 0;
  for (const m of s.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const url = m[0].replace(/[.,;:!?)\]»]+$/, "");
    if (m.index! > i) out.push({ text: s.slice(i, m.index) });
    out.push({ text: url, href: url });
    i = m.index! + url.length;
  }
  if (i < s.length) out.push({ text: s.slice(i) });
  return out;
}

// Enter в поле комментария: строка — пункт списка → новая строка с тем же маркером (номер + 1);
// пустой пункт — список закончен, маркер убирается. null — обычный Enter.
export function continueList(value: string, caret: number): { value: string; caret: number } | null {
  const start = value.lastIndexOf("\n", caret - 1) + 1;
  const m = value.slice(start, caret).match(ITEM);
  if (!m) return null;
  if (!m[5].trim()) return { value: value.slice(0, start) + value.slice(caret), caret: start };
  const ins = `\n${m[1]}${m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2]} `;
  return { value: value.slice(0, caret) + ins + value.slice(caret), caret: caret + ins.length };
}
