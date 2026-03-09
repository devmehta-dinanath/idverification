// scripts/test_reservation_direct.js
// Direct test of reservation lookup and access code fetching (no HTTP server needed)
require('dotenv').config({ path: '.env.local' });

// Since we're in a Node.js script, we need to use dynamic imports or require
async function testDirect() {
    console.log("=".repeat(60));
    console.log("TESTING RESERVATION LOOKUP & ACCESS CODE (DIRECT)");
    console.log("=".repeat(60));
    
    const bookingRef = process.argv[2] || "4EJ4Y6GB8P";
    console.log(`Testing with booking reference: ${bookingRef}\n`);

    try {
        // Import the functions
        const { lookupGuestReservation } = await import('../lib/cloudbeds.js');
        const { getAccessCode } = await import('../lib/access-codes.js');

        // Step 1: Lookup reservation
        console.log("📋 Step 1: Looking up reservation in Cloudbeds...");
        const cbResult = await lookupGuestReservation("", bookingRef);
        
        if (!cbResult.found) {
            console.log("   ❌ Reservation not found in Cloudbeds");
            console.log("\n💡 Try a different booking reference:");
            console.log("   node scripts/test_reservation_direct.js <booking_ref>");
            return;
        }

        console.log("   ✅ Reservation found!");
        console.log(`      Guest Name: ${cbResult.guestName || "N/A"}`);
        console.log(`      Room Number: ${cbResult.roomNumber || "N/A"}`);
        console.log(`      Reservation ID: ${cbResult.reservationId || "N/A"}`);
        console.log(`      Property ID: ${cbResult.propertyID || "N/A"}`);

        // Step 2: Get access code
        console.log("\n📋 Step 2: Fetching access code...");
        const accessCode = await getAccessCode({
            propertyID: cbResult.propertyID,
            roomNumber: cbResult.roomNumber,
            reservationId: cbResult.reservationId,
        });

        if (accessCode) {
            console.log(`   ✅ Access code found: ${accessCode}`);
        } else {
            console.log("   ⚠️  No access code found");
            console.log("   💡 This is expected if:");
            console.log("      - No door lock keys are configured in Cloudbeds");
            console.log("      - TTLock integration is not synced yet");
            console.log("      - Fallback schedule table is empty");
        }

        console.log("\n" + "=".repeat(60));
        console.log("✅ TEST COMPLETED");
        console.log("=".repeat(60));
        console.log(`Reservation: ${cbResult.reservationId}`);
        console.log(`Access Code: ${accessCode || "N/A (not configured)"}`);

    } catch (error) {
        console.error("\n❌ TEST FAILED");
        console.error(`Error: ${error.message}`);
        if (error.message.includes("No Cloudbeds token")) {
            console.error("\n💡 Make sure CLOUDBEDS_API_KEY is set in .env.local");
        }
        process.exit(1);
    }
}

testDirect();


