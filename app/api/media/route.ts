import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

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
      .filter((f) => !f.key.startsWith("thumbnails/"))
      .map((f) => {
        const isVideo = /\.(mov|mp4)$/i.test(f.key);
        const posterUrl = isVideo ? thumbnailMap.get(fileBasename(f.key)) : undefined;
        return posterUrl ? { ...f, posterUrl } : f;
      });

    return NextResponse.json(mediaFiles, {
      headers: {
        // Браузер кешует 5 минут, CDN/прокси — до 10 минут
        "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=60",
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
