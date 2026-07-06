import type { FbtoolCampaign } from "./types";

// Parses the FBTool XLSX export format:
// Row 0 = report title (skip)
// Row 1 = real headers (Кампания, Кабинет, Расход, Клики по ссылке, Показы, ...)
// Row 2+ = campaign data
//
// "Кампания" cell format: "Campaign Name (123456789012345678) ACTIVE"
export function parseFbtoolXlsx(rawRows: unknown[][]): FbtoolCampaign[] {
  if (rawRows.length < 3) return [];

  const header = (rawRows[1] as unknown[]).map((h) => String(h ?? "").trim());
  const col = (name: string) => header.findIndex((h) => String(h ?? "").includes(name));

  const campaignCol    = col("Кампания");
  const accountCol     = col("Кабинет");
  const spendCol       = col("Расход");
  const clicksCol      = col("Клики по ссылке");
  const impressionsCol = col("Показы");

  if (campaignCol === -1) return [];

  const results: FbtoolCampaign[] = [];

  for (let i = 2; i < rawRows.length; i++) {
    const row = rawRows[i] as unknown[];
    const campaignCell = String(row[campaignCol] ?? "").trim();
    if (!campaignCell) continue;

    // "Campaign Name (123456789012345678) ACTIVE"
    const match = campaignCell.match(/^(.*?)\s*\((\d+)\)\s*(.*)$/);
    if (!match) continue;

    const campaignName = match[1].trim();
    const campaignId   = match[2].trim();
    // Status is the first word after ")" — e.g. "PAUSED    Дневной бюджет..." → "PAUSED"
    const status       = match[3].trim().split(/\s+/)[0] ?? "";

    const accountCell = accountCol >= 0 ? String(row[accountCol] ?? "").trim() : "";
    // Strip from first "(" onwards: "7Genesisacademy (id)Активен..." → "7Genesisacademy"
    const accountName = accountCell.replace(/\s*\(.*$/, "").trim();

    results.push({
      campaignId,
      campaignName,
      accountName,
      spend:       ru(spendCol >= 0       ? row[spendCol]       : undefined),
      clicks:      ru(clicksCol >= 0      ? row[clicksCol]      : undefined),
      impressions: ru(impressionsCol >= 0 ? row[impressionsCol] : undefined),
      status,
      effectiveStatus: status,
    });
  }

  return results;
}

// Handles Russian number format: spaces as thousands separator, comma as decimal
function ru(v: unknown): number {
  const s = String(v ?? "").replace(/\s/g, "").replace(",", ".");
  const num = parseFloat(s);
  return isNaN(num) ? 0 : num;
}
