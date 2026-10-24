// Разбор кода креатива. Код — единственная связка между рекламным кабинетом, картотекой
// в Notion и файлом в R2: имя объявления = код в картотеке = имя файла, буква в букву.
//
// Новая схема (с августа 2026), ровно семь позиций:
//
//   vid - storytell - t31 - v1 - b2 - es - ar
//    │       │         │     │    │    │    └─ гео залива
//    │       │         │     │    │    └────── язык озвучки
//    │       │         │     │    └─────────── байер
//    │       │         │     └──────────────── версия исполнения
//    │       │         └────────────────────── номер текста
//    │       └──────────────────────────────── подход
//    └──────────────────────────────────────── носитель
//
// Старые коды ("videoM17CLstr-es", "balance5-off-es-tg") по этой схеме не читаются и
// НИКОГДА не переименовываются — два поколения имён живут рядом постоянно. Поэтому
// парсер обязан их переживать, а не падать: всё, что не подошло, помечается legacy.

import { normalize } from "./media";

export interface CreativeCodeV2 {
  scheme: "v2";
  medium: string;    // vid | stat
  approach: string;  // storytell, checklist, balance, signal, qa, edit, live, lifestyle…
  textNo: number;    // t31 -> 31
  version: number;   // v1  -> 1
  buyer: string;     // b2
  language: string;  // es, en, pt, ru, de
  geo: string;       // es, ar, mx, cl, pe, co
}

export interface CreativeCodeLegacy {
  scheme: "legacy";
  // Второй dash-сегмент старого имени иногда оказывался гео ("videom17clstr-es" -> "es"),
  // а иногда чем угодно ("balance5-off-es-tg" -> "off"). Оставляем как есть, решение
  // "гео это или нет" принимает справочник гео, а не парсер.
  secondSegment: string;
}

export type ParsedCreativeCode = CreativeCodeV2 | CreativeCodeLegacy;

// Опознаём схему по трём структурным маркерам — t<цифры>, v<цифры>, b<цифры> в позициях
// 3, 4 и 5. Именно они, а не списки значений: носитель, подход, язык и гео живут в словаре
// команды и пополняются, а хардкод здесь означал бы деплой ради каждого нового гео.
const V2_RE = /^([a-z]+)-([a-z0-9]+)-t(\d+)-v(\d+)-b(\d+)-([a-z]{2,3})-([a-z]{2,3})$/;

// Meta дописывает к имени объявления хвост при дублировании в кабинете:
// "…_Ad name2026-09-01 10:00:00", в локализованных кабинетах "_Nome inserzione",
// "_Anzeigenname", "_Nombre del anuncio". Это не часть имени, которое печатал
// человек, а артефакт кабинета.
//
// Без отрезания дублированный новый код опознаётся как legacy и отдаёт неверные
// значения: гео берётся вторым сегментом через дефис, а там подход. То есть крео
// на Аргентину отчитается с гео "storytell" — ровно та подмена, ради запрета
// которой писался Decision 026. Замерено на живых данных 31.08.2026.
const DUPLICATE_TAIL = /_(?:ad name|nome inserzione|anzeigenname|nombre del anuncio|nom de la publicité)\s?\d{4}-\d\d-\d\d.*$/i;

export function stripDuplicateTail(name: string): string {
  return name.replace(DUPLICATE_TAIL, "");
}

export function parseCreativeCode(code: string): ParsedCreativeCode {
  const normalized = stripDuplicateTail(normalize(code));
  const m = V2_RE.exec(normalized);
  if (m) {
    return {
      scheme: "v2",
      medium: m[1],
      approach: m[2],
      textNo: parseInt(m[3], 10),
      version: parseInt(m[4], 10),
      buyer: `b${m[5]}`,
      language: m[6],
      geo: m[7],
    };
  }
  return { scheme: "legacy", secondSegment: normalized.split("-")[1] ?? "" };
}

// Гео залива. У новых кодов — последняя позиция, у старых — второй сегмент, как было
// раньше. Раньше второй сегмент брался у всех подряд: на новом коде это давало подход
// ("storytell") вместо гео, то есть все новые креативы уезжали в бакет "без гео".
export function geoOf(code: string): string {
  const parsed = parseCreativeCode(code);
  return parsed.scheme === "v2" ? parsed.geo : parsed.secondSegment;
}

// Подход. У новых кодов он зашит в само имя; у старых — угадывался по папке в R2, куда
// файл сложили. Второе перестаёт работать само собой: загрузка раскладывает новые файлы
// по первым буквам имени, то есть всё новое падает в vid/ и stat/.
export function approachOf(code: string, fileKey?: string): string {
  const parsed = parseCreativeCode(code);
  if (parsed.scheme === "v2") return parsed.approach;
  if (!fileKey) return "unknown";
  const slash = fileKey.indexOf("/");
  return slash > 0 ? fileKey.slice(0, slash) : "unknown";
}

// Байер-автор кода. Есть только у новых кодов — у старых принадлежности в имени не было.
export function buyerOf(code: string): string | undefined {
  const parsed = parseCreativeCode(code);
  return parsed.scheme === "v2" ? parsed.buyer : undefined;
}

// Ключ "та же съёмка" — код без языка и гео. Нужен, чтобы карточка креатива на Аргентину
// могла показать превью уже загруженного файла на Испанию: это буквально один и тот же
// ролик в другой озвучке. Отрезаются ровно две последние позиции и ничего больше —
// текст, версия, подход и байер остаются, потому что различие в них означает уже другой
// креатив, а не другую озвучку того же.
export function shootKey(code: string): string | undefined {
  const parsed = parseCreativeCode(code);
  if (parsed.scheme !== "v2") return undefined;
  return `${parsed.medium}-${parsed.approach}-t${parsed.textNo}-v${parsed.version}-${parsed.buyer}`;
}

// ─── Имена РК и адсетов ───────────────────────────────────────────────────────
//
// Шаблон (вики баера, «Имена РК и адсета»):
//   РК:    Кабинет_ДД.ММ_Воронка_Маркер_Гео_Ленд_Лицо[_Метка]  ->  T2A0317_24.08_TG_EXP_ARG_TGR_ROMAN
//   Адсет: Гео_Таргет[_МеткаТеста]                             ->  ARG_BROAD_TEST1
//
// На практике позиции гуляют (замер 24.10.2026 по 299 РК и 126 адсетам): кабинет
// то первым, то после даты (20.10_TESSERR252_…, 1818_FB_102_08.10 _…), гео то в
// три буквы, то в две (MEX / MX), дата ДД.ММ и ГГГГ-ММ-ДД, адсет часто назван как
// РК, а у Dolphin к адсету дописан номер (ESP_BROAD 1778). Разбор по позициям
// понимал 24 адсета из 126. Поэтому читаем по словарю: ищем известные значения,
// где бы они ни стояли. Неизвестное — просто не заполняется, без догадок.

// Гео имени → двухбуквенный код страны, как в коде креатива и таргете Meta.
// LATAM — регион, страны за ним нет: бывает только в имени РК.
const NAME_GEO: Record<string, string> = {
  ESP: "ES", ES: "ES", ARG: "AR", AR: "AR", MEX: "MX", MX: "MX", CHL: "CL", CL: "CL",
  PER: "PE", PE: "PE", PRY: "PY", PAR: "PY", PY: "PY", URY: "UY", URU: "UY", UY: "UY",
  ECU: "EC", EC: "EC", PAN: "PA", PA: "PA", COL: "CO", CO: "CO", LATAM: "LATAM",
};
const FUNNELS = new Set(["TG", "WA"]);
const MARKERS = new Set(["NEW", "EXP", "MIX"]);
const LANDS = new Set(["TGR", "MTG", "VSL1", "VSL2", "KAL1", "KAL2", "ART1", "ART2", "ART3"]);
const FACES = new Set(["ROMAN", "RICKY"]);
const TARGETS = new Set(["BROAD", "INT", "RETARGET"]);

export interface ParsedName {
  face?: string;     // ROMAN | RICKY — лицо, по сути проект
  geo?: string;      // ES, AR, … или LATAM
  funnel?: string;   // TG | WA
  marker?: string;   // NEW | EXP | MIX
  land?: string;     // TGR, MTG, VSL1, ART1…
  target?: string;   // BROAD | INT | RETARGET — у адсета
  day?: string;      // ДД.ММ, как пишут в имени
}

export function parseName(name: string): ParsedName {
  const out: ParsedName = {};
  // Разделители — подчёркивание, пробел, скобки: «07.10 (1818_FB_102) ES 2».
  for (const raw of name.toUpperCase().split(/[_\s()]+/).filter(Boolean)) {
    if (!out.day) {
      const iso = /^\d{4}-(\d{2})-(\d{2})$/.exec(raw);
      if (iso) { out.day = `${iso[2]}.${iso[1]}`; continue; }
      if (/^\d{2}\.\d{2}$/.test(raw)) { out.day = raw; continue; }
    }
    if (!out.face && FACES.has(raw)) out.face = raw;
    else if (!out.funnel && FUNNELS.has(raw)) out.funnel = raw;
    else if (!out.marker && MARKERS.has(raw)) out.marker = raw;
    else if (!out.land && LANDS.has(raw)) out.land = raw;
    else if (!out.target && TARGETS.has(raw)) out.target = raw;
    else if (!out.geo && raw in NAME_GEO) out.geo = NAME_GEO[raw];
  }
  // Одно узнанное слово — совпадение, а не нейминг: «New Traffic Campaign» дало
  // бы маркер NEW. У нашего имени узнаётся минимум два куска (у адсета гео и таргет).
  return Object.keys(out).length >= 2 ? out : {};
}
