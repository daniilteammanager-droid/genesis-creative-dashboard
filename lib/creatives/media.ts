import { normalize, getFileBaseName } from "./naming";
import { approachOf, buyerCodeIn, versionCode } from "./code";

export { normalize, getFileBaseName };

export type MediaFile = {
  key: string;
  url: string;
  size?: number; // байты, из R2 ListObjectsV2
  posterUrl?: string; // thumbnail из папки thumbnails/, только для видео
  own?: boolean; // можно ли трогать: у баера — своя папка, у владельца и тимлида — всё (Decision 077)
};

export function isVideo(url: string) {
  return /\.(mov|mp4)$/i.test(url);
}

export function isImage(url: string) {
  return /\.(jpg|jpeg|png|webp)$/i.test(url);
}

// Подход креатива. У новых кодов читается из самого кода, у старых — из папки в R2.
// Подробности и причина — в lib/creatives/code.ts.
export function getApproach(creative: string, fileKey?: string): string {
  return approachOf(creative, fileKey);
}

// Отрезает с конца известные гео/вариант-суффиксы ("edit1-ar" -> "edit1"), останавливаясь
// на первом же сегменте не из списка ("qa-6-es" -> "qa-6", а не "qa").
//
// Только для СТАРЫХ имён. Список суффиксов ведётся руками в Supabase, и на новом коде он
// опасен: тот кончается на язык-гео, поэтому при "es" и "ar" в списке базой стало бы имя
// без языка и гео вообще. У новых кодов ту же задачу решает код до vN (versionCode) с баером.
export function stripKnownSuffixes(normalizedName: string, suffixes: ReadonlySet<string>): string {
  if (suffixes.size === 0) return normalizedName;
  const parts = normalizedName.split("-");
  while (parts.length > 1 && suffixes.has(parts[parts.length - 1])) parts.pop();
  return parts.join("-");
}

// otherVersion — нужной vN в Медиатеке нет, показана другая версия того же крео («v3»).
export type MediaMatch = { file: MediaFile; exact: boolean; otherVersion?: string };

// ─── Индекс ───────────────────────────────────────────────────────────────────
//
// Раньше каждый поиск линейно проходил весь список медиа, а вызывался он в цикле по всем
// креативам — в Медиатеке дважды при открытии, в аналитике дважды, на главной на каждое
// нажатие клавиши при активном фильтре подходов. Сотни тысяч сравнений с тремя регулярками
// на каждое. Индекс строится один раз, дальше поиск за constant time.

export interface MediaIndex {
  byName: Map<string, MediaFile>;
  // Код до vN + баер (08.11.2026): «vid-balance-t30-v9|b3». Номер текста у каждого баера свой,
  // поэтому баер в ключе: из имени, а у файла без bN в имени — из его папки bN/. Пустой — файл ничей.
  byVersion: Map<string, MediaFile>;
  // Тот же крео до номера текста, любая версия: «vid-balance-t30|b3» — когда нужной vN не загрузили.
  byText: Map<string, MediaFile>;
  // Старые имена без кода: базовое имя с отрезанными известными суффиксами.
  byShoot: Map<string, MediaFile>;
  // Нужны при поиске: у старых имён запасной ключ считается тем же правилом, что и при
  // построении индекса, иначе стороны разъедутся.
  suffixes: ReadonlySet<string>;
}

function versionKey(name: string, folder = ""): string | null {
  const v = versionCode(name);
  return v ? `${v}|${buyerCodeIn(name) ?? (/^b\d+$/.test(folder) ? folder : "")}` : null;
}
const textKey = (vk: string) => vk.replace(/-v\d+\|/, "|");
const nobody = (k: string) => k.replace(/\|.*$/, "|");

export function buildMediaIndex(media: MediaFile[], suffixes: ReadonlySet<string>): MediaIndex {
  const byName = new Map<string, MediaFile>();
  const byVersion = new Map<string, MediaFile>();
  const byText = new Map<string, MediaFile>();
  const byShoot = new Map<string, MediaFile>();

  // Первый победивший файл остаётся: список из R2 отсортирован по ключу, так что выбор
  // стабилен от запуска к запуску.
  for (const file of media) {
    const base = getFileBaseName(file.key);
    if (!byName.has(base)) byName.set(base, file);
    const slash = file.key.indexOf("/");
    const vk = versionKey(base, slash > 0 ? file.key.slice(0, slash) : "");
    if (vk) {
      if (!byVersion.has(vk)) byVersion.set(vk, file);
      if (!byText.has(textKey(vk))) byText.set(textKey(vk), file);
    } else {
      const k = stripKnownSuffixes(base, suffixes);
      if (!byShoot.has(k)) byShoot.set(k, file);
    }
  }

  return { byName, byVersion, byText, byShoot, suffixes };
}

// Точное имя; нет — файл с тем же кодом до vN того же баера (другая озвучка, гео, хвост), потом
// ничей файл с этим кодом; нет и его — другая версия того же крео (до tN), с otherVersion.
// Чужой bN — никогда: его t30 — другой текст. Неточное совпадение помечается exact: false, и
// карточка рисует бейдж «≈ похоже» или «другая версия».
export function lookupMedia(index: MediaIndex, creative: string): MediaMatch | undefined {
  const key = normalize(creative);

  const exact = index.byName.get(key);
  if (exact) return { file: exact, exact: true };

  const vk = versionKey(key);
  if (!vk) {
    const file = index.byShoot.get(stripKnownSuffixes(key, index.suffixes));
    return file ? { file, exact: false } : undefined;
  }
  const same = index.byVersion.get(vk) ?? index.byVersion.get(nobody(vk));
  if (same) return { file: same, exact: false };
  const other = index.byText.get(textKey(vk)) ?? index.byText.get(nobody(textKey(vk)));
  return other ? { file: other, exact: false, otherVersion: /-(v\d+)$/.exec(versionCode(getFileBaseName(other.key))!)?.[1] } : undefined;
}

// Медиатека баера — только его крео (03.11.2026): файлы, к которым подходит имя из его
// статистики, где бы файл ни лежал, и его собственные загрузки — свежие ещё не крутились.
export function libraryOf(media: MediaFile[], names: Iterable<string>, suffixes: ReadonlySet<string>): MediaFile[] {
  const index = buildMediaIndex(media, suffixes);
  const keep = new Set(media.filter((f) => f.own).map((f) => f.key));
  for (const name of names) {
    const hit = lookupMedia(index, name);
    if (hit) keep.add(hit.file.key);
  }
  return media.filter((f) => keep.has(f.key));
}

// Разовый поиск там, где индекс строить незачем — например один выбранный креатив.
export function findMedia(creative: string, media: MediaFile[]): MediaFile | undefined {
  const key = normalize(creative);
  return media.find((file) => getFileBaseName(file.key) === key);
}
