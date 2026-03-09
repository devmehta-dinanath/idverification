// scripts/test_reservation_simple.js
// Simple test using the same pattern as other scripts
require('dotenv').config({ path: '.env.local' });
const fetch = require('node-fetch');

const API_KEY = process.env.CLOUDBEDS_API_KEY;
const PROPERTY_ID = "172982356828288"; // Sukhumvit 36
const bookingRef = process.argv[2] || "4EJ4Y6GB8P";

async function testReservationAndKeys() {
    console.log("=".repeat(60));
    console.log("TESTING RESERVATION LOOKUP & DOOR LOCK KEYS");
    console.log("=".repeat(60));
    console.log(`Booking Reference: ${bookingRef}\n`);

    if (!API_KEY) {
        console.error("❌ Missing CLOUDBEDS_API_KEY in .env.local");
        return;
    }

    try {
        // Step 1: Lookup reservation
        console.log("📋 Step 1: Looking up reservation...");
        const resUrl = `https://api.cloudbeds.com/api/v1.2/getReservation?reservationID=${encodeURIComponent(bookingRef)}&propertyID=${PROPERTY_ID}`;
        const resRes = await fetch(resUrl, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/json'
            }
        });
        const resData = await resRes.json();

        if (!resData.success || !resData.data) {
            console.log("   ❌ Reservation not found");
            console.log(`   Error: ${resData.message || "Unknown error"}`);
            return;
        }

        const reservation = resData.data;
        console.log("   ✅ Reservation found!");
        console.log(`      Guest: ${reservation.firstName || ""} ${reservation.lastName || ""}`);
        console.log(`      Reservation ID: ${reservation.reservationID}`);
        console.log(`      Status: ${reservation.status}`);
        console.log(`      Room: ${reservation.roomNumber || reservation.assignedRoom || "N/A"}`);

        // Step 2: Get door lock keys
        console.log("\n📋 Step 2: Fetching door lock keys...");
        const keysUrl = `https://api.cloudbeds.com/doorlock/v1/keys/${PROPERTY_ID}`;
        const keysRes = await fetch(keysUrl, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/json'
            }
        });
        const keysData = await keysRes.json();

        const keys = Array.isArray(keysData.data) ? keysData.data : Array.isArray(keysData) ? keysData : [];
        
        if (keys.length === 0) {
            console.log("   ⚠️  No door lock keys found in Cloudbeds");
            console.log("   💡 This means:");
            console.log("      - No keys are configured in Cloudbeds for this property");
            console.log("      - TTLock integration is not synced");
            console.log("      - Keys need to be added manually or via TTLock sync");
        } else {
            console.log(`   ✅ Found ${keys.length} door lock key(s):`);
            
            // Try to find a key matching this reservation
            const roomNumber = reservation.roomNumber || reservation.assignedRoom || "";
            const matchingKeys = keys.filter(key => {
                const keyRoom = String(key.roomName || key.room_name || key.roomId || "").toLowerCase();
                const resRoom = String(roomNumber).toLowerCase();
                return keyRoom.includes(resRoom) || resRoom.includes(keyRoom) || 
                       String(key.reservationID || key.reservation_id || "") === String(reservation.reservationID);
            });

            if (matchingKeys.length > 0) {
                const key = matchingKeys[0];
                const code = key.code || key.access_code || key.pin || key.keyCode;
                console.log(`\n   🎉 MATCHING KEY FOUND FOR THIS RESERVATION:`);
                console.log(`      Access Code: ${code}`);
                console.log(`      Room: ${key.roomName || key.room_name || "N/A"}`);
                console.log(`      Status: ${key.status || "N/A"}`);
            } else {
                console.log(`\n   ⚠️  No matching key found for room "${roomNumber}"`);
                console.log("   Available keys:");
                keys.slice(0, 5).forEach((key, i) => {
                    console.log(`      Key ${i + 1}: Room=${key.roomName || key.room_name || "N/A"}, Code=${key.code || key.access_code || "N/A"}`);
                });
            }
        }

        console.log("\n" + "=".repeat(60));
        console.log("✅ TEST COMPLETED");
        console.log("=".repeat(60));

    } catch (error) {
        console.error("\n❌ TEST FAILED");
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

testReservationAndKeys();


