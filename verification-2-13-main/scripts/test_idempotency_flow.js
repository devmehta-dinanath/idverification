/**
 * Minimal manual regression script (run while the Next.js app is running).
 *
 * Usage:
 *   node scripts/test_idempotency_flow.js http://localhost:3000
 *
 * Notes:
 * - This script focuses on verifying that duplicate calls do not error or double-advance.
 * - It does not upload real images; it uses tiny placeholder base64 data.
 * - With strict AWS verification enabled, replace placeholder data with a real image payload
 *   in environments where Rekognition/Textract validation is enforced.
 */

const baseUrl = process.argv[2] || "http://localhost:3000";

async function post(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _raw: text };
  }
  if (!res.ok) {
    const msg = json?.error || json?.message || `HTTP ${res.status}`;
    throw new Error(`${msg} :: ${text}`);
  }
  return json;
}

function fakeJpegBase64() {
  // Not a real JPEG; just a placeholder string. If your backend enforces image decode,
  // replace this with a real base64 jpeg payload.
  return Buffer.from("dev-placeholder-image").toString("base64");
}

async function main() {
  console.log("Base URL:", baseUrl);

  const start = await post("/api/verify", { action: "start" });
  const token = start.session_token;
  if (!token) throw new Error("No session_token from start");
  console.log("Session token:", token);

  await post("/api/verify", {
    action: "log_consent",
    session_token: token,
    consent_given: true,
    consent_time: new Date().toISOString(),
    consent_locale: "en",
  });

  // Guest info must be set before upload_document is accepted.
  await post("/api/verify", {
    action: "update_guest",
    session_token: token,
    guest_name: "Test Guest",
    booking_ref: "TEST",
  });

  const img = fakeJpegBase64();

  console.log("Calling upload_document twice...");
  const up1 = await post("/api/verify", { action: "upload_document", session_token: token, image_data: img });
  const up2 = await post("/api/verify", { action: "upload_document", session_token: token, image_data: img });
  console.log("upload_document #1:", up1);
  console.log("upload_document #2:", up2);

  console.log("Calling verify_face twice...");
  const vf1 = await post("/api/verify", { action: "verify_face", session_token: token, selfie_data: img });
  const vf2 = await post("/api/verify", { action: "verify_face", session_token: token, selfie_data: img });
  console.log("verify_face #1:", vf1);
  console.log("verify_face #2:", vf2);

  const sess = await post("/api/verify", { action: "get_session", session_token: token });
  console.log("Final get_session:", sess?.session);

  console.log("Done.");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});


