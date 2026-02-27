/**
 * test-cloudbeds-integration.js
 *
 * End-to-end test: verifies that the guest flow now uses Cloudbeds directly
 * (no booking_email_index table lookups).
 *
 * Run:  node test-cloudbeds-integration.js
 *
 * Requires: dev server running on localhost:3001 (or set TEST_BASE_URL)
 */

const fetch = require("node-fetch");
require("dotenv").config({ path: ".env.local" });

const BASE = process.env.TEST_BASE_URL || "http://localhost:3001";
const API = `${BASE}/api/verify`;

let passed = 0;
let failed = 0;

function ok(label) { passed++; console.log(`  ✅  ${label}`); }
function fail(label, detail) { failed++; console.error(`  ❌  ${label}  →  ${detail}`); }

async function post(action, body = {}) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

async function run() {
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║   Cloudbeds Integration Test Suite                ║");
  console.log(`║   Server: ${BASE.padEnd(39)}║`);
  console.log("╚═══════════════════════════════════════════════════╝\n");

  // ── 1. Session Creation ────────────────────────────────────────────────────
  console.log("── 1. Session Creation (start)");
  const startRes = await post("start");
  if (startRes.session_token) {
    ok(`Session created: ${startRes.session_token.substring(0, 16)}...`);
  } else {
    fail("Session creation", JSON.stringify(startRes));
    console.log("\n⛔  Cannot continue without a session. Is the server running?");
    return;
  }
  const token = startRes.session_token;

  // ── 2. Get Session ─────────────────────────────────────────────────────────
  console.log("\n── 2. Get Session");
  const sessRes = await post("get_session", { session_token: token });
  if (sessRes.success && sessRes.session) {
    ok(`Step: ${sessRes.session.current_step} | Status: ${sessRes.session.status}`);
  } else {
    fail("get_session", JSON.stringify(sessRes));
  }

  // ── 3. Log Consent ─────────────────────────────────────────────────────────
  console.log("\n── 3. Log Consent");
  const consentRes = await post("log_consent", {
    session_token: token,
    consent_given: true,
    consent_time: new Date().toISOString(),
    consent_locale: "en",
  });
  if (consentRes.success) {
    ok(consentRes.message);
  } else {
    fail("log_consent", JSON.stringify(consentRes));
  }

  // ── 4. Update Guest → Cloudbeds Lookup (with FAKE booking) ────────────────
  console.log("\n── 4a. Update Guest — INVALID booking (should fail gracefully)");
  const badGuestRes = await post("update_guest", {
    session_token: token,
    guest_name: "Totally Fake Person",
    booking_ref: "FAKE999999",
  });
  if (badGuestRes.status === 403 || badGuestRes.error) {
    ok(`Correctly rejected fake booking: "${badGuestRes.error?.substring(0, 60)}"`);
  } else {
    fail("Should have been rejected", JSON.stringify(badGuestRes));
  }

  // ── 4b. Update Guest → Cloudbeds Lookup (with REAL booking) ───────────────
  // Try a real reservation if env vars are set
  const testGuestName = process.env.TEST_GUEST_NAME;
  const testBookingRef = process.env.TEST_BOOKING_REF;

  if (testGuestName && testBookingRef) {
    console.log(`\n── 4b. Update Guest — REAL booking (${testGuestName} / ${testBookingRef})`);
    const realGuestRes = await post("update_guest", {
      session_token: token,
      guest_name: testGuestName,
      booking_ref: testBookingRef,
    });
    if (realGuestRes.success) {
      ok(`Cloudbeds match! adults=${realGuestRes.adults}, children=${realGuestRes.children}, expected=${realGuestRes.expected_guest_count}`);
    } else {
      fail("Real booking lookup", JSON.stringify(realGuestRes));
    }

    // ── 5. Verify session now has Cloudbeds fields ───────────────────────────
    console.log("\n── 5. Verify session has cloudbeds_reservation_id / cloudbeds_property_id");
    const verifySessionRes = await post("get_session", { session_token: token });
    const sess = verifySessionRes.session || {};
    if (sess.cloudbeds_reservation_id && sess.cloudbeds_property_id) {
      ok(`cloudbeds_reservation_id = ${sess.cloudbeds_reservation_id}`);
      ok(`cloudbeds_property_id    = ${sess.cloudbeds_property_id}`);
    } else {
      fail("Missing Cloudbeds fields on session", `res_id=${sess.cloudbeds_reservation_id}, prop_id=${sess.cloudbeds_property_id}`);
      console.log("    💡 Did you run the SQL migration? →  ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS cloudbeds_reservation_id text;");
    }
  } else {
    console.log("\n── 4b. Skipped REAL booking test (set TEST_GUEST_NAME and TEST_BOOKING_REF env vars)");
    console.log("    Example: TEST_GUEST_NAME='John Smith' TEST_BOOKING_REF='RES12345' node test-cloudbeds-integration.js");
  }

  // ── 5. Visitor Flow (still works, bypasses Cloudbeds) ─────────────────────
  console.log("\n── 6. Visitor Flow (should still work without Cloudbeds)");
  const visitorStartRes = await post("start_visitor");
  if (!visitorStartRes.session_token) {
    fail("Visitor session creation", JSON.stringify(visitorStartRes));
  } else {
    ok(`Visitor session: ${visitorStartRes.session_token.substring(0, 16)}...`);

    const visitorGuestRes = await post("update_guest", {
      session_token: visitorStartRes.session_token,
      guest_name: "Test Visitor",
      booking_ref: "VISITOR",
      flow_type: "visitor",
      visitor_first_name: "Test",
      visitor_last_name: "Visitor",
      visitor_phone: "+66800000000",
      visitor_reason: "Meeting",
    });
    if (visitorGuestRes.success && visitorGuestRes.flow_type === "visitor") {
      ok("Visitor flow bypassed Cloudbeds correctly");
    } else {
      fail("Visitor update_guest", JSON.stringify(visitorGuestRes));
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log(`║   Results: ${passed} passed, ${failed} failed`.padEnd(52) + "║");
  console.log("╚═══════════════════════════════════════════════════╝\n");

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("\n⛔  Fatal error:", err.message);
  process.exit(1);
});
