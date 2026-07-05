import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import * as XLSX from "xlsx";
import { parseMvpReport } from "@/lib/reports/parseMvpReport";
import { parseFbtoolReport } from "@/lib/reports/parseFbtoolReport";
import { buildReportRows } from "@/lib/reports/buildReportRows";

function findLatestFile(dir: string, ext: string): string | null {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort();
    return files.length > 0 ? path.join(dir, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const dataDir = path.join(process.cwd(), "test-data");
    const mvpPath    = findLatestFile(path.join(dataDir, "mvp"), ".xlsx");
    const fbtoolPath = findLatestFile(path.join(dataDir, "fbtool"), ".json");

    if (!mvpPath || !fbtoolPath) {
      return NextResponse.json(
        { error: "Test data files not found in test-data/mvp/ or test-data/fbtool/" },
        { status: 404 }
      );
    }

    const mvpBuffer = fs.readFileSync(mvpPath);
    const wb = XLSX.read(mvpBuffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
    const mvpRows = parseMvpReport(rawRows);

    const fbtoolRaw = JSON.parse(fs.readFileSync(fbtoolPath, "utf8")) as unknown;
    const fbCampaigns = parseFbtoolReport(fbtoolRaw);

    const { rows, summary } = buildReportRows(mvpRows, fbCampaigns);

    return NextResponse.json({
      rows,
      summary,
      generatedAt: new Date().toISOString(),
      dataFile: {
        mvp:    path.basename(mvpPath),
        fbtool: path.basename(fbtoolPath),
      },
      // When real FBTool API is connected, populate this with per-account errors
      // using buildFbtoolApiError() from lib/reports/fbtoolApiError.ts
      apiErrors: [],
    });
  } catch (error) {
    console.error("Reports API error:", error);
    return NextResponse.json({ error: "Failed to build report" }, { status: 500 });
  }
}
