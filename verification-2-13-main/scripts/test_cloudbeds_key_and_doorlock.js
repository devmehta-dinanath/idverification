/**
 * Test Cloudbeds API key: hotel details + door lock keys.
 * Run: CLOUDBEDS_API_KEY=cbat_xxx node scripts/test_cloudbeds_key_and_doorlock.js
 */
require("dotenv").config({ path: ".env.local" });
const fetch = require("node-fetch");

const API_KEY = process.env.CLOUDBEDS_API_KEY || "cbat_iY9PDlWCRnqBToi5eYXLWLIU08RnF9pl";
const DOORLOCK_API_BASE = "https://api.cloudbeds.com/doorlock/v1";
const PROPERTY_IDS = ["172982356828288"];

async function testHotelDetails() {
    console.log("\n--- 1. Hotel details (getHotelDetails) ---");
    console.log("Key:", API_KEY ? API_KEY.slice(0, 12) + "..." : "MISSING");
    if (!API_KEY) {
        console.error("No CLOUDBEDS_API_KEY set.");
        return false;
    }
    try {
        const res = await fetch("https://api.cloudbeds.com/api/v1.1/getHotelDetails", {
            headers: {
                Authorization: `Bearer ${API_KEY}`,
                Accept: "application/json",
            },
        });
        const json = await res.json();
        console.log("Status:", res.status);
        if (json.success && json.data) {
            console.log("✅ Key valid. Property:", json.data.propertyName || json.data.propertyID);
            return true;
        }
        console.log("❌ Failed:", json.message || JSON.stringify(json));
        return false;
    } catch (e) {
        console.error("Request failed:", e.message);
        return false;
    }
}

async function testDoorLockKeys(propertyID) {
    const res = await fetch(`${DOORLOCK_API_BASE}/keys/${propertyID}`, {
        headers: {
            Authorization: `Bearer ${API_KEY}`,
            Accept: "application/json",
        },
    });
    const json = await res.json();
    return { status: res.status, json, propertyID };
}

async function main() {
    const ok = await testHotelDetails();
    if (!ok) {
        console.log("\nSkipping door lock test (key invalid).");
        process.exit(1);
    }

    console.log("\n--- 2. Door lock keys (per property) ---");
    for (const propertyID of PROPERTY_IDS) {
        const { status, json, propertyID: pid } = await testDoorLockKeys(propertyID);
        console.log(`  Property ${pid}: HTTP ${status}`);
        if (status === 200) {
            const data = json.data ?? json;
            const arr = Array.isArray(data) ? data : (data && data.keys) ? data.keys : [];
            if (arr.length > 0) {
                console.log(`    ✅ ${arr.length} key(s) found`);
                const first = arr[0];
                const code = first.code || first.access_code || first.pin || first.keyCode;
                if (code) console.log(`    Sample code field present: yes`);
            } else if (json.error || json.message) {
                console.log(`    ⚠️ ${json.error || json.message}`);
            } else {
                console.log(`    No keys in response (empty or different format).`);
                console.log(`    Raw response keys:`, Object.keys(json));
                if (Object.keys(json).length <= 3) console.log(`    Raw body:`, JSON.stringify(json));
            }
        } else {
            console.log(`    ❌ ${json.error || json.message || JSON.stringify(json)}`);
        }
    }

    // 3. Explicit access code test for Roomquest Sukhumvit 36 (property 172982356828288)
    const TARGET_PROPERTY = "172982356828288";
    console.log("\n--- 3. Access code for property " + TARGET_PROPERTY + " (Roomquest Sukhumvit 36) ---");
    const { status: keyStatus, json: keyJson } = await testDoorLockKeys(TARGET_PROPERTY);
    const keyData = keyJson.data ?? keyJson;
    const keyArr = Array.isArray(keyData) ? keyData : (keyData && keyData.keys) ? keyData.keys : [];
    let accessCode = null;
    if (keyStatus === 200 && keyArr.length > 0) {
        const now = new Date();
        const anyActive = keyArr.find((k) => {
            const active = !k.status || k.status === "active" || k.status === "enabled";
            const code = k.code || k.access_code || k.pin || k.keyCode;
            let timeValid = true;
            if (k.validFrom || k.valid_from) {
                if (now < new Date(k.validFrom || k.valid_from)) timeValid = false;
            }
            if (k.validTo || k.valid_to) {
                if (now > new Date(k.validTo || k.valid_to)) timeValid = false;
            }
            return active && code && timeValid;
        });
        if (anyActive) {
            accessCode = String(anyActive.code || anyActive.access_code || anyActive.pin || anyActive.keyCode);
        }
    }
    if (accessCode) {
        console.log("  ✅ Access code generated:", accessCode);
    } else {
        console.log("  ❌ No access code (API returned " + (keyArr.length === 0 ? "no keys" : "keys but none active/valid") + ")");
    }
    console.log("\nDone.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
