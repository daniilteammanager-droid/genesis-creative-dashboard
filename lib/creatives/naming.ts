// Приведение имён к одному виду. Живёт отдельно от media.ts и code.ts, потому что нужно
// обоим: code.ts разбирает код креатива, media.ts сопоставляет его с файлом в R2.

export function normalize(value: string) {
  return value
    .toLowerCase()
    .trim()
    // В именах объявлений Facebook встречается "/", который недопустим в имени файла и при
    // загрузке превращается в ":". Без этой замены "balance/5f-es" и "balance:5f-es.mp4"
    // считались бы разными креативами.
    .replace(/\//g, ":")
    .replace(/\.(mov|mp4|jpg|jpeg|png|webp)$/i, "");
}

export function getFileBaseName(key: string) {
  const fileName = key.split("/").pop() || "";
  return normalize(fileName);
}
