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
