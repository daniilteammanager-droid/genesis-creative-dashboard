import { createHash } from "node:crypto";
import { escapeHtml } from "@/lib/telegram/api";
import { metricsOf, TARGET_DEP, TEST_MULT, type Stage, type Sums } from "@/lib/traffic-report/build";

// AI-разбор крео (Decision 101): что модель получает и как читаем её ответ. Чистые функции —
// самопроверка в prompt.test.ts.

export const WINDOW_DAYS = 30;

export interface GeoFacts { geo: string; name: string; stage: Stage; sums: Sums }
export interface CreoFacts {
  buyer: string; creo: string; face: string; funnel: string;
  transcript: string | null;
  geos: GeoFacts[];
  total: Sums;
  team: { region: string; sums: Sums }[];   // средние команды по регионам — в промпт только цены и конверсии, без сумм
}

export const CREO_SYSTEM = `Ты — аналитик креативов в команде медиабаинга. Команда льёт рекламу из Facebook и Telegram Ads в Telegram-воронку:
показ → клик → подписка на Telegram (ПДП) → диалог с менеджером (ДИА) → депозит клиента (деп). Ревенью — выплата за депы.
ROMI = (ревенью − спенд) / спенд. Целевая цена депа: Испания $${TARGET_DEP.ES}, Латам $${TARGET_DEP.LATAM}, остальные $${TARGET_DEP.OTHER}.
Крео без депов, потративший больше ${TEST_MULT} × целевой цены депа своей страны, — лузер. Цифры за последние ${WINDOW_DAYS} дней.
Код крео: подход (balance, edit, checklist, storytell…) — tN номер текста — vN версия монтажа того же текста — bN баер — язык-гео.
Лицо — спикер в видео.

Разбор читает баер, и он только про его крео: не упоминай других баеров, их крео и связки и не советуй брать чужое.
Средние команды — ориентир по ценам и конверсиям; суммы команды ты не знаешь и не называешь.

По транскрипту и цифрам дай разбор на русском, не больше 200 слов, для баера, который решает, что делать с крео:
Первая строка — ровно «Вердикт: масштабировать», «Вердикт: держать», «Вердикт: доработать» или «Вердикт: выключить», дальше через тире — почему, в цифрах.
Потом коротко: где рвётся воронка (CTR, цена подписки, подписка → диалог, диалог → деп) по сравнению со средними команды своего региона;
что в тексте работает или мешает (хук первых секунд, обещание, призыв); 2–3 конкретные идеи для следующей версии или по гео.
Не выдумывай цифр, которых нет. Если данных мало для вывода — так и скажи. Без таблиц и заголовков, можно **жирный** и списки через «- ».`;

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const usd = (v: number | null) => (v === null ? "—" : `$${v.toFixed(2)}`);
const STAGE_RU: Record<Stage, string> = { deps: "есть депы", test: "на тесте", loser: "лузер", nospend: "без спенда" };

function line(name: string, s: Sums, stage?: Stage): string {
  const m = metricsOf(s);
  return `${name}${stage ? ` (${STAGE_RU[stage]})` : ""}: спенд $${s.spend.toFixed(0)}, CPM ${usd(m.cpm)}, CTR ${pct(m.ctr)}, ` +
    `подписок ${s.subs} (${usd(m.cps)}), подписка→диалог ${pct(m.crDia)}, диалогов ${s.dia} (${usd(m.cpd)}), ` +
    `диалог→деп ${pct(m.crDep)}, депов ${s.deps} (${usd(m.cpdep)}), ревенью $${Math.round(s.rev)}, ROMI ${m.romi === null ? "—" : `${m.romi.toFixed(0)}%`}`;
}

// Средние команды — только отношения: цены и конверсии. Суммы чужих баеров (спенд, депы, ревенью)
// в промпт не идут, чтобы модель не пересказала их баеру.
function ratioLine(name: string, s: Sums): string {
  const m = metricsOf(s);
  return `${name}: CPM ${usd(m.cpm)}, CTR ${pct(m.ctr)}, цена подписки ${usd(m.cps)}, подписка→диалог ${pct(m.crDia)}, ` +
    `цена диалога ${usd(m.cpd)}, диалог→деп ${pct(m.crDep)}, цена депа ${usd(m.cpdep)}, ROMI ${m.romi === null ? "—" : `${m.romi.toFixed(0)}%`}`;
}

export function creoPrompt(f: CreoFacts): string {
  return [
    `Крео: ${f.creo} · баер: ${f.buyer}${f.face ? ` · лицо: ${f.face}` : ""}${f.funnel ? ` · воронка: ${f.funnel}` : ""}`,
    "",
    "Транскрипт:",
    f.transcript?.trim() || "(транскрипта нет — разбирай по цифрам и коду крео)",
    "",
    "Цифры:",
    line("Итого", f.total),
    ...f.geos.map((g) => line(g.name, g.sums, g.stage)),
    "",
    "Средние по команде за тот же период (все крео, только цены и конверсии):",
    ...f.team.map((t) => ratioLine(t.region, t.sums)),
  ].join("\n");
}

// Код текста крео без баера и гео: vid-balance-t30-v9-b3-es-es → vid-balance-t30-v9; баер — b3.
export const textBase = (creo: string) => creo.toLowerCase().match(/^([a-z]+-[a-z0-9]+-t\d+-v\d+)(?=-|$)/)?.[1] ?? null;
export const buyerCodeIn = (code: string) => code.toLowerCase().match(/-(b\d+)(?=-|$)/)?.[1] ?? null;

// Транскрипт к крео — как файлы к строкам (Decision 077): своя папка баера или легаси без кода баера,
// чужой bN — никогда. Свой — первым.
export function pickTranscript(rows: { code: string; text: string }[], buyerCode: string | null): string | null {
  const own = rows.find((r) => buyerCode && buyerCodeIn(r.code) === buyerCode.toLowerCase());
  return (own ?? rows.find((r) => buyerCodeIn(r.code) === null))?.text ?? null;
}

// Отпечаток цифр: те же цифры — тот же разбор, повторно не платим.
export function dataHash(f: CreoFacts): string {
  const r = (s: Sums) => [s.spend.toFixed(0), s.impr, s.clicks, s.subs, s.dia, s.deps, Math.round(s.rev)].join(",");
  return createHash("sha1").update([f.transcript ?? "", ...f.geos.map((g) => `${g.geo}:${r(g.sums)}`)].join("|")).digest("hex");
}

export type Verdict = "scale" | "hold" | "rework" | "off";
export const VERDICTS: Record<Verdict, string> = { scale: "масштабировать", hold: "держать", rework: "доработать", off: "выключить" };

export function parseVerdict(text: string): Verdict | null {
  const first = text.replace(/\*/g, "").split("\n").find((l) => l.trim())?.toLowerCase() ?? "";
  if (!first.includes("вердикт")) return null;
  const hit = (Object.entries(VERDICTS) as [Verdict, string][]).find(([, w]) => first.includes(w));
  return hit ? hit[0] : null;
}

// Ответ модели (markdown) → HTML для Telegram: экранируем, **жирный** → <b>, заголовки без решёток.
export function toTelegramHtml(md: string): string {
  return escapeHtml(md.trim())
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

// Telegram режет сообщения длиннее 4096 знаков — делим по абзацам.
export function chunks(text: string, max = 3800): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of text.split("\n")) {
    if (cur && cur.length + p.length + 1 > max) { out.push(cur); cur = ""; }
    cur = cur ? `${cur}\n${p}` : p.slice(0, max);
  }
  if (cur) out.push(cur);
  return out;
}
