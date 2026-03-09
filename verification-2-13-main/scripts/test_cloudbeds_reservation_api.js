// scripts/test_cloudbeds_reservation_api.js
require('dotenv').config({ path: '.env.local' });
const fetch = require('node-fetch');

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || 'http://localhost:3000';
const TEST_BOOKING_REF = process.argv[2] || null;

async function testReservationAPI() {
    console.log("=".repeat(60));
    console.log("TESTING CLOUDBEDS RESERVATION API");
    console.log("=".repeat(60));
    console.log(`Backend URL: ${BACKEND_URL}`);
    console.log(`Test Booking Reference: ${TEST_BOOKING_REF || "NOT PROVIDED"}`);
    console.log("");

    if (!TEST_BOOKING_REF) {
        console.error("❌ Please provide a booking reference as an argument:");
        console.error("   node scripts/test_cloudbeds_reservation_api.js <booking_ref>");
        console.error("");
        console.error("Example:");
        console.error("   node scripts/test_cloudbeds_reservation_api.js 12345678");
        process.exit(1);
    }

    const testCases = [
        { reservation_id: TEST_BOOKING_REF },
        { third_party_identifier: TEST_BOOKING_REF },
    ];

    for (const testCase of testCases) {
        console.log(`\n📋 Testing with: ${JSON.stringify(testCase)}`);
        console.log(`   Endpoint: ${BACKEND_URL}/api/cloudbeds/reservation`);
        
        try {
            const res = await fetch(`${BACKEND_URL}/api/cloudbeds/reservation`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(testCase),
            });

            const data = await res.json();

            console.log(`   Status: ${res.status} ${res.statusText}`);
            
            if (res.ok && data.success) {
                console.log("   ✅ SUCCESS!");
                console.log("   Response:");
                console.log(`      Guest Name: ${data.guestName || "N/A"}`);
                console.log(`      Room Name: ${data.roomName || "N/A"}`);
                console.log(`      Access Code: ${data.accessCode || "N/A"}`);
                console.log(`      Reservation ID: ${data.reservationId || "N/A"}`);
                console.log(`      Property ID: ${data.propertyID || "N/A"}`);
                console.log(`      Guest Checked In: ${data.guestIsCheckedIn || "N/A"}`);
                return; // Success, exit
            } else {
                console.log("   ❌ Failed");
                console.log(`   Error: ${data.error || JSON.stringify(data)}`);
            }
        } catch (error) {
            console.error(`   ❌ Request failed: ${error.message}`);
            if (error.code === 'ECONNREFUSED') {
                console.error("   💡 Make sure your Next.js dev server is running:");
                console.error("      npm run dev");
            }
        }
    }

    console.log("\n" + "=".repeat(60));
    console.log("TEST SUMMARY");
    console.log("=".repeat(60));
    console.log("❌ All lookup methods failed");
    console.log("\n💡 Troubleshooting:");
    console.log("   1. Make sure Next.js dev server is running: npm run dev");
    console.log("   2. Verify the booking reference exists in Cloudbeds");
    console.log("   3. Check that CLOUDBEDS_API_KEY is set in .env.local");
    console.log("   4. Verify the API key has access to the property");
}

testReservationAPI();


