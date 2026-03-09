/**
 * lib/google-sheets.js
 * Appends a verified guest row to a Google Spreadsheet.
 *
 * Required env vars:
 *   GOOGLE_SHEETS_SPREADSHEET_ID  – the ID from the sheet URL
 *                                   https://docs.google.com/spreadsheets/d/<ID>/edit
 *   GOOGLE_SERVICE_ACCOUNT_JSON   – full service account JSON as a string,
 *                                   OR its base64-encoded equivalent
 *   GOOGLE_SHEETS_TAB_NAME        – (optional) tab/sheet name, default "Sheet1"
 *
 * Setup steps:
 *   1. Go to console.cloud.google.com → create a project
 *   2. Enable "Google Sheets API"
 *   3. Create a Service Account → download JSON key
 *   4. Paste the JSON (or its base64) into GOOGLE_SERVICE_ACCOUNT_JSON env var
 *   5. Open your Google Sheet → Share → add the service account email (Editor)
 *   6. Copy the spreadsheet ID from the URL into GOOGLE_SHEETS_SPREADSHEET_ID
 *
 * Row columns (in order):
 *   First Name | Middle Name | Last Name | Gender | Passport No. | Nationality
 *   Birth Date | Start Date  | End Date  | Room   | Room Type    | Phone
 *   Email      | Verified At | Verification Score
 */

import { google } from "googleapis";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "11vPwA6TfsSWPBfpp6TSYWv-ZGf9fsCEg63teg5OojeA";
const TAB_NAME = process.env.GOOGLE_SHEETS_TAB_NAME || "Sheet1";

function parseServiceAccount() {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) return null;
    try {
        // Support both raw JSON string and base64-encoded JSON
        const decoded = raw.trimStart().startsWith("{")
            ? raw
            : Buffer.from(raw, "base64").toString("utf8");
        return JSON.parse(decoded);
    } catch (err) {
        console.error("[google-sheets] Could not parse GOOGLE_SERVICE_ACCOUNT_JSON:", err.message);
        return null;
    }
}

const HEADERS = [
    "First Name", "Middle Name", "Last Name", "Gender",
    "Passport No.", "Nationality", "Birth Date",
    "Start Date", "End Date",
    "Phone", "Email", "Verified At",
];

/**
 * Write the header row to row 1 if it is empty.
 * Call this once from appendGuestRow so the sheet is always labelled.
 */
async function ensureHeaders(sheets, spreadsheetId, tabName) {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${tabName}!A1:L1`,
        });
        const existing = res.data.values?.[0];
        // Only skip if row 1 already has the correct header in A1
        if (existing?.[0] === "First Name") return;
        // Otherwise insert a new row at position 1 and write headers there
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    insertDimension: {
                        range: { sheetId: 0, dimension: "ROWS", startIndex: 0, endIndex: 1 },
                        inheritFromBefore: false,
                    },
                }],
            },
        });
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${tabName}!A1`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [HEADERS] },
        });
        console.log("[google-sheets] Header row inserted at row 1");
    } catch (err) {
        console.warn("[google-sheets] Could not ensure headers:", err.message);
    }
}

/**
 * Check if a row with the same passport + start date already exists.
 * Passport is column E (index 4), Start Date is column H (index 7).
 * Returns true if a duplicate is found.
 */
async function isDuplicate(sheets, spreadsheetId, tabName, passport, startDate) {
    if (!passport) return false; // can't dedupe without passport
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${tabName}!A2:L`,  // skip header row
        });
        const rows = res.data.values || [];
        for (const row of rows) {
            const existingPassport = (row[4] || "").trim();
            const existingStart   = (row[7] || "").trim();
            if (
                existingPassport.toLowerCase() === passport.toLowerCase() &&
                existingStart === startDate
            ) {
                return true;
            }
        }
        return false;
    } catch (err) {
        console.warn("[google-sheets] Duplicate check failed (allowing append):", err.message);
        return false;
    }
}

/**
 * Append a single guest row to the configured Google Sheet.
 * @param {object} guestData
 * @param {string} guestData.firstName
 * @param {string} [guestData.middleName]
 * @param {string} guestData.lastName
 * @param {string} [guestData.gender]
 * @param {string} [guestData.passport]
 * @param {string} [guestData.nationality]   – ISO country code e.g. "CN"
 * @param {string} [guestData.birthDate]
 * @param {string} [guestData.startDate]     – check-in
 * @param {string} [guestData.endDate]       – check-out
 * @param {string} [guestData.phone]
 * @param {string} [guestData.email]
 * @param {string} [guestData.verifiedAt]    – ISO timestamp
 */
export async function appendGuestRow(guestData) {
    if (!SPREADSHEET_ID) {
        console.warn("[google-sheets] GOOGLE_SHEETS_SPREADSHEET_ID not set – skipping append");
        return;
    }

    const serviceAccount = parseServiceAccount();
    if (!serviceAccount) {
        console.warn("[google-sheets] GOOGLE_SERVICE_ACCOUNT_JSON not set – skipping append");
        return;
    }

    try {
        const auth = new google.auth.GoogleAuth({
            credentials: serviceAccount,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });

        const sheets = google.sheets({ version: "v4", auth });

        // Write headers on row 1 if the sheet is empty
        await ensureHeaders(sheets, SPREADSHEET_ID, TAB_NAME);

        // Deduplicate: skip if same passport + start date already exists
        const duplicate = await isDuplicate(sheets, SPREADSHEET_ID, TAB_NAME, guestData.passport, guestData.startDate || "");
        if (duplicate) {
            console.log(`[google-sheets] Skipping duplicate entry for passport ${guestData.passport} (${guestData.startDate})`);
            return;
        }

        const row = [
            guestData.firstName || "",
            guestData.middleName || "",
            guestData.lastName || "",
            guestData.gender || "",
            guestData.passport || "",
            guestData.nationality || "",
            guestData.birthDate || "",
            guestData.startDate || "",
            guestData.endDate || "",
            guestData.phone || "",
            guestData.email || "",
            guestData.verifiedAt || new Date().toISOString(),
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${TAB_NAME}!A:L`,
            valueInputOption: "USER_ENTERED",
            insertDataOption: "INSERT_ROWS",
            requestBody: { values: [row] },
        });

        console.log(
            `[google-sheets] ✓ Row appended for ${guestData.firstName} ${guestData.lastName} (${guestData.passport})`
        );
    } catch (err) {
        console.error("[google-sheets] Failed to append row:", err.message);
        throw err;
    }
}
