import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth/server";
import { mayManageKey, maySeeKey } from "@/lib/creatives/access";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

/** Basename без расширения, нижний регистр — ключ для сопоставления */
function fileBasename(key: string): string {
  const filename = key.split("/").pop() ?? "";
  return filename.toLowerCase().replace(/\.(mov|mp4|jpg|jpeg|png|webp)$/i, "");
}

export async function GET() {
  try {
    // Баер не видит папок других баеров (Decision 077). Middleware пускает только
    // вошедших, но роль он не знает — её проверяем здесь.
    const me = await getProfile();
    if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });

    const allFiles: { key: string; url: string; size: number }[] = [];
    let continuationToken: string | undefined;

    // Собираем все объекты из bucket с пагинацией
    do {
      const command = new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        ContinuationToken: continuationToken,
      });
      const response = await s3.send(command);

      for (const file of response.Contents ?? []) {
        if (file.Key) {
          allFiles.push({
            key: file.Key,
            url: `${process.env.R2_PUBLIC_URL}/${file.Key}`,
            size: file.Size ?? 0,
          });
        }
      }

      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);

    // Строим карту: basename → posterUrl  из папки thumbnails/
    const thumbnailMap = new Map<string, string>();
    for (const file of allFiles) {
      if (file.key.startsWith("thumbnails/")) {
        thumbnailMap.set(fileBasename(file.key), file.url);
      }
    }

    // Возвращаем медиафайлы (без thumbnails/), для видео добавляем posterUrl
    const mediaFiles = allFiles
      // variants/ — результаты уникализации (Decision 076), не крео библиотеки.
      .filter((f) => !f.key.startsWith("thumbnails/") && !f.key.startsWith("variants/") && maySeeKey(me, f.key))
      .map((f) => {
        const isVideo = /\.(mov|mp4)$/i.test(f.key);
        const posterUrl = isVideo ? thumbnailMap.get(fileBasename(f.key)) : undefined;
        const own = mayManageKey(me, f.key);
        return posterUrl ? { ...f, posterUrl, own } : { ...f, own };
      });

    return NextResponse.json(mediaFiles, {
      headers: {
        // Только браузер, 5 минут. Не public: список свой у каждого баера, и общий
        // кэш CDN отдал бы один список всем.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Failed to load media" },
      { status: 500 }
    );
  }
}
