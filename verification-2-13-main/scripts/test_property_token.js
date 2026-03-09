require("dotenv").config({ path: ".env.local" });

async function main() {
    try {
        const propertyID = process.argv[2] || "172982356828288";
        const { getAccessToken } = await import("../lib/cloudbeds.js");

        console.log(`Testing property token resolution for property: ${propertyID}`);
        const token = await getAccessToken(propertyID);

        console.log("Resolved token prefix:", token ? `${token.slice(0, 12)}...` : "none");
        if (process.env.CLOUDBEDS_API_KEY) {
            console.log("Matches CLOUDBEDS_API_KEY:", token === process.env.CLOUDBEDS_API_KEY);
        }
        console.log("✅ Property-based token resolution works");
    } catch (err) {
        console.error("❌ Failed:", err.message);
        process.exit(1);
    }
}

main();


