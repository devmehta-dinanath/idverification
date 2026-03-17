const fetch = require('node-fetch');

const PORT = process.env.PORT || '3000';
const API_URL = process.env.API_URL || `http://localhost:${PORT}/api/verify`;

async function checkApi() {
    try {
        console.log(`Testing POST ${API_URL}...`);
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'start', type: 'guest' })
        });

        console.log("Status:", res.status);
        const text = await res.text();
        console.log("Body:", text);

        if (res.ok) {
            console.log("✅ API is working");
        } else {
            console.log("❌ API returned error");
        }
    } catch (err) {
        console.error("❌ Request failed:", err);
    }
}

checkApi();
