/**
 * Setup Cloudbeds for Sukhumvit 36 (Oodles API key).
 * 1. Saves CLOUDBEDS_API_KEY to cloudbeds_tokens so backend uses it as access_token.
 * 2. Fetches getProperties and prints property IDs so you can add Sukhumvit 36 to lib/cloudbeds.js PROPERTY_IDS.
 *
 * Usage:
 *   Add to .env.local:  CLOUDBEDS_API_KEY=cbat_YourOodlesKeyForSukhumvit36
 *   node scripts/setup_sukhumvit36_cloudbeds.js
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const fetch = require("node-fetch");

const API_KEY = process.env.CLOUDBEDS_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
    console.log("--- Sukhumvit 36 / Oodles Cloudbeds setup ---\n");

    if (!API_KEY) {
        console.error("Missing CLOUDBEDS_API_KEY in .env.local");
        console.error("Add: CLOUDBEDS_API_KEY=cbat_YourOodlesKeyForSukhumvit36");
        process.exit(1);
    }

    // Cloudbeds API key auth: use x-api-key header (v1.2) or Bearer
    const headers = {
        "x-api-key": API_KEY,
        "Accept": "application/json",
    };

    // 1a. Try getHotelDetails first (property-level keys often only support this; no propertyID = default property)
    console.log("1. Testing API key (x-api-key header)...");
    let properties = [];
    let res = await fetch("https://api.cloudbeds.com/api/v1.2/getHotelDetails", { headers });
    let text = await res.text();

    let json;
    try {
        json = JSON.parse(text);
    } catch (_) {
        console.error("   Response was not JSON (status " + res.status + "). First 200 chars:", text.slice(0, 200));
        // Retry with Bearer (some setups use Bearer)
        console.log("   Retrying with Authorization: Bearer ...");
        res = await fetch("https://api.cloudbeds.com/api/v1.2/getHotelDetails", {
            headers: { Authorization: "Bearer " + API_KEY, Accept: "application/json" },
        });
        text = await res.text();
        try {
            json = JSON.parse(text);
        } catch (e) {
            console.error("   Still not JSON:", text.slice(0, 200));
            process.exit(1);
        }
    }

    if (json.success && json.data) {
        // getHotelDetails returns a single property
        const p = json.data;
        const id = p.propertyID || p.id || p.propertyId;
        const name = p.propertyName || p.name;
        console.log("   getHotelDetails OK. Property:", id, "-", name);
        properties = [p];
    } else if (!json.success) {
        // Maybe getProperties is available for this key
        res = await fetch("https://api.cloudbeds.com/api/v1.2/getProperties", { headers });
        text = await res.text();
        try {
            json = JSON.parse(text);
        } catch (_) {
            console.error("   getProperties response not JSON:", text.slice(0, 200));
            process.exit(1);
        }
        if (json.success && json.data) properties = Array.isArray(json.data) ? json.data : [json.data];
    }

    if (properties.length === 0) {
        console.error("   Could not load any property. Response:", JSON.stringify(json));
        process.exit(1);
    }

    console.log("   Found", properties.length, "property(ies):\n");
    properties.forEach((p, i) => {
        const id = p.propertyID || p.id || p.propertyId || "(no id)";
        const name = p.propertyName || p.name || "(no name)";
        console.log(`   [${i + 1}] propertyID: ${id}  name: "${name}"`);
    });

    const sukhumvit = properties.find(
        (p) =>
            (p.propertyName || p.name || "").toLowerCase().includes("sukhumvit") ||
            (p.propertyName || p.name || "").toLowerCase().includes("36")
    );
    if (sukhumvit) {
        const id = sukhumvit.propertyID || sukhumvit.id || sukhumvit.propertyId;
        console.log("\n   >>> Sukhumvit 36 property ID:", id, "<<<");
        console.log("   Add this to lib/cloudbeds.js PROPERTY_IDS if not already there.");
    } else if (properties.length === 1) {
        const id = properties[0].propertyID || properties[0].id || properties[0].propertyId;
        console.log("\n   >>> Single property ID (use for Sukhumvit 36):", id, "<<<");
    }

    // 2. Save token to Supabase so getAccessToken() and check-token.js see it
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        console.log("\n2. Skipping Supabase save (no NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY).");
        console.log("   Set CLOUDBEDS_API_KEY in .env and the app will use it directly.");
        return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const expiresAt = new Date("2099-01-01T00:00:00Z").toISOString();

    const { error } = await supabase.from("cloudbeds_tokens").upsert({
        id: 1,
        access_token: API_KEY,
        refresh_token: "static_key_no_refresh", 
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
    });

    if (error) {
        console.error("\n2. Error saving token to Supabase:", error.message);
        console.log("   You can still use CLOUDBEDS_API_KEY in .env – the app will use it directly.");
        return;
    }

    console.log("\n2. Token saved to cloudbeds_tokens. Visitor flow will use this key for Cloudbeds.");
    console.log("   Run: node check-token.js  to verify.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
