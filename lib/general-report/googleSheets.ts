import crypto from "node:crypto";

// Minimal Google Sheets API v4 client via service-account JWT.
// No SDK dependency — token exchange and REST calls are ~40 lines.

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

let cachedToken: { token: string; expiresAt: number } | null = null;

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY env vars");
  }
  const key = rawKey.replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: email,
    scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signature = crypto
    .sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), key)
    .toString("base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${payload}.${signature}`,
    }),
  });
  const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!json.access_token) {
    throw new Error(`Google token exchange failed: ${json.error ?? "unknown"} ${json.error_description ?? ""}`);
  }
  cachedToken = { token: json.access_token, expiresAt: Date.now() + 3600_000 };
  return json.access_token;
}

// Sheets to never treat as country/source data
const EXCLUDED_SHEETS = /^(TOTAL|📋|_DATA)/;

export async function listSheetTitles(spreadsheetId: string): Promise<string[]> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const json = (await res.json()) as {
    sheets?: { properties: { title: string } }[];
    error?: { message: string };
  };
  if (json.error) throw new Error(`Sheets meta failed: ${json.error.message}`);
  return (json.sheets ?? []).map((s) => s.properties.title);
}

export async function listCountrySheets(spreadsheetId: string): Promise<string[]> {
  const titles = await listSheetTitles(spreadsheetId);
  return titles.filter((t) => !EXCLUDED_SHEETS.test(t));
}

// Fetch raw values for all given sheets in one batchGet.
// UNFORMATTED_VALUE + SERIAL_NUMBER → numbers stay numbers, dates stay Excel serials.
export async function fetchSheetValues(
  spreadsheetId: string,
  sheetTitles: string[]
): Promise<Map<string, unknown[][]>> {
  const token = await getAccessToken();
  const params = new URLSearchParams({
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  // Unbounded rows on purpose: a country sheet already holds ~730 day rows plus weekly and
  // month label rows, so the old A1:AE1000 was about to start truncating silently. Sheets
  // trims the response to the populated range, so asking for whole columns costs nothing.
  // Apostrophes in a sheet title must be doubled or the range fails to parse.
  for (const title of sheetTitles) {
    params.append("ranges", `'${title.replace(/'/g, "''")}'!A:AE`);
  }

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const json = (await res.json()) as {
    valueRanges?: { range: string; values?: unknown[][] }[];
    error?: { message: string };
  };
  if (json.error) throw new Error(`Sheets batchGet failed: ${json.error.message}`);

  const result = new Map<string, unknown[][]>();
  (json.valueRanges ?? []).forEach((vr, i) => {
    result.set(sheetTitles[i], vr.values ?? []);
  });
  return result;
}
