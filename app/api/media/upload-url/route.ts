import { NextResponse } from "next/server";
import { getSeat, createClient } from "@/lib/auth/server";
import { issueUpload, UploadError } from "@/lib/creatives/upload";

// Generates a presigned R2 PUT URL per file — the browser uploads directly to R2,
// never through this route, so Vercel's request-body limit never sees the video bytes.
// Compression / thumbnails / transcription are handled entirely by a separate worker
// that polls R2 on its own cron — this route only issues the upload URL. Логика — lib/creatives/upload.ts.

export async function POST(req: Request) {
  try {
    const me = await getSeat();
    if (!me) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
    const { filename, contentType, face } = (await req.json()) as { filename?: string; contentType?: string; face?: string };
    return NextResponse.json(await issueUpload(me, filename, contentType, face, await createClient()));
  } catch (error) {
    if (error instanceof UploadError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: "Failed to create upload URL" }, { status: 500 });
  }
}
