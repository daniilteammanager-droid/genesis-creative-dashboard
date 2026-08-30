import { NextResponse } from "next/server";
import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getProfile, createClient } from "@/lib/auth/server";
import { buyerOf } from "@/lib/creatives/code";
import { getFileBaseName } from "@/lib/creatives/naming";

// Generates a presigned R2 PUT URL per file — the browser uploads directly to R2,
// never through this route, so Vercel's request-body limit never sees the video bytes.
// Compression / thumbnails / transcription are handled entirely by a separate worker
// that polls R2 on its own cron — this route only issues the upload URL.

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const ALLOWED_EXT = /\.(mov|mp4|jpg|jpeg|png|webp)$/i;

// New uploads are auto-foldered by the leading letters of the filename
// ("videom17clst-es" -> "videom/", "qa-3" -> "qa/"); existing bucket layout is untouched.
function extractFolder(filename: string): string {
  return /^[a-zA-Z]+/.exec(filename)?.[0] ?? "misc";
}

export async function POST(req: Request) {
  try {
    const me = await getProfile();
    if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });

    const { filename, contentType } = (await req.json()) as { filename?: string; contentType?: string };
    if (!filename || !ALLOWED_EXT.test(filename)) {
      return NextResponse.json({ error: "Недопустимое имя файла — разрешены mp4, mov, jpg, jpeg, png, webp" }, { status: 400 });
    }

    const name = filename.trim();
    // Папка берётся из сессии, а не из имени файла: кто нажал кнопку, тот и
    // владелец (Decision 034). У владельца и тимлида кода нет — им остаётся
    // прежняя раскладка по первым буквам имени, ничего не переезжает.
    // Подход при этом читается из самого кода крео, а не из папки (Decision 026),
    // так что смена папки ни на что в интерфейсе не влияет.
    const folder = me.buyer_code ?? extractFolder(name);
    const key = `${folder}/${name}`;
    const creativeCode = getFileBaseName(key);

    // Мягкая сверка: bN в имени против того, кто грузит. Не запрет — человек
    // может залить чужой файл осознанно. Но расхождение стоит показать: с ним
    // имя разъедется с картотекой и с матчингом по коду.
    const codeBuyer = buyerOf(creativeCode);
    const warning =
      me.buyer_code && codeBuyer && codeBuyer !== me.buyer_code
        ? `Ты ${me.buyer_code}, а в коде ${codeBuyer}. Файл загрузится, но имя разойдётся с картотекой`
        : undefined;

    let exists = true;
    try {
      await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
    } catch {
      exists = false;
    }

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, ContentType: contentType || "application/octet-stream" }),
      { expiresIn: 600 }
    );

    // Владелец пишется здесь, при выдаче ссылки, а не после успешной загрузки:
    // браузер грузит файл напрямую в R2 и о результате нам не сообщает. Цена —
    // строка на файл, который передумали грузить. Она ничего не ломает: как
    // признак существования файла эта таблица не используется.
    const supabase = await createClient();
    const { error: recordError } = await supabase.from("creative_uploads").upsert(
      { creative_code: creativeCode, object_key: key, user_id: me.id, buyer_code: me.buyer_code, uploaded_at: new Date().toISOString() },
      { onConflict: "creative_code" }
    );
    // Не роняем загрузку из-за неудачной записи: файл важнее отметки о нём.
    if (recordError) console.error("Не записан владелец загрузки:", recordError.message);

    return NextResponse.json({ uploadUrl, key, exists, warning, publicUrl: `${process.env.R2_PUBLIC_URL}/${key}` });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create upload URL" }, { status: 500 });
  }
}
