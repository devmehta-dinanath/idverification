/**
 * test-visitor-flow.js
 *
 * Tests the full visitor flow against the running Next.js dev server.
 * Run: node test-visitor-flow.js
 *
 * Prerequisites:
 *   1. .env.local must exist with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY, S3_BUCKET_NAME, AWS_REGION, etc.
 *   2. Dev server must be running: npm run dev  (listens on http://localhost:3000)
 *   3. Optionally set IMAGE_PATH env var to a real ID image file, otherwise a tiny placeholder is used.
 */

const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: ".env.local" });

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const API = `${BASE_URL}/api/verify`;

// ─── helpers ────────────────────────────────────────────────────────────────

async function post(action, body = {}) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error(`❌  [${action}] HTTP ${res.status}:`, json);
    process.exit(1);
  }
  return json;
}

function getTestImage() {
  // Use a real image file if provided, otherwise use a small 1×1 JPEG (will likely fail AWS checks)
  const imagePath = process.env.IMAGE_PATH;
  if (imagePath && fs.existsSync(imagePath)) {
    console.log(`📷  Using image: ${imagePath}`);
    return fs.readFileSync(imagePath).toString("base64");
  }
  console.warn("⚠️   No IMAGE_PATH set — using a tiny placeholder. AWS Rekognition/Textract will likely reject it.");
  console.warn("     Set IMAGE_PATH=/path/to/id_photo.jpg for a real test.\n");
  // Minimal valid JPEG (53 bytes)
  return "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARC AABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUEA/8QAIRAAAQQCAgMAAAAAAAAAAAAAAQIDBBEFEiExUWH/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Amz3HXVPQF0lxHDTKzIYRbmqRVGjCZfWIEEAKjNKJWpXpjSsxZCGBUFiGgAB/9k=";
}

// ─── main test ───────────────────────────────────────────────────────────────

async function runVisitorFlowTest() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Visitor Flow Test");
  console.log(`  API: ${API}`);
  console.log("═══════════════════════════════════════════════════\n");

  // ── Step 1: Start visitor session ──────────────────────────────────────────
  console.log("── Step 1: start_visitor");
  const startRes = await post("start_visitor");
  console.log("✅  session_token:", startRes.session_token);
  console.log("    verify_url   :", startRes.verify_url);
  const { session_token } = startRes;

  // ── Step 2: Fetch session (should be at 'welcome') ─────────────────────────
  console.log("\n── Step 2: get_session (initial)");
  const sessionRes = await post("get_session", { session_token });
  console.log("✅  current_step:", sessionRes.session?.current_step);
  console.log("    status      :", sessionRes.session?.status);

  // ── Step 3: Log consent ─────────────────────────────────────────────────────
  console.log("\n── Step 3: log_consent");
  const consentRes = await post("log_consent", {
    session_token,
    consent_given: true,
    consent_time: new Date().toISOString(),
    consent_locale: "en",
  });
  console.log("✅ ", consentRes.message);

  // ── Step 4: Save visitor info (no booking needed) ──────────────────────────
  console.log("\n── Step 4: update_guest (visitor)");
  const guestRes = await post("update_guest", {
    session_token,
    guest_name: "Test Visitor",
    booking_ref: "VISITOR",
    flow_type: "visitor",
    visitor_first_name: "Test",
    visitor_last_name: "Visitor",
    visitor_phone: "+66-800000000",
    visitor_reason: "Meeting a guest",
  });
  console.log("✅  flow_type:", guestRes.flow_type);

  // ── Step 5: Validate document (pre-check) ──────────────────────────────────
  console.log("\n── Step 5: validate_document (pre-check)");
  const imageData = getTestImage();
  const validateRes = await post("validate_document", {
    image_data: `data:image/jpeg;base64,${imageData}`,
    session_token,
  });
  console.log(
    validateRes.document_valid ? "✅  Document valid" : "⚠️   Document invalid",
    "| has_face:", validateRes.has_face,
    "| is_readable:", validateRes.is_readable,
    "| failure_reason:", validateRes.failure_reason || "none"
  );

  // ── Step 6: Upload document ────────────────────────────────────────────────
  console.log("\n── Step 6: upload_document");
  const uploadRes = await post("upload_document", {
    session_token,
    image_data: `data:image/jpeg;base64,${imageData}`,
  });
  console.log("✅  guest_index            :", uploadRes.guest_index);
  console.log(
    "    visitor_access_code    :",
    uploadRes.visitor_access_code || "(none — check AWS Textract result)"
  );
  console.log("    visitor_access_granted :", uploadRes.visitor_access_granted_at || "n/a");
  console.log("    visitor_access_expires :", uploadRes.visitor_access_expires_at || "n/a");

  // ── Step 7: Final session state ────────────────────────────────────────────
  console.log("\n── Step 7: get_session (final)");
  const finalSession = await post("get_session", { session_token });
  console.log("✅  current_step          :", finalSession.session?.current_step);
  console.log("    status               :", finalSession.session?.status);
  console.log("    visitor_access_code  :", finalSession.session?.visitor_access_code || "n/a");

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  ✅  Visitor flow test complete!");
  console.log(`  🔗  Full verify URL: ${BASE_URL}${startRes.verify_url}`);
  console.log("═══════════════════════════════════════════════════\n");
}

runVisitorFlowTest().catch((err) => {
  console.error("❌  Unhandled error:", err.message);
  process.exit(1);
});
