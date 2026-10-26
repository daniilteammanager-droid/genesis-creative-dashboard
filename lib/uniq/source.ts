import { S3Client, ListObjectsV2Command, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getFileBaseName, normalize } from "@/lib/creatives/naming";
import { shootKey } from "@/lib/creatives/code";

// Исходник для уникализации и куда класть результат (Decision 076).
//
// Как у Артёма: исходник — всегда v1 этого креатива из библиотеки, а не то, что
// сейчас стоит в объявлении. Имя объявления «vid-storytell-t26-v9-b1-es-es» →
// ищем «vid-storytell-t26-v1-b1-es-es»; нет — v1 той же съёмки в другом гео/языке.
// Файлы ищутся по всему бакету, без фильтра по владельцу (Decision 036).

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
});
const BUCKET = () => process.env.R2_BUCKET_NAME!;
const VIDEO = /\.(mp4|mov)$/i;

export const publicUrl = (key: string) => `${process.env.R2_PUBLIC_URL}/${key.split("/").map(encodeURIComponent).join("/")}`;

export const v1Name = (adName: string) => normalize(adName).replace(/-v\d+(?=-)/, "-v1");

// Чистая функция: из списка ключей бакета — исходник v1 для объявления.
export function pickSource(adName: string, keys: string[]): string | null {
  const want = v1Name(adName);
  const videos = keys.filter((k) => VIDEO.test(k) && !/^(thumbnails|variants|originals)\//.test(k));
  const exact = videos.filter((k) => getFileBaseName(k) === want);
  const shoot = shootKey(want);
  const picked = exact.length ? exact.sort()[0] : shoot ? videos.filter((k) => shootKey(getFileBaseName(k)) === shoot).sort()[0] ?? null : null;
  return picked ? originalOf(picked, keys) : null;
}

// Исходник до сжатия, если воркер его сохранил (Decision 080): originals/<тот же путь>,
// расширение может быть другим (.mov → сжатый .mp4). Нет — сжатый файл.
export function originalOf(key: string, keys: string[]): string {
  const stem = (k: string) => k.replace(/\.[^./]+$/, "").toLowerCase();
  return keys.find((k) => k.startsWith("originals/") && stem(k.slice("originals/".length)) === stem(key)) ?? key;
}

export async function findSource(adName: string): Promise<string | null> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET(), ContinuationToken: token }));
    for (const o of r.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return pickSource(adName, keys);
}

// Результат кладёт воркер по подписанной ссылке: ключей R2 на VPS нет.
export const resultKey = (jobId: string) => `variants/${jobId}.mp4`;
export const uploadUrl = (key: string) =>
  getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET(), Key: key, ContentType: "video/mp4" }), { expiresIn: 6 * 3600 });

// Тот же поиск оригинала, но по одному ключу — без листинга бакета (автозалив, Decision 081).
export async function originalKey(key: string): Promise<string> {
  const stem = key.replace(/\.[^./]+$/, "");
  for (const ext of ["mp4", "mov", "MP4", "MOV", "jpg", "jpeg", "png", "webp"]) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET(), Key: `originals/${stem}.${ext}` }));
      return `originals/${stem}.${ext}`;
    } catch { /* нет такого — следующее расширение */ }
  }
  return key;
}
