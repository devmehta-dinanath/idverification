require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xbmyffvoeqpkpwbhommy.supabase.co",
  process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhibXlmZnZvZXFwa3B3YmhvbW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ1NDQ3MDcsImV4cCI6MjA2MDEyMDcwN30.jK5BPFXdvQnKzVhQV_TgLK2bfLzbiY7b7fAlqoJq5GE"
);

(async () => {
  console.log("--- Checking Cloudbeds Token in Supabase ---");
  const { data, error } = await sb
    .from("cloudbeds_tokens")
    .select("id, access_token, refresh_token, expires_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.log("❌ Error fetching token:", error.message);
    return;
  }
  if (!data) {
    console.log("❌ No token row found. Run /api/cloudbeds/auth first.");
    return;
  }

  console.log("✅ Token row found:");
  console.log("   ID:", data.id);
  console.log("   Access Token:", data.access_token ? data.access_token.substring(0, 20) + "..." : "(empty)");
  console.log("   Refresh Token:", data.refresh_token ? data.refresh_token.substring(0, 20) + "..." : "(empty)");
  console.log("   Expires At:", data.expires_at);
  console.log("   Updated At:", data.updated_at);

  // Check if expired
  const now = Date.now();
  const expiresAt = new Date(data.expires_at).getTime();
  const diffMins = ((expiresAt - now) / 60000).toFixed(1);

  if (now >= expiresAt) {
    console.log("⚠️  Token is EXPIRED (expired " + Math.abs(diffMins) + " mins ago)");
  } else {
    console.log("✅ Token is VALID (expires in " + diffMins + " mins)");
  }

  // Quick API test with the token
  if (data.access_token) {
    console.log("\n--- Testing Cloudbeds API with token ---");
    const res = await fetch("https://api.cloudbeds.com/api/v1.2/getProperties", {
      headers: { Authorization: "Bearer " + data.access_token, Accept: "application/json" },
    });
    const json = await res.json();
    if (json.success) {
      console.log("✅ API call successful!");
      const propStr = JSON.stringify(json.data, null, 2);
      console.log("Properties:", propStr.substring(0, 800));
    } else {
      console.log("❌ API call failed:", json.message || JSON.stringify(json));
    }
  }

  // Show the updated PROPERTY_IDS
  console.log("\n--- Current PROPERTY_IDS in cloudbeds.js ---");
  const fs = require("fs");
  const content = fs.readFileSync("./lib/cloudbeds.js", "utf8");
  const match = content.match(/export const PROPERTY_IDS\s*=\s*\[([^\]]+)\]/);
  if (match) {
    console.log("PROPERTY_IDS =", "[" + match[1] + "]");
  }
})();
