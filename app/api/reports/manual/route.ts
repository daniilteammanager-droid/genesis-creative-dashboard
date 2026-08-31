// ВНИМАНИЕ: этот роут больше никто не зовёт. Ручной режим убран из Reports, а
// ручной чек разбирает XLSX прямо в браузере через lib/forex-check.
//
// Здесь он оставлен до решения владельца — см. такой же комментарий в
// app/api/reports-live/route.ts.
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { parseMvpXlsx } from "@/lib/reports/parseMvpXlsx";
import { parseFbtoolXlsx } from "@/lib/reports/parseFbtoolXlsx";
import { buildReportRows } from "@/lib/reports/buildReportRows";

export async function POST(req: Request) {
  try {
    const formData   = await req.formData();
    const mvpFile    = formData.get("mvpFile")    as File | null;
    const fbtoolFile = formData.get("fbtoolFile") as File | null;

    if (!mvpFile || !fbtoolFile) {
      return NextResponse.json(
        { error: "Both mvpFile and fbtoolFile are required" },
        { status: 400 }
      );
    }

    // raw: false → all cell values as strings; preserves large numeric IDs accurately
    const mvpWb  = XLSX.read(Buffer.from(await mvpFile.arrayBuffer()),    { type: "buffer" });
    const mvpWs  = mvpWb.Sheets[mvpWb.SheetNames[0]];
    const mvpRows = parseMvpXlsx(
      XLSX.utils.sheet_to_json<unknown[]>(mvpWs, { header: 1, raw: false })
    );

    const fbtoolWb  = XLSX.read(Buffer.from(await fbtoolFile.arrayBuffer()), { type: "buffer" });
    const fbtoolWs  = fbtoolWb.Sheets[fbtoolWb.SheetNames[0]];
    const fbCampaigns = parseFbtoolXlsx(
      XLSX.utils.sheet_to_json<unknown[]>(fbtoolWs, { header: 1, raw: false })
    );

    const { rows, summary } = buildReportRows(mvpRows, fbCampaigns);

    return NextResponse.json({
      rows,
      summary,
      generatedAt: new Date().toISOString(),
      dataFile: { mvp: mvpFile.name, fbtool: fbtoolFile.name },
      sheets: [],
      selectedSheet: "",
      apiErrors: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Manual report error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
