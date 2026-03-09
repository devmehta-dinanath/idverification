// scripts/test_fetch_keys.js
// Test script for fetching door lock keys using the new API endpoint
require('dotenv').config({ path: '.env.local' });
const fetch = require('node-fetch');

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || 'http://localhost:3000';
const PROPERTY_ID = "172982356828288"; // Sukhumvit 36
const roomNumber = process.argv[2] || null;
const reservationId = process.argv[3] || null;

async function testFetchKeys() {
    console.log("=".repeat(60));
    console.log("TESTING DOOR LOCK KEYS API");
    console.log("=".repeat(60));
    console.log(`Backend URL: ${BACKEND_URL}`);
    console.log(`Property ID: ${PROPERTY_ID}`);
    if (roomNumber) console.log(`Room Number: ${roomNumber}`);
    if (reservationId) console.log(`Reservation ID: ${reservationId}`);
    console.log("");

    try {
        const body = {
            property_id: PROPERTY_ID,
        };
        
        if (roomNumber) body.room_number = roomNumber;
        if (reservationId) body.reservation_id = reservationId;

        console.log(`📋 Request: POST ${BACKEND_URL}/api/cloudbeds/keys`);
        console.log(`   Body: ${JSON.stringify(body, null, 2)}\n`);

        const res = await fetch(`${BACKEND_URL}/api/cloudbeds/keys`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await res.json();

        console.log(`Status: ${res.status} ${res.statusText}\n`);

        if (res.ok && data.success) {
            console.log("✅ SUCCESS!");
            console.log(`Total keys: ${data.total || 0}`);
            console.log(`Filtered keys: ${data.filtered || 0}\n`);

            if (data.keys && data.keys.length > 0) {
                console.log("🔑 Door Lock Keys:");
                data.keys.forEach((key, i) => {
                    console.log(`\n   Key ${i + 1}:`);
                    console.log(`      Code: ${key.code || key.access_code || key.pin || key.keyCode || "N/A"}`);
                    console.log(`      Room: ${key.roomName || key.room_name || key.roomId || "N/A"}`);
                    console.log(`      Status: ${key.status || "N/A"}`);
                    console.log(`      Reservation ID: ${key.reservationID || key.reservation_id || "N/A"}`);
                    if (key.validFrom || key.valid_from) {
                        console.log(`      Valid From: ${key.validFrom || key.valid_from}`);
                    }
                    if (key.validTo || key.valid_to) {
                        console.log(`      Valid To: ${key.validTo || key.valid_to}`);
                    }
                });
            } else {
                console.log("⚠️  No keys found");
                console.log("   💡 This means:");
                console.log("      - No door lock keys are configured in Cloudbeds");
                console.log("      - TTLock integration is not synced");
                console.log("      - Keys need to be added manually or via TTLock sync");
            }
        } else {
            console.log("❌ Failed");
            console.log(`Error: ${data.error || JSON.stringify(data)}`);
        }

        console.log("\n" + "=".repeat(60));

    } catch (error) {
        console.error("\n❌ TEST FAILED");
        console.error(`Error: ${error.message}`);
        if (error.code === 'ECONNREFUSED') {
            console.error("\n💡 Make sure your Next.js dev server is running:");
            console.error("   npm run dev");
        }
        process.exit(1);
    }
}

console.log("Usage:");
console.log("  node scripts/test_fetch_keys.js [room_number] [reservation_id]");
console.log("\nExamples:");
console.log("  node scripts/test_fetch_keys.js");
console.log("  node scripts/test_fetch_keys.js 101");
console.log("  node scripts/test_fetch_keys.js 101 4EJ4Y6GB8P");
console.log("");

testFetchKeys();


