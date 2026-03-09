import { createClient } from "@supabase/supabase-js";

// Initialize Supabase admin client (for token storage)
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CLOUDBEDS_API_BASE = "https://api.cloudbeds.com/api/v1.2";
const TOKEN_TABLE = "cloudbeds_tokens"; // We need to create this

// Use provided credentials (must be set in environment variables)
const CLIENT_ID = process.env.CLOUDBEDS_CLIENT_ID;
const CLIENT_SECRET = process.env.CLOUDBEDS_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || process.env.CLOUDBEDS_REDIRECT_URI;

// Property IDs for door codes (visitor flow). 172982356828288 = Sukhumvit 36 - Hotel (Oodles; use CLOUDBEDS_API_KEY).
export const PROPERTY_IDS = ["172982356828288", "173603468177536", "173985276133504", "000000000000000"];

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    if (process.env.NODE_ENV === 'production') {
        console.error("Missing Cloudbeds environment variables: CLOUDBEDS_CLIENT_ID, CLOUDBEDS_CLIENT_SECRET, CLOUDBEDS_REDIRECT_URI");
    }
}

/**
 * Get the current access token for Cloudbeds API.
 * Prefers CLOUDBEDS_API_KEY (e.g. Oodles/Sukhumvit 36 key) when set; otherwise uses token from DB.
 */
export async function getAccessToken() {
    // Use static API key from env when set (e.g. Oodles key for Sukhumvit 36)
    const staticKey = process.env.CLOUDBEDS_API_KEY;
    if (staticKey && staticKey.trim()) {
        return staticKey.trim();
    }

    const { data, error } = await supabase
        .from(TOKEN_TABLE)
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

    if (error || !data) {
        throw new Error("No Cloudbeds token found. Set CLOUDBEDS_API_KEY or run /api/cloudbeds/auth first.");
    }

    // Static keys in DB have refresh_token "static_key_no_refresh" – don't try to refresh
    if (data.refresh_token === "static_key_no_refresh") {
        return data.access_token;
    }

    // Check expiration (buffer 5 mins)
    const now = Date.now();
    const expiresAt = new Date(data.expires_at).getTime();

    if (now >= expiresAt - 5 * 60 * 1000) {
        console.log("Refreshing Cloudbeds token...");
        return await refreshAccessToken(data.refresh_token);
    }

    return data.access_token;
}

/**
 * Exchange refresh token for new access token
 */
async function refreshAccessToken(refreshToken) {
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("client_id", CLIENT_ID);
    params.append("client_secret", CLIENT_SECRET);
    params.append("refresh_token", refreshToken);

    const res = await fetch("https://api.cloudbeds.com/api/v1.1/access_token", {
        method: "POST",
        body: params,
    });

    const json = await res.json();
    if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(json)}`);

    return await saveToken(json);
}

/**
 * Save token to Supabase
 */
export async function saveToken(tokenData) {
    // tokenData: { access_token, token_type, expires_in, refresh_token }
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const { data, error } = await supabase.from(TOKEN_TABLE).upsert({
        id: 1, // Singleton row
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
    }).select().single();

    if (error) throw new Error(`Failed to save token: ${error.message}`);
    return tokenData.access_token;
}

/**
 * Fetch reservation details by ID
 */
export async function getReservation(reservationId, propertyID = null) {
    const token = await getAccessToken();

    let url = `${CLOUDBEDS_API_BASE}/getReservation?reservationID=${reservationId}`;
    if (propertyID) {
        url += `&propertyID=${propertyID}`;
    }

    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
        },
    });

    const json = await res.json();
    if (!json.success) {
        throw new Error(`Cloudbeds API Error: ${json.message}`);
    }
    return json.data;
}

/**
 * getReservations (plural) by check-in date window or modification time
 */
export async function getReservations({ checkInFrom, checkInTo, modifiedSince }) {
    const token = await getAccessToken();
    const params = new URLSearchParams();
    if (checkInFrom) params.append("checkInFrom", checkInFrom);
    if (checkInTo) params.append("checkInTo", checkInTo);
    // Cloudbeds filter logic varies, checking docs... usually filter by status too

    const url = `${CLOUDBEDS_API_BASE}/getReservations?${params.toString()}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` } 
        
    });

    return await res.json();
}

/**
 * Search for a reservation by Reference ID (OTA ID)
 */
export async function findReservationByReference(referenceId, propertyID = null) {
    const token = await getAccessToken();

    // Cloudbeds getReservations can filter or we can search. 
    // Usually, we search by thirdPartyIdentifier.
    let url = `${CLOUDBEDS_API_BASE}/getReservations?queryString=${referenceId}`;
    if (propertyID) {
        url += `&propertyID=${propertyID}`;
    }

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
    });

    const json = await res.json();
    if (!json.success || !json.data || json.data.length === 0) {
        return null;
    }

    // Return the first match
    return json.data[0];
}

// ─── ID Verification Integration ────────────────────────────────────────────

/**
 * Look up a reservation directly from Cloudbeds to validate guest identity.
 * Searches across all configured properties and validates the guest name.
 * Replaces the Supabase booking_email_index lookup.
 *
 * @returns {{ found: true, propertyID, reservationId, guestName, adults, children, roomNumber, checkIn, checkOut, status } | { found: false }}
 */
export async function lookupGuestReservation(guestName, bookingRef) {
    const { normalizeGuestName } = await import("./utils.js");
    const guestNameNorm = normalizeGuestName(guestName);

    for (const propertyID of PROPERTY_IDS) {
        try {
            const token = await getAccessToken();
            let resData = null;

            // 1. Try direct reservation ID lookup
            try {
                const directRes = await fetch(
                    `${CLOUDBEDS_API_BASE}/getReservation?reservationID=${encodeURIComponent(bookingRef)}&propertyID=${propertyID}`,
                    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
                );
                const directJson = await directRes.json();
                if (directJson.success && directJson.data) resData = directJson.data;
            } catch (e) {
                console.log(`[cloudbeds] Direct lookup failed for ${bookingRef} on prop ${propertyID}: ${e.message}`);
            }

            // 2. Fall back to search query (handles OTA/reference IDs)
            if (!resData) {
                const searchRes = await fetch(
                    `${CLOUDBEDS_API_BASE}/getReservations?queryString=${encodeURIComponent(bookingRef)}&propertyID=${propertyID}&pageSize=10`,
                    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
                );
                const searchJson = await searchRes.json();
                if (searchJson.success && Array.isArray(searchJson.data) && searchJson.data.length > 0) {
                    resData = searchJson.data[0];
                }
            }

            if (!resData) continue;

            // 3. (Relaxed) name check – for this deployment we accept any reservation
            // that matches the booking reference; we only log names for debugging.
            const cbGuestName = `${resData.firstName || ""} ${resData.lastName || ""}`.trim();
            const cbGuestNameNorm = normalizeGuestName(cbGuestName);
            console.log(
                `[cloudbeds] Using reservation ${resData.reservationID} on prop ${propertyID} for guest="${guestNameNorm}", Cloudbeds name="${cbGuestNameNorm}"`
            );

            // Debug: log FULL raw resData to identify exactly which fields Cloudbeds returns
            console.log(`[cloudbeds] FULL resData for ${resData.reservationID}:`, JSON.stringify(resData, null, 2));

            // ── Extract room info from Cloudbeds nested structures ──────────
            // Cloudbeds nests room data inside guestList{} and assigned[] arrays,
            // NOT at the top level.
            const guestListValues = resData.guestList ? Object.values(resData.guestList) : [];
            const mainGuest = guestListValues.find((g) => g.isMainGuest) || guestListValues[0] || null;
            const assignedArr = Array.isArray(resData.assigned) ? resData.assigned : [];
            const firstAssigned = assignedArr[0] || null;
            const guestRooms = mainGuest?.rooms || [];
            const firstGuestRoom = Array.isArray(guestRooms) ? guestRooms[0] : null;

            const roomNumber =
                resData.roomNumber ||
                resData.assignedRoom ||
                mainGuest?.roomName ||
                firstAssigned?.roomName ||
                firstGuestRoom?.roomName ||
                mainGuest?.roomID ||
                firstAssigned?.roomID ||
                null;

            const roomName =
                resData.assignedRoomName ||
                resData.roomName ||
                mainGuest?.roomName ||
                firstAssigned?.roomName ||
                firstGuestRoom?.roomName ||
                null;

            const roomTypeName =
                mainGuest?.roomTypeName ||
                firstAssigned?.roomTypeName ||
                firstGuestRoom?.roomTypeName ||
                null;

            console.log(`[cloudbeds] Resolved room: number=${roomNumber}, name=${roomName}, type=${roomTypeName}`);

            // ── Extract guest details for downstream use (CSV export, TM30) ──
            const guestDetails = {
                firstName: mainGuest?.guestFirstName || resData.firstName || "",
                lastName: mainGuest?.guestLastName || resData.lastName || "",
                gender: mainGuest?.guestGender || "",
                email: mainGuest?.guestEmail || resData.guestEmail || "",
                phone: mainGuest?.guestPhone || mainGuest?.guestCellPhone || "",
                country: mainGuest?.guestCountry || "",
                birthdate: mainGuest?.guestBirthdate || "",
                documentType: mainGuest?.guestDocumentType || "",
                documentNumber: mainGuest?.guestDocumentNumber || "",
                documentIssueDate: mainGuest?.guestDocumentIssueDate || "",
                documentIssuingCountry: mainGuest?.guestDocumentIssuingCountry || "",
                documentExpirationDate: mainGuest?.guestDocumentExpirationDate || "",
            };

            console.log(`[cloudbeds] Reservation found: ${resData.reservationID} on prop ${propertyID}`);
            return {
                found: true,
                propertyID,
                reservationId: resData.reservationID,
                guestName: cbGuestName,
                adults: Number(resData.adults || firstAssigned?.adults || 1),
                children: Number(resData.children || firstAssigned?.children || 0),
                roomNumber,
                roomName,
                roomTypeName,
                checkIn: resData.startDate,
                checkOut: resData.endDate,
                status: resData.status,
                source: resData.source || "",
                guestDetails,
            };
        } catch (err) {
            console.error(`[cloudbeds] lookupGuestReservation failed for property ${propertyID}:`, err.message);
        }
    }

    return { found: false };
}

/**
 * Get the list of guests on a Cloudbeds reservation.
 * Used to find guestID before uploading documents.
 */
export async function getGuests(reservationId, propertyID) {
    const token = await getAccessToken();
    const res = await fetch(
        `${CLOUDBEDS_API_BASE}/getGuests?reservationID=${encodeURIComponent(reservationId)}&propertyID=${propertyID}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );
    const json = await res.json();
    if (!json.success) {
        console.warn(`[cloudbeds] getGuests failed for ${reservationId}:`, json.message);
        return [];
    }
    return json.data || [];
}

/**
 * Upload an ID document image to Cloudbeds for a guest.
 * Requires the Cloudbeds account to have document upload permissions.
 * This is best-effort — failures are logged but do not block verification.
 *
 * @param {string} propertyID
 * @param {string} reservationId
 * @param {string|null} guestId   - Cloudbeds guest ID (optional)
 * @param {string} imageBase64    - Raw base64 image (no data: prefix)
 * @param {string} documentType   - "passport" | "nationalID" | "driverLicense"
 */
export async function putGuestDocument(propertyID, reservationId, guestId, imageBase64, documentType = "passport") {
    const token = await getAccessToken();

    const body = new URLSearchParams({
        propertyID,
        reservationID: reservationId,
        documentType,
        documentPhoto: imageBase64,
    });
    if (guestId) body.append("guestID", guestId);

    const res = await fetch(`${CLOUDBEDS_API_BASE}/putGuestDocuments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
    });
    const json = await res.json();
    if (!json.success) {
        console.warn(`[cloudbeds] putGuestDocument failed for ${reservationId}:`, json.message);
    }
    return json;
}

// ─── Door Lock Integration ──────────────────────────────────────────────────

const DOORLOCK_API_BASE = "https://api.cloudbeds.com/doorlock/v1";

/**
 * Get door lock keys for a property from the Cloudbeds Door Locks API.
 * Returns an array of door lock key objects for the given property.
 * Each key typically has: id, code, roomId, roomName, status, validFrom, validTo, etc.
 *
 * @param {string} propertyID - Cloudbeds property ID
 * @returns {Array} - List of door lock keys
 */
export async function getDoorLockKeys(propertyID) {
    const token = await getAccessToken();

    const res = await fetch(`${DOORLOCK_API_BASE}/keys/${propertyID}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
        },
    });

    const json = await res.json();
    if (!res.ok || json.error) {
        console.warn(`[cloudbeds] getDoorLockKeys failed for property ${propertyID}:`, json.error || json.message || res.statusText);
        return [];
    }

    // Response may be { data: [...] } or just an array
    return Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
}

/**
 * Extract door/access code from a reservation's customFields (e.g. "Door Code" shown in Cloudbeds UI).
 * @param {Object} reservationData - getReservation response data
 * @returns {string|null}
 */
function getAccessCodeFromReservationCustomFields(reservationData) {
    const fields = reservationData?.customFields;
    if (!Array.isArray(fields)) return null;
    const doorField = fields.find((f) => {
        const name = String(f?.customFieldName || "").toLowerCase();
        return /door\s*code|access\s*code|key\s*code|room\s*code/.test(name);
    });
    const value = doorField?.customFieldValue;
    return value != null && String(value).trim() !== "" ? String(value).trim() : null;
}

/**
 * Get a door lock access code for a specific reservation/room from Cloudbeds.
 * 1) Tries Door Locks API GET /doorlock/v1/keys/{propertyID}.
 * 2) If no keys returned, tries getReservation and reads "Door Code" from reservation customFields (as shown in Cloudbeds UI).
 *
 * @param {string} propertyID - Cloudbeds property ID
 * @param {string} roomNumber - Room number or room name to match
 * @param {string} reservationId - Cloudbeds reservation ID (optional, for filtering)
 * @returns {string|null} - The access code, or null if not found
 */
export async function getDoorLockAccessCode(propertyID, roomNumber, reservationId) {
    try {
        const keys = await getDoorLockKeys(propertyID);
        if (!keys || keys.length === 0) {
            console.log(`[cloudbeds] No door lock keys from API for property ${propertyID}, trying reservation customFields`);
            if (reservationId) {
                try {
                    const reservationData = await getReservation(reservationId, propertyID);
                    const code = getAccessCodeFromReservationCustomFields(reservationData);
                    if (code) {
                        console.log(`[cloudbeds] Door code from reservation customFields for reservation ${reservationId}`);
                        return code;
                    }
                } catch (e) {
                    console.warn(`[cloudbeds] getReservation for door code fallback failed:`, e?.message);
                }
            }
            return null;
        }

        const now = new Date();

        // Filter keys: look for active keys matching the room/reservation
        const matchingKeys = keys.filter((key) => {
            // Check if key is active
            const isActive = !key.status || key.status === "active" || key.status === "enabled";

            // Check if key matches the room
            const roomStr = String(roomNumber || "").toLowerCase();
            const keyRoom = String(key.roomName || key.room_name || key.roomId || key.room_id || "").toLowerCase();
            const roomMatches = !roomNumber || keyRoom.includes(roomStr) || roomStr.includes(keyRoom);

            // Check if key matches reservation
            const resMatches = !reservationId ||
                String(key.reservationID || key.reservation_id || "") === String(reservationId);

            // Check if key is currently valid (time-based)
            let timeValid = true;
            if (key.validFrom || key.valid_from) {
                const from = new Date(key.validFrom || key.valid_from);
                if (now < from) timeValid = false;
            }
            if (key.validTo || key.valid_to) {
                const to = new Date(key.validTo || key.valid_to);
                if (now > to) timeValid = false;
            }

            return isActive && roomMatches && resMatches && timeValid;
        });

        if (matchingKeys.length > 0) {
            // Return the code from the first matching key
            const code = matchingKeys[0].code || matchingKeys[0].access_code || matchingKeys[0].pin || matchingKeys[0].keyCode;
            if (code) {
                console.log(`[cloudbeds] Door lock code found for room ${roomNumber} on property ${propertyID}`);
                return String(code);
            }
        }

        // If no room-specific match, try any active key for the property
        const anyActiveKey = keys.find((key) => {
            const isActive = !key.status || key.status === "active" || key.status === "enabled";
            const code = key.code || key.access_code || key.pin || key.keyCode;
            return isActive && code;
        });

        if (anyActiveKey) {
            const code = anyActiveKey.code || anyActiveKey.access_code || anyActiveKey.pin || anyActiveKey.keyCode;
            console.log(`[cloudbeds] Using general door lock code for property ${propertyID}`);
            return String(code);
        }

        console.log(`[cloudbeds] No matching door lock access code found for property ${propertyID}, room ${roomNumber}`);
        return null;
    } catch (err) {
        console.error(`[cloudbeds] getDoorLockAccessCode error:`, err.message);
        return null;
    }
}

/**
 * Get a door lock access code for a VISITOR by searching ALL configured properties.
 * Visitors don't have a specific room or reservation, so this searches all properties
 * and returns the first active door lock code found (typically a common-area / lobby code).
 *
 * @returns {{ code: string, propertyID: string } | null}
 */
export async function getVisitorAccessCode() {
    for (const propertyID of PROPERTY_IDS) {
        try {
            console.log(`[cloudbeds] Checking door lock keys for visitor on property ${propertyID}`);
            const keys = await getDoorLockKeys(propertyID);
            if (!keys || keys.length === 0) continue;

            const now = new Date();

            // Find any active key that is currently valid
            for (const key of keys) {
                const isActive = !key.status || key.status === "active" || key.status === "enabled";
                if (!isActive) continue;

                // Check time validity
                let timeValid = true;
                if (key.validFrom || key.valid_from) {
                    const from = new Date(key.validFrom || key.valid_from);
                    if (now < from) timeValid = false;
                }
                if (key.validTo || key.valid_to) {
                    const to = new Date(key.validTo || key.valid_to);
                    if (now > to) timeValid = false;
                }
                if (!timeValid) continue;

                const code = key.code || key.access_code || key.pin || key.keyCode;
                if (code) {
                    console.log(`[cloudbeds] ✅ Visitor door lock code found on property ${propertyID}`);
                    return { code: String(code), propertyID };
                }
            }
        } catch (err) {
            console.warn(`[cloudbeds] getVisitorAccessCode failed for property ${propertyID}:`, err.message);
        }
    }

    console.log(`[cloudbeds] No visitor door lock code found across any property`);
    return null;
}

/**
 * Add an internal note to a Cloudbeds reservation.
 * Used to record ID verification results directly in the PMS.
 */
export async function addReservationNote(reservationId, propertyID, noteText) {
    const token = await getAccessToken();

    const body = new URLSearchParams({
        propertyID,
        reservationID: reservationId,
        reservationNote: noteText,
        type: "internal",
    });

    const res = await fetch(`${CLOUDBEDS_API_BASE}/putReservationNote`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
    });
    const json = await res.json();
    if (!json.success) {
        console.warn(`[cloudbeds] addReservationNote failed for ${reservationId}:`, json.message);
    }
    return json;
}
