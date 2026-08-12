export type MediaFile = {
  key: string;
  url: string;
  size?: number; // байты, из R2 ListObjectsV2
  posterUrl?: string; // thumbnail из папки thumbnails/, только для видео
};

export function normalize(value: string) {
  return value
    .toLowerCase()
    .trim()
    // CSV creative codes sometimes use "/" (from the Facebook ad name) where the actual
    // uploaded filename used ":" instead, since "/" isn't a valid filename character —
    // treat them as the same separator so "balance/5f-es" matches "balance:5f-es".
    .replace(/\//g, ":")
    .replace(/\.(mov|mp4|jpg|jpeg|png|webp)$/i, "");
}

export function getFileBaseName(key: string) {
  const fileName = key.split("/").pop() || "";
  return normalize(fileName);
}

export function findMedia(creative: string, media: MediaFile[]) {
  const creativeKey = normalize(creative);
  return media.find((file) => getFileBaseName(file.key) === creativeKey);
}

// Strips trailing dash-tokens that are known geo/variant tags ("edit1-ar" -> "edit1"),
// stopping at the first token that isn't in the list ("qa-6-es" -> "qa-6", not "qa").
// The tag list isn't a fixed convention — buyers keep inventing new ones — so it's
// data-driven (creative_match_suffixes in Supabase), never hardcoded here.
export function stripKnownSuffixes(normalizedName: string, suffixes: ReadonlySet<string>): string {
  if (suffixes.size === 0) return normalizedName;
  const parts = normalizedName.split("-");
  while (parts.length > 1 && suffixes.has(parts[parts.length - 1])) parts.pop();
  return parts.join("-");
}

export type MediaMatch = { file: MediaFile; exact: boolean };

// Exact match first; if none, falls back to matching on the base name with known
// geo/variant suffixes stripped from both sides — so "edit1-ar" can reuse the media
// already uploaded as "edit1-es" instead of showing up as missing / duplicate.
export function findMediaMatch(
  creative: string,
  media: MediaFile[],
  suffixes: ReadonlySet<string>
): MediaMatch | undefined {
  const exact = findMedia(creative, media);
  if (exact) return { file: exact, exact: true };
  if (suffixes.size === 0) return undefined;

  const targetBase = stripKnownSuffixes(normalize(creative), suffixes);
  const file = media.find((f) => stripKnownSuffixes(getFileBaseName(f.key), suffixes) === targetBase);
  return file ? { file, exact: false } : undefined;
}

export function isVideo(url: string) {
  return /\.(mov|mp4)$/i.test(url);
}

export function isImage(url: string) {
  return /\.(jpg|jpeg|png|webp)$/i.test(url);
}

export function getApproach(key: string): string {
  const slash = key.indexOf("/");
  return slash > 0 ? key.slice(0, slash) : "unknown";
}
