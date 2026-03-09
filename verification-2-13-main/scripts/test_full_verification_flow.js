// scripts/test_full_verification_flow.js
require('dotenv').config({ path: '.env.local' });
const fetch = require('node-fetch');

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || 'http://localhost:3000';
const TEST_BOOKING_REF = process.argv[2] || null;
const TEST_GUEST_NAME = process.argv[3] || "Test Guest";

async function testFullFlow() {
    console.log("=".repeat(60));
    console.log("TESTING FULL VERIFICATION FLOW");
    console.log("=".repeat(60));
    console.log(`Backend URL: ${BACKEND_URL}`);
    console.log(`Test Booking Reference: ${TEST_BOOKING_REF || "NOT PROVIDED"}`);
    console.log(`Test Guest Name: ${TEST_GUEST_NAME}`);
    console.log("");

    if (!TEST_BOOKING_REF) {
        console.error("❌ Please provide a booking reference:");
        console.error("   node scripts/test_full_verification_flow.js <booking_ref> [guest_name]");
        process.exit(1);
    }

    let sessionToken = null;

    try {
        // Step 1: Start session
        console.log("\n📝 Step 1: Starting session...");
        const startRes = await fetch(`${BACKEND_URL}/api/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "start", flow_type: "guest" }),
        });
        const startData = await startRes.json();
        if (!startData.success) {
            throw new Error(`Failed to start session: ${startData.error}`);
        }
        sessionToken = startData.session_token;
        console.log(`   ✅ Session created: ${sessionToken}`);

        // Step 2: Log consent
        console.log("\n📝 Step 2: Logging consent...");
        const consentRes = await fetch(`${BACKEND_URL}/api/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "log_consent",
                session_token: sessionToken,
                consent_given: true,
            }),
        });
        const consentData = await consentRes.json();
        if (!consentData.success) {
            throw new Error(`Failed to log consent: ${consentData.error}`);
        }
        console.log("   ✅ Consent logged");

        // Step 3: Update guest (this is where Cloudbeds lookup happens)
        console.log("\n📝 Step 3: Updating guest info (Cloudbeds lookup)...");
        const guestRes = await fetch(`${BACKEND_URL}/api/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "update_guest",
                session_token: sessionToken,
                guest_name: TEST_GUEST_NAME,
                booking_ref: TEST_BOOKING_REF,
            }),
        });
        const guestData = await guestRes.json();
        
        if (guestRes.status === 404 || guestRes.status === 403) {
            console.log(`   ❌ Reservation not found: ${guestData.error}`);
            console.log("\n💡 This could mean:");
            console.log("   - Booking reference doesn't exist in Cloudbeds");
            console.log("   - Guest name doesn't match");
            console.log("   - Reservation not checked in");
            return;
        }
        
        if (!guestData.success) {
            throw new Error(`Failed to update guest: ${guestData.error}`);
        }
        console.log("   ✅ Guest info updated");
        console.log(`      Room: ${guestData.room_number || "N/A"}`);
        console.log(`      Access Code: ${guestData.access_code || "N/A"}`);
        console.log(`      Reservation ID: ${guestData.reservation_id || "N/A"}`);

        // Step 4: Get session to verify data was saved
        console.log("\n📝 Step 4: Retrieving session data...");
        const sessionRes = await fetch(`${BACKEND_URL}/api/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "get_session",
                session_token: sessionToken,
            }),
        });
        const sessionData = await sessionRes.json();
        if (!sessionData.success) {
            throw new Error(`Failed to get session: ${sessionData.error}`);
        }
        console.log("   ✅ Session retrieved");
        console.log(`      Cloudbeds Reservation ID: ${sessionData.session.cloudbeds_reservation_id || "N/A"}`);
        console.log(`      Room Access Code: ${sessionData.session.roomAccessCode || "N/A"}`);
        console.log(`      Physical Room: ${sessionData.session.physical_room || "N/A"}`);

        console.log("\n" + "=".repeat(60));
        console.log("✅ FULL FLOW TEST COMPLETED SUCCESSFULLY");
        console.log("=".repeat(60));
        console.log(`Session Token: ${sessionToken}`);
        console.log(`Verify URL: ${BACKEND_URL}/verify/${sessionToken}`);

    } catch (error) {
        console.error("\n" + "=".repeat(60));
        console.error("❌ TEST FAILED");
        console.error("=".repeat(60));
        console.error(`Error: ${error.message}`);
        if (error.code === 'ECONNREFUSED') {
            console.error("\n💡 Make sure your Next.js dev server is running:");
            console.error("   npm run dev");
        }
        process.exit(1);
    }
}

testFullFlow();


