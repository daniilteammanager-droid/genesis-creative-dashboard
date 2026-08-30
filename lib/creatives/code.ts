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

export function parseCreativeCode(code: string): ParsedCreativeCode {
  const normalized = normalize(code);
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
//   РК:    Кабинет_ДД.ММ_Воронка_Маркер_Гео_Ленд_Лицо[_Метка]
//          T2A0317_24.08_TG_EXP_ARG_TGR_ROMAN
//   Адсет: Гео_Таргет[_МеткаТеста]  ->  ARG_BROAD_TEST1
//
// Гео здесь трёхбуквенное (ARG), а в коде креатива двухбуквенное (ar) — это разные
// справочники, сводить их напрямую нельзя. Регион LATAM бывает только в имени РК.

export interface ParsedCampaignName {
  account: string;   // T2A0317 — провайдер + последние 4 цифры id
  day: string;       // ДД.ММ
  funnel: string;    // TG | WA
  marker: string;    // NEW | EXP | MIX
  geo: string;       // ARG, ESP, LATAM…
  land: string;      // TGR, MTG, VSL1, ART1…
  face: string;      // ROMAN | RICKY
  tag?: string;
}

const CAMPAIGN_RE = /^([^_]+)_(\d{2}\.\d{2})_([^_]+)_([^_]+)_([^_]+)_([^_]+)_([^_]+)(?:_(.+))?$/;

// Формат кабинета сменился 27.08 (T2A/63 -> T2A0317) и старые РК не переименовываются,
// так что обе формы какое-то время живут в статистике рядом. Оба варианта проходят —
// кабинет читается как есть, без попытки его нормализовать.
export function parseCampaignName(name: string): ParsedCampaignName | null {
  const m = CAMPAIGN_RE.exec(name.trim());
  if (!m) return null;
  return {
    account: m[1],
    day: m[2],
    funnel: m[3].toUpperCase(),
    marker: m[4].toUpperCase(),
    geo: m[5].toUpperCase(),
    land: m[6].toUpperCase(),
    face: m[7].toUpperCase(),
    tag: m[8],
  };
}

export interface ParsedAdSetName {
  geo: string;     // ARG
  target: string;  // BROAD | INT | RETARGET
  testTag?: string;
}

export function parseAdSetName(name: string): ParsedAdSetName | null {
  const parts = name.trim().split("_");
  if (parts.length < 2) return null;
  return {
    geo: parts[0].toUpperCase(),
    target: parts[1].toUpperCase(),
    testTag: parts.length > 2 ? parts.slice(2).join("_") : undefined,
  };
}
