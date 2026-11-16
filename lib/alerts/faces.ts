import { loadTrafficReport } from "@/lib/traffic-report/load";
import { geoName, MULTI, NO_GEO, REST, romiBand, type Cell, type RomiBand } from "@/lib/traffic-report/build";
import { buildFacesText, facesTree, type CheckRow, type Platform } from "@/lib/warehouse/check";
import { escapeHtml } from "@/lib/telegram/links";
import type { Profile } from "@/lib/auth/types";

// Отчёт «лица → площадки → страны» для чата менеджмента (15.11.2026, попросил Даниил):
// утром за вчера в сводке, днём за сегодня по расписанию авточека.
//
// Цифры — ячейки «Отчётов» (Decision 098), а не разрез чека по странам: там лицо и страна депа
// идут по связке «кампания × объявление» Torro, а чек берёт лицо из всей истории крео. За
// 09–15.11 чек увёл в «Без лица» и «Несколько лиц» $9 900 из $21 700 дохода, «Отчёты» — $5 600,
// и это только депы со старых кампаний без лица в имени. Итог в обоих — весь Torro.

export interface BuyerLine { label: string; spend: number; revenue: number | null; romi: number | null }

// Лицо не узнали — Роман (Даниил, 16.11.2026): без лица в имени — прогревы, тесты Alex и депы старых кампаний
// «T2A …», а продлевали почти только Романа. Только в этом отчёте: «Отчёты» на странице показывают как есть.
const DEFAULT_FACE = "ROMAN";

// Служебное гео — коротко, с иконкой: длинная подпись раздвигает первую колонку и сжимает остальные.
const SPECIAL: Record<string, string> = { [MULTI]: "🌍 Несколько стран", LATAM: "🌎 Латам · мульти", [NO_GEO]: "❔ Без страны", [REST]: "Не разнесено" };

// Ячейки → строки «площадка × лицо × страна». Производные считает buildFacesText из сумм.
export function faceRows(cells: Cell[]): CheckRow[] {
  const by = new Map<string, CheckRow>();
  for (const c of cells) {
    const face = c.face || DEFAULT_FACE;
    const label = /^[A-Z]{2}$/.test(c.geo) ? c.geo : SPECIAL[c.geo] ?? geoName(c.geo);
    const key = `${c.platform}|${face}|${label}`;
    const r = by.get(key) ?? by.set(key, {
      key, label, platform: c.platform, face, dailyBudget: null, spend: 0,
      subscribers: 0, dialogs: 0, revenue: 0, costPdp: null, costDia: null, romi: null,
    }).get(key)!;
    r.spend += c.sums.spend;
    r.subscribers! += c.sums.subs;
    r.dialogs! += c.sums.dia;
    r.revenue! += c.sums.rev;
  }
  return [...by.values()];
}

// Баеры из тех же ячеек: сумма баеров равна итогу отчёта, «не разнесено» Torro — у своего баера.
export function buyerLines(cells: Cell[]): BuyerLine[] {
  const by = new Map<string, { spend: number; revenue: number }>();
  for (const c of cells) {
    const b = by.get(c.buyer) ?? by.set(c.buyer, { spend: 0, revenue: 0 }).get(c.buyer)!;
    b.spend += c.sums.spend;
    b.revenue += c.sums.rev;
  }
  return [...by].map(([label, b]) => ({ label, ...b, romi: b.spend > 0 ? ((b.revenue - b.spend) / b.spend) * 100 : null }));
}

export async function loadFaces(me: Profile, since: string, until: string): Promise<{ rows: CheckRow[]; buyers: BuyerLine[] }> {
  const { cells } = await loadTrafficReport(me, since, until, undefined, { allTime: false });
  return { rows: faceRows(cells), buyers: buyerLines(cells) };
}

// Сообщение: rich — таблица и свёрнутые страны (Bot API 10.1+), text — запасной вид, если Telegram rich не примет.
export interface Rich { rich: string; text: string }

export const facesMessage = (rows: CheckRow[], title: string): Rich =>
  ({ rich: facesRich(rows, title), text: `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(buildFacesText(rows).replace(/(\d),(\d)/g, "$1.$2"))}` });

// Rich message (16.11.2026: текстом отчёт выходил длинным, TG Ads растягивал его вдвое): сверху таблица лиц
// с площадками и итогом, страны каждой площадки — свёрнутым блоком под ней. Цвет ROMI — как в «Отчётах».
//
// Ничего не переносится (16.11.2026, Даниил). Ширину ячейки Telegram задать не даёт и, сжимая таблицу по экрану,
// рвёт ячейку после эмодзи даже через неразрывный пробел («🔴 / −100%»). Поэтому иконка — своей колонкой (флаг,
// 👤, кружок ROMI), пробелы в ячейках неразрывные, подписи короткие: в ячейке не остаётся места для разрыва.
const e = escapeHtml;
// Числа — с точкой, а не запятой (Даниил, 16.11.2026: «24.08»); тысячи — неразрывным пробелом, как у ru-RU.
export const n0 = (v: number) => Math.round(v).toLocaleString("ru-RU");
export const n2 = (v: number | null) =>
  (v === null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(",", "."));
export const nb = (s: string) => s.replace(/ /g, "\u00a0");
// Пустая ячейка — неразрывный пробел: ячейку без текста Telegram не рисует, и рамка таблицы съезжает.
const EMPTY = "\u00a0";
export const td = (v: string) => `<td align="right">${v}</td>`;
// «🇪🇸 Испания» → [«🇪🇸», «Испания»]; без иконки — [пусто, подпись].
const split = (label: string): [string, string] => {
  const m = /^([^\p{L}\p{N}\s]+)\s+(.+)$/u.exec(label);
  return m ? [m[1], m[2]] : [EMPTY, label];
};
const DOT: Record<RomiBand, string> = { red: "🔴", orange: "🟠", yellow: "🟡", green: "🟢" };
// ROMI — две ячейки: кружок и число (минус — знаком минуса).
export const romiTds = (romi: number | null) => (romi === null ? `<td>${EMPTY}</td>${td("—")}`
  : `<td>${DOT[romiBand(romi)!]}</td>${td(`${Math.round(romi)}%`.replace("-", "−"))}`);
const SHORT: Record<Platform, string> = { fb: "Facebook", tg: "TG Ads" };
const tr = (label: string, r: CheckRow, bold = false) => {
  const [icon, text] = split(label);
  const t = nb(e(text));
  return `<tr><td>${icon}</td><td>${bold ? `<b>${t}</b>` : t}</td>${td(n0(r.spend))}${td(n2(r.costPdp))}${td(n2(r.costDia))}`
    + `${td(n0(r.revenue ?? 0))}${romiTds(r.romi)}</tr>`;
};
const table = (rows: string[]) => `<table bordered striped compact><tr><th colspan="2">${EMPTY}</th><th>Спенд</th>`
  + `<th>${nb("$ подп.")}</th><th>${nb("$ диал.")}</th><th>Доход</th><th colspan="2">ROMI</th></tr>${rows.join("")}</table>`;

export function facesRich(rows: CheckRow[], title: string): string {
  const t = facesTree(rows);
  const head = `<h3>${e(title)}</h3>`;
  if (!t) return `${head}<p>Расхода не было.</p>`;
  // Площадка одна — её строка повторила бы строку лица; какая это площадка, видно по свёрнутому блоку.
  const overview = t.faces.flatMap((f) => [
    tr(`👤 ${f.label}`, f.total, true),
    ...(f.platforms.length > 1 ? f.platforms.map((p) => tr(`↳ ${SHORT[p.platform]}`, p.total)) : []),
  ]);
  const countries = t.faces.flatMap((f) => f.platforms.map((p) =>
    `<details><summary>${e(f.label)} · ${SHORT[p.platform]} — страны (${p.rows.length})</summary>${table(p.rows.map((r) => tr(r.label, r)))}</details>`));
  return [head, table([...overview, tr("Итого", t.total, true)]), ...countries].join("");
}

// Кнопка на «Отчёты»: цифры отчёта — оттуда. Период страница берёт свой, параметров в адресе у неё нет.
export function reportButton(base: string | null): Record<string, unknown> {
  return base ? { reply_markup: { inline_keyboard: [[{ text: "Открыть «Отчёты»", url: `${base}/traffic-report` }]] } } : {};
}
