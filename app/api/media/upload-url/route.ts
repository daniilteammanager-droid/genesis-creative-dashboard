import { NextResponse } from "next/server";
import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
    const { filename, contentType } = (await req.json()) as { filename?: string; contentType?: string };
    if (!filename || !ALLOWED_EXT.test(filename)) {
      return NextResponse.json({ error: "Недопустимое имя файла — разрешены mp4, mov, jpg, jpeg, png, webp" }, { status: 400 });
    }

    // basename matches findMedia()'s expected key; folder groups new uploads by creative prefix.
    const key = `${extractFolder(filename.trim())}/${filename.trim()}`;

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

    return NextResponse.json({ uploadUrl, key, exists, publicUrl: `${process.env.R2_PUBLIC_URL}/${key}` });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create upload URL" }, { status: 500 });
  }
}
