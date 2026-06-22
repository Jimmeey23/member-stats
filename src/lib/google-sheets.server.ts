// Server-only Google Sheets helpers using OAuth refresh-token flow.

const SHEET_ID = "1jugNIhmKpiL9llA5R3SFSMA9HIoCpykx4yGzfvfN0F4";
const SHEET_NAME = "Member Data";

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google OAuth credentials missing");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

export async function readSheet(): Promise<{ headers: string[]; rows: string[][] }> {
  const token = await getAccessToken();
  const range = encodeURIComponent(`${SHEET_NAME}!A1:ZZ`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Sheets read failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { values?: string[][] };
  const values = json.values ?? [];
  if (values.length === 0) return { headers: [], rows: [] };
  return { headers: values[0], rows: values.slice(1) };
}

export async function writeMemberRow(memberId: string, updates: Record<string, string>): Promise<void> {
  // Find the row by Member ID and update specific columns
  const token = await getAccessToken();
  const { headers, rows } = await readSheet();
  const idCol = headers.indexOf("Member ID");
  if (idCol === -1) throw new Error("Member ID column not found");
  const rowIdx = rows.findIndex((r) => r[idCol] === memberId);
  if (rowIdx === -1) throw new Error("Member not found in sheet");

  const updatesArr: { range: string; values: string[][] }[] = [];
  for (const [field, value] of Object.entries(updates)) {
    const colIdx = headers.indexOf(field);
    if (colIdx === -1) continue;
    const colLetter = columnLetter(colIdx);
    const sheetRow = rowIdx + 2; // +1 for header, +1 for 1-indexed
    updatesArr.push({
      range: `${SHEET_NAME}!${colLetter}${sheetRow}`,
      values: [[value]],
    });
  }
  if (updatesArr.length === 0) return;

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: updatesArr }),
    },
  );
  if (!res.ok) throw new Error(`Sheet write failed: ${res.status} ${await res.text()}`);
}

function columnLetter(idx: number): string {
  let s = "";
  let n = idx;
  while (n >= 0) { s = String.fromCharCode((n % 26) + 65) + s; n = Math.floor(n / 26) - 1; }
  return s;
}
