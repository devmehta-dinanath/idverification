// scripts/verify_integration_issue.js
require('dotenv').config({ path: '.env.local' });
const fetch = require('node-fetch');

const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
const PROPERTY_ID = "172982356828288"; // Sukhumvit 36

// TTLock credentials (check multiple possible variable names)
const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID || process.env.TTLOCK_KIOSK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET || process.env.TTLOCK_KIOSK_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;

async function checkCloudbedsDoorLocks() {
    console.log("\n=== CHECKING CLOUDBEDS DOOR LOCKS ===\n");
    
    if (!CLOUDBEDS_API_KEY) {
        console.error("❌ Missing CLOUDBEDS_API_KEY in .env.local");
        return { hasKeys: false, keys: [], error: "Missing API key" };
    }

    const url = `https://api.cloudbeds.com/doorlock/v1/keys/${PROPERTY_ID}`;
    
    try {
        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
                'Accept': 'application/json'
            }
        });

        const json = await res.json();
        
        if (!res.ok) {
            console.error(`❌ Cloudbeds API Error: ${res.status} ${res.statusText}`);
            console.error(`   Response:`, JSON.stringify(json, null, 2));
            return { hasKeys: false, keys: [], error: json.message || res.statusText };
        }

        const keys = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
        
        console.log(`📊 Cloudbeds Door Lock Keys: ${keys.length}`);
        
        if (keys.length === 0) {
            console.log("   ⚠️  NO DOOR LOCK KEYS FOUND IN CLOUDBEDS");
            console.log("   Response:", JSON.stringify(json, null, 2));
        } else {
            console.log("   ✅ Found keys:");
            keys.slice(0, 3).forEach((key, i) => {
                console.log(`      Key ${i + 1}:`, {
                    code: key.code || key.access_code || key.pin || 'N/A',
                    room: key.roomName || key.room_name || 'N/A',
                    status: key.status || 'N/A',
                    validFrom: key.validFrom || key.valid_from || 'N/A',
                    validTo: key.validTo || key.valid_to || 'N/A'
                });
            });
        }
        
        return { hasKeys: keys.length > 0, keys, error: null };
        
    } catch (err) {
        console.error("❌ Error checking Cloudbeds:", err.message);
        return { hasKeys: false, keys: [], error: err.message };
    }
}

async function getTTLockAccessToken() {
    console.log("\n=== CHECKING TTLOCK CREDENTIALS ===\n");
    
    const missing = [];
    if (!TTLOCK_CLIENT_ID) missing.push("TTLOCK_CLIENT_ID or TTLOCK_KIOSK_CLIENT_ID");
    if (!TTLOCK_CLIENT_SECRET) missing.push("TTLOCK_CLIENT_SECRET or TTLOCK_KIOSK_SECRET");
    if (!TTLOCK_USERNAME) missing.push("TTLOCK_USERNAME");
    if (!TTLOCK_PASSWORD) missing.push("TTLOCK_PASSWORD");
    
    if (missing.length > 0) {
        console.error("❌ Missing TTLock credentials in .env.local:");
        missing.forEach(m => console.error(`   - ${m}`));
        console.log("\n   Available env vars:", Object.keys(process.env).filter(k => k.includes('TTLOCK') || k.includes('ttlock')).join(', ') || 'none');
        return null;
    }
    
    console.log("   ✅ TTLock credentials found");
    console.log(`   Client ID: ${TTLOCK_CLIENT_ID.substring(0, 8)}...`);
    console.log(`   Username: ${TTLOCK_USERNAME}`);
    console.log(`   Password length: ${TTLOCK_PASSWORD.length} chars (ends with: ${TTLOCK_PASSWORD.slice(-1)})`);
    
    // Check if password might be truncated due to # character
    if (TTLOCK_PASSWORD.endsWith('#')) {
        console.log("   ⚠️  Password ends with '#' - make sure it's wrapped in quotes in .env.local");
    }
    
    console.log("   Attempting authentication...");

    try {
        // Try common TTLock OAuth endpoints
        const endpoints = [
            'https://openapi.ttlock.com/oauth2/token',
            'https://euopen.ttlock.com/oauth2/token',
            'https://cnopen.ttlock.com/oauth2/token'
        ];

        for (const baseUrl of endpoints) {
            try {
                // Use URLSearchParams to properly encode special characters like #
                const params = new URLSearchParams();
                params.append('client_id', TTLOCK_CLIENT_ID);
                params.append('client_secret', TTLOCK_CLIENT_SECRET);
                params.append('username', TTLOCK_USERNAME);
                params.append('password', TTLOCK_PASSWORD); // This will properly encode # and other special chars
                params.append('grant_type', 'password');
                
                const res = await fetch(`${baseUrl}?${params.toString()}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                });

                const json = await res.json();
                
                if (res.ok && json.access_token) {
                    console.log(`   ✅ TTLock auth successful (${baseUrl})`);
                    return json.access_token;
                } else {
                    console.log(`   ⚠️  Auth failed on ${baseUrl}:`, json.error || json.error_description || JSON.stringify(json).substring(0, 100));
                }
            } catch (err) {
                console.log(`   ⚠️  Error on ${baseUrl}:`, err.message);
                continue; // Try next endpoint
            }
        }
        
        console.error("   ❌ TTLock authentication failed on all endpoints");
        console.error("   💡 Tip: If password ends with '#', make sure it's wrapped in quotes in .env.local:");
        console.error("      TTLOCK_PASSWORD=\"yourpassword#\"");
        return null;
    } catch (err) {
        console.error("   ❌ TTLock auth error:", err.message);
        return null;
    }
}

async function checkTTLockLocks(accessToken) {
    console.log("\n=== CHECKING TTLOCK DOOR LOCKS ===\n");
    
    if (!accessToken) {
        console.log("   ⚠️  Cannot check TTLock - no access token");
        return { hasLocks: false, locks: [], error: "No access token" };
    }

    // Try to get locks list
    const endpoints = [
        `https://openapi.ttlock.com/v3/lock/list?clientId=${TTLOCK_CLIENT_ID}&accessToken=${accessToken}&pageNo=1&pageSize=20`,
        `https://euopen.ttlock.com/v3/lock/list?clientId=${TTLOCK_CLIENT_ID}&accessToken=${accessToken}&pageNo=1&pageSize=20`
    ];

    for (const url of endpoints) {
        try {
            const res = await fetch(url, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            const json = await res.json();
            
            if (res.ok && json.list) {
                const locks = Array.isArray(json.list) ? json.list : [];
                console.log(`📊 TTLock Locks Found: ${locks.length}`);
                
                if (locks.length > 0) {
                    console.log("   ✅ TTLock has locks configured:");
                    locks.slice(0, 3).forEach((lock, i) => {
                        console.log(`      Lock ${i + 1}:`, {
                            lockId: lock.lockId || lock.id || 'N/A',
                            lockName: lock.lockName || lock.name || 'N/A',
                            lockAlias: lock.lockAlias || 'N/A',
                            battery: lock.battery || 'N/A'
                        });
                    });
                } else {
                    console.log("   ⚠️  NO LOCKS FOUND IN TTLOCK");
                }
                
                return { hasLocks: locks.length > 0, locks, error: null };
            }
        } catch (err) {
            continue; // Try next endpoint
        }
    }
    
    console.log("   ⚠️  Could not retrieve locks from TTLock API");
    console.log("   (This might be due to API endpoint differences or permissions)");
    return { hasLocks: false, locks: [], error: "API call failed" };
}

async function verifyIssue() {
    console.log("\n" + "=".repeat(60));
    console.log("VERIFYING TTLOCK-CLOUDBEDS INTEGRATION ISSUE");
    console.log("=".repeat(60));
    
    // Check Cloudbeds
    const cloudbedsResult = await checkCloudbedsDoorLocks();
    
    // Check TTLock
    const ttlockToken = await getTTLockAccessToken();
    const ttlockResult = await checkTTLockLocks(ttlockToken);
    
    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("VERIFICATION SUMMARY");
    console.log("=".repeat(60));
    console.log(`Cloudbeds Door Lock Keys: ${cloudbedsResult.hasKeys ? '✅ HAS KEYS' : '❌ NO KEYS'}`);
    console.log(`TTLock Locks: ${ttlockResult.hasLocks ? '✅ HAS LOCKS' : '❌ NO LOCKS / CANNOT VERIFY'}`);
    
    if (!cloudbedsResult.hasKeys && ttlockResult.hasLocks) {
        console.log("\n🔴 ISSUE CONFIRMED:");
        console.log("   - TTLock has locks configured");
        console.log("   - Cloudbeds has NO door lock keys");
        console.log("   - Integration is NOT connected");
        console.log("\n✅ Safe to send message to client");
    } else if (!cloudbedsResult.hasKeys && !ttlockResult.hasLocks) {
        console.log("\n⚠️  UNCLEAR:");
        console.log("   - Cloudbeds has NO keys (confirmed)");
        console.log("   - TTLock status unclear (could not verify)");
        console.log("   - May need TTLock API documentation to verify");
    } else if (cloudbedsResult.hasKeys) {
        console.log("\n✅ NO ISSUE:");
        console.log("   - Cloudbeds HAS door lock keys");
        console.log("   - Integration appears to be working");
    }
    
    console.log("\n");
}

verifyIssue();

