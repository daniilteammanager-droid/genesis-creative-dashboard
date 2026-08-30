import { normalize, getFileBaseName } from "./naming";
import { shootKey, approachOf } from "./code";

export { normalize, getFileBaseName };

export type MediaFile = {
  key: string;
  url: string;
  size?: number; // байты, из R2 ListObjectsV2
  posterUrl?: string; // thumbnail из папки thumbnails/, только для видео
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
// без языка и гео вообще — и креатив на Мексику подхватил бы файл от Испании. У новых
// кодов ту же задачу решает shootKey(), который отрезает ровно две последние позиции.
export function stripKnownSuffixes(normalizedName: string, suffixes: ReadonlySet<string>): string {
  if (suffixes.size === 0) return normalizedName;
  const parts = normalizedName.split("-");
  while (parts.length > 1 && suffixes.has(parts[parts.length - 1])) parts.pop();
  return parts.join("-");
}

export type MediaMatch = { file: MediaFile; exact: boolean };

// ─── Индекс ───────────────────────────────────────────────────────────────────
//
// Раньше каждый поиск линейно проходил весь список медиа, а вызывался он в цикле по всем
// креативам — в Медиатеке дважды при открытии, в аналитике дважды, на главной на каждое
// нажатие клавиши при активном фильтре подходов. Сотни тысяч сравнений с тремя регулярками
// на каждое. Индекс строится один раз, дальше поиск за constant time.

export interface MediaIndex {
  byName: Map<string, MediaFile>;
  byShoot: Map<string, MediaFile>;
  // Нужны при поиске: у старых имён запасной ключ считается тем же правилом, что и при
  // построении индекса, иначе стороны разъедутся.
  suffixes: ReadonlySet<string>;
}

export function buildMediaIndex(media: MediaFile[], suffixes: ReadonlySet<string>): MediaIndex {
  const byName = new Map<string, MediaFile>();
  const byShoot = new Map<string, MediaFile>();

  for (const file of media) {
    const base = getFileBaseName(file.key);
    if (!byName.has(base)) byName.set(base, file);

    // Новое имя — ключ "та же съёмка" без языка и гео. Старое — базовое имя с отрезанными
    // известными суффиксами. Первый победивший файл остаётся: список из R2 отсортирован по
    // ключу, так что выбор стабилен от запуска к запуску.
    const fallback = shootKey(base) ?? stripKnownSuffixes(base, suffixes);
    if (!byShoot.has(fallback)) byShoot.set(fallback, file);
  }

  return { byName, byShoot, suffixes };
}

// Точное совпадение имени; если его нет — файл той же съёмки в другой озвучке или гео.
// Неточное совпадение помечается exact: false, и карточка рисует бейдж «≈ похоже» —
// пользователь должен видеть, что превью подставлено, а не найдено.
export function lookupMedia(index: MediaIndex, creative: string): MediaMatch | undefined {
  const key = normalize(creative);

  const exact = index.byName.get(key);
  if (exact) return { file: exact, exact: true };

  const fallbackKey = shootKey(key) ?? stripKnownSuffixes(key, index.suffixes);
  const file = index.byShoot.get(fallbackKey);
  return file ? { file, exact: false } : undefined;
}

// Разовый поиск там, где индекс строить незачем — например один выбранный креатив.
export function findMedia(creative: string, media: MediaFile[]): MediaFile | undefined {
  const key = normalize(creative);
  return media.find((file) => getFileBaseName(file.key) === key);
}
