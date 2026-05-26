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

export async function GET() {
  try {
    const command = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
    });

    const response = await s3.send(command);

    const files =
      response.Contents?.map((file) => ({
        key: file.Key,
        url: `${process.env.R2_PUBLIC_URL}/${file.Key}`,
      })) || [];

    return NextResponse.json(files, {
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