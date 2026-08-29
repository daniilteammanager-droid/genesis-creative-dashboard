import { NextResponse } from "next/server";
import { S3Client, CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

// Rename / delete an already-uploaded R2 object. R2 has no native rename,
// so rename = copy to the new key + delete the old one (thumbnail moved the same way).

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const ALLOWED_EXT = /\.(mov|mp4|jpg|jpeg|png|webp)$/i;
const Bucket = process.env.R2_BUCKET_NAME;

// The worker writes previews as thumbnails/<basename>.<img ext> — the video's own .mp4/.mov
// never appears there, which is exactly why /api/media pairs them up by basename alone.
// Building `thumbnails/foo.mp4` here matched nothing, so renames orphaned the preview and
// deletes left it behind forever. Extension isn't guaranteed, so probe the ones in use.
const THUMB_EXTS = ["jpg", "webp"];

function baseName(key: string): string {
  return (key.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
}

async function findThumbnail(key: string): Promise<string | undefined> {
  const base = baseName(key);
  for (const ext of THUMB_EXTS) {
    const candidate = `thumbnails/${base}.${ext}`;
    if (await objectExists(candidate)) return candidate;
  }
  return undefined;
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function copyAndDelete(fromKey: string, toKey: string) {
  await s3.send(new CopyObjectCommand({ Bucket, CopySource: `${Bucket}/${encodeURIComponent(fromKey)}`, Key: toKey }));
  await s3.send(new DeleteObjectCommand({ Bucket, Key: fromKey }));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { op?: "rename" | "delete"; key?: string; newName?: string };
    const { op, key } = body;
    if (!key) return NextResponse.json({ error: "Не указан key" }, { status: 400 });

    if (op === "delete") {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
      const thumb = await findThumbnail(key);
      if (thumb) await s3.send(new DeleteObjectCommand({ Bucket, Key: thumb }));
      return NextResponse.json({ ok: true });
    }

    if (op === "rename") {
      const newName = body.newName?.trim();
      if (!newName || !ALLOWED_EXT.test(newName)) {
        return NextResponse.json({ error: "Недопустимое имя файла — разрешены mp4, mov, jpg, jpeg, png, webp" }, { status: 400 });
      }
      const folder = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
      const newKey = folder ? `${folder}/${newName}` : newName;
      if (newKey === key) return NextResponse.json({ ok: true, key: newKey });
      if (await objectExists(newKey)) {
        return NextResponse.json({ error: "Файл с таким именем уже существует" }, { status: 409 });
      }

      await copyAndDelete(key, newKey);
      const thumb = await findThumbnail(key);
      // Keep the preview's own extension — only the basename follows the rename.
      if (thumb) await copyAndDelete(thumb, `thumbnails/${baseName(newName)}.${thumb.split(".").pop()}`);
      return NextResponse.json({ ok: true, key: newKey });
    }

    return NextResponse.json({ error: "Неизвестная операция" }, { status: 400 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Media manage failed" }, { status: 500 });
  }
}
