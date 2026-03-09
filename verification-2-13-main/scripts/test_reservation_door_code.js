/**
 * Test: fetch door code for a reservation from Cloudbeds.
 *
 * Usage:
 *   CLOUDBEDS_API_KEY=cbat_xxx CLOUDBEDS_RES_QUERY=<bookingRefOrResId> node scripts/test_reservation_door_code.js
 *
 * It will:
 *   1) Call getReservations(queryString=...) to find matching reservations for the property.
 *   2) For each match, call getReservation and print any custom field named "Door Code"/"Access Code"/etc.
 *   3) Show doorlock /keys response for the property.
 */
require("dotenv").config({ path: ".env.local" });
const fetch = require("node-fetch");

const API_KEY = process.env.CLOUDBEDS_API_KEY;
const PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID || "172982356828288";
const RES_QUERY = process.env.CLOUDBEDS_RES_QUERY || process.argv[2] || null;
const CLOUDBEDS_API_BASE = "https://api.cloudbeds.com/api/v1.2";
const DOORLOCK_API_BASE = "https://api.cloudbeds.com/doorlock/v1";

async function main() {
    if (!API_KEY) {
        console.error("Set CLOUDBEDS_API_KEY in .env.local or pass CLOUDBEDS_API_KEY inline.");
        process.exit(1);
    }
    const headers = { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" };

    let searchUrl;
    if (RES_QUERY) {
        console.log(`--- 1a. getReservations(queryString=${RES_QUERY}) for property ${PROPERTY_ID} ---`);
        searchUrl = `${CLOUDBEDS_API_BASE}/getReservations?queryString=${encodeURIComponent(
            RES_QUERY
        )}&propertyID=${PROPERTY_ID}&pageSize=5`;
    } else {
        // No specific reference given: fetch upcoming reservations for this property.
        const today = new Date();
        const fmt = (d) => d.toISOString().slice(0, 10);
        const from = fmt(new Date(today.getTime() - 24 * 60 * 60 * 1000));
        const to = fmt(new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000));
        console.log(
            `--- 1a. getReservations(checkInFrom=${from}, checkInTo=${to}) for property ${PROPERTY_ID} ---`
        );
        searchUrl = `${CLOUDBEDS_API_BASE}/getReservations?propertyID=${PROPERTY_ID}&checkInFrom=${from}&checkInTo=${to}&pageSize=20`;
    }

    const searchRes = await fetch(searchUrl, { headers });
    const searchJson = await searchRes.json();
    if (!searchJson.success || !Array.isArray(searchJson.data) || searchJson.data.length === 0) {
        console.log("No reservations found for that query. Raw response:", searchJson.message || searchJson);
    } else {
        console.log(`Found ${searchJson.data.length} reservation(s).`);
    }

    const reservations = Array.isArray(searchJson.data) ? searchJson.data : [];
    for (const res of reservations) {
        const reservationId = res.reservationID || res.reservationId;
        console.log(`\n=== Reservation ${reservationId} (${res.guestName || "Unknown guest"}) ===`);

        console.log("\n--- 1b. getReservation (full response keys + customFields) ---");
        const resUrl = `${CLOUDBEDS_API_BASE}/getReservation?reservationID=${reservationId}&propertyID=${PROPERTY_ID}`;
        const resRes = await fetch(resUrl, { headers });
        const resJson = await resRes.json();
        const data = resJson.success && resJson.data ? resJson.data : res;

        console.log("Top-level keys:", Object.keys(data).sort().join(", "));
        if (Array.isArray(data.customFields)) {
            console.log("\nCustom fields count:", data.customFields.length);
            data.customFields.forEach((f) =>
                console.log("  ", f.customFieldName, "=>", f.customFieldValue)
            );
            const doorField = data.customFields.find((f) =>
                /door\s*code|access\s*code|key\s*code|room\s*code/i.test(String(f.customFieldName || ""))
            );
            if (doorField) {
                console.log("\n>>> Door code from custom field:", doorField.customFieldValue);
            } else {
                console.log("\n(No custom field matching Door/Access/Key/Room Code)");
            }
        } else {
            console.log("customFields:", JSON.stringify(data.customFields));
        }
        const doorishKeys = Object.keys(data).filter((k) =>
            /door|access|code|key/i.test(k)
        );
        console.log("Data keys containing 'door/access/code/key':", doorishKeys);
        if (data.doorCode !== undefined) console.log("\n>>> data.doorCode:", data.doorCode);
        if (data.accessCode !== undefined) console.log(">>> data.accessCode:", data.accessCode);
    }

    console.log("\n--- 2. GET doorlock/v1/keys (property) ---");
    const keyRes = await fetch(`${DOORLOCK_API_BASE}/keys/${PROPERTY_ID}`, { headers });
    const keyJson = await keyRes.json();
    console.log("Keys response keys:", Object.keys(keyJson));
    const keyArr = Array.isArray(keyJson.data) ? keyJson.data : [];
    console.log("Number of keys:", keyArr.length);
    if (keyArr.length > 0) {
        console.log("First key keys:", Object.keys(keyArr[0]));
        console.log("First key sample:", JSON.stringify(keyArr[0], null, 2).slice(0, 500));
    }
    console.log("\nDone.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
