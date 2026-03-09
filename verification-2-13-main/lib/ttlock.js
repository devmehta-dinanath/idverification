/**
 * TTLock Open Platform API client.
 * Used to list locks and create passcodes directly (no Cloudbeds TTLock subscription).
 * Requires: TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET, and TTLOCK_USERNAME + TTLOCK_PASSWORD (TTLock app user that has the locks).
 */
import crypto from "crypto";

const TTLOCK_API_BASE = "https://euapi.ttlock.com";

const CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const USERNAME = process.env.TTLOCK_USERNAME;
const PASSWORD = process.env.TTLOCK_PASSWORD;

let cachedToken = null;
let cachedTokenExpiry = 0;

function isConfigured() {
    return !!(CLIENT_ID && CLIENT_SECRET && USERNAME && PASSWORD);
}

/**
 * Get OAuth2 access token (Resource Owner Password flow).
 * Password is sent as MD5 hash per TTLock docs.
 */
export async function getAccessToken() {
    if (!isConfigured()) {
        throw new Error("TTLock not configured: set TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET, TTLOCK_USERNAME, TTLOCK_PASSWORD");
    }
    if (cachedToken && Date.now() < cachedTokenExpiry) {
        return cachedToken;
    }

    const passwordMd5 = crypto.createHash("md5").update(PASSWORD).digest("hex").toLowerCase();
    const params = new URLSearchParams();
    params.append("clientId", CLIENT_ID);
    params.append("clientSecret", CLIENT_SECRET);
    params.append("username", USERNAME);
    params.append("password", passwordMd5);

    const res = await fetch(`${TTLOCK_API_BASE}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });

    const json = await res.json();
    if (!res.ok || !json.access_token) {
        const msg = json.errmsg || json.error_description || json.message || JSON.stringify(json);
        throw new Error(`TTLock token failed: ${msg}`);
    }

    cachedToken = json.access_token;
    // Default expiry 90 days; refresh 1 day early
    cachedTokenExpiry = Date.now() + (Math.min(Number(json.expires_in) || 7776000, 7776000) - 86400) * 1000;
    return cachedToken;
}

/**
 * List locks for the authenticated TTLock user.
 * @returns {Promise<Array<{ lockId: number, lockName: string, lockAlias?: string, keyboardPwdVersion: number }>>}
 */
export async function listLocks(pageNo = 1, pageSize = 20) {
    const token = await getAccessToken();
    const params = new URLSearchParams();
    params.append("clientId", CLIENT_ID);
    params.append("accessToken", token);
    params.append("pageNo", String(pageNo));
    params.append("pageSize", String(pageSize));
    params.append("date", String(Date.now()));

    const res = await fetch(`${TTLOCK_API_BASE}/v3/lock/list`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });
    const json = await res.json();

    if (json.errcode !== undefined && json.errcode !== 0) {
        throw new Error(`TTLock listLocks failed: ${json.errmsg || JSON.stringify(json)}`);
    }

    return json.list || [];
}

/**
 * Add a passcode to a lock (via gateway, addType=2).
 * Only works for locks with keyboardPwdVersion 4.
 * @param {number} lockId - Lock ID from listLocks
 * @param {string} keyboardPwd - The passcode (e.g. 6 digits)
 * @param {number} startDate - Start time (ms)
 * @param {number} endDate - End time (ms)
 * @param {string} [name] - Optional passcode name
 * @returns {Promise<number>} keyboardPwdId
 */
export async function addPasscode(lockId, keyboardPwd, startDate, endDate, name = "Kiosk visitor") {
    const token = await getAccessToken();
    const params = new URLSearchParams();
    params.append("clientId", CLIENT_ID);
    params.append("accessToken", token);
    params.append("lockId", String(lockId));
    params.append("keyboardPwd", keyboardPwd);
    params.append("keyboardPwdName", name);
    params.append("startDate", String(startDate));
    params.append("endDate", String(endDate));
    params.append("addType", "2"); // 2 = via gateway (API only)
    params.append("date", String(Date.now()));

    const res = await fetch(`${TTLOCK_API_BASE}/v3/keyboardPwd/add`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });

    const json = await res.json();

    if (json.errcode !== undefined && json.errcode !== 0) {
        throw new Error(`TTLock addPasscode failed: ${json.errmsg || JSON.stringify(json)}`);
    }

    return json.keyboardPwdId;
}

/**
 * Generate a random 6-digit passcode.
 */
export function generatePasscode() {
    const n = Math.floor(100000 + Math.random() * 900000);
    return String(n);
}

/**
 * Get a visitor access code: use first available lock and create a temporary passcode (e.g. valid 24h).
 * @param {Object} [options]
 * @param {number} [options.validHours] - Hours the code is valid (default 24)
 * @returns {{ code: string, lockId: number } | null}
 */
export async function getOrCreateVisitorPasscode({ validHours = 24 } = {}) {
    if (!isConfigured()) return null;

    try {
        const locks = await listLocks(1, 5);
        if (!locks || locks.length === 0) {
            console.log("[ttlock] No locks found for account");
            return null;
        }

        const lock = locks[0];
        const lockId = lock.lockId;
        const startDate = Date.now();
        const endDate = startDate + validHours * 60 * 60 * 1000;
        const code = generatePasscode();

        await addPasscode(lockId, code, startDate, endDate, "Kiosk visitor");
        console.log(`[ttlock] Created visitor passcode for lock ${lockId}`);
        return { code, lockId };
    } catch (err) {
        console.warn("[ttlock] getOrCreateVisitorPasscode failed:", err.message);
        return null;
    }
}

export { isConfigured };
