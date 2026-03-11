// lib/cloudbeds-client.js
// For Next.js, API routes are on the same server
// Default to localhost:3000 for development, or use environment variable
const BACKEND_URL = 
  process.env.NEXT_PUBLIC_BACKEND_URL || 
  process.env.BACKEND_URL || 
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");

export async function fetchCloudbedsReservation(bookingRef) {
  console.log("[Cloudbeds] Fetching reservation:", bookingRef);

  if (!BACKEND_URL) {
    throw new Error("BACKEND_URL not configured. Set NEXT_PUBLIC_BACKEND_URL in .env.local");
  }

  // Try reservationID first, then thirdPartyIdentifier, then subReservationID
  const lookups = [
    { reservation_id: bookingRef },
    { third_party_identifier: bookingRef },
  ];

  // If it looks like a sub-reservation (contains "-"), also try the parent
  if (bookingRef.includes("-")) {
    lookups.push({ reservation_id: bookingRef.split("-")[0], sub_reservation_id: bookingRef });
  }

  for (const body of lookups) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/cloudbeds/reservation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) continue;
      const data = await res.json();
      if (data?.success) {
        console.log("[Cloudbeds] Found via", Object.keys(body)[0], ":", {
          roomName: data.roomName,
          accessCode: data.accessCode,
        });
        return data;
      }
    } catch (e) {
      console.warn("[Cloudbeds] Lookup failed for", body, e.message);
    }
  }

  throw new Error("Reservation not found in Cloudbeds");
}

export function getGuestIsCheckedIn(cloudbeds) {
  // Backward compatible: if backend doesn't provide a checked-in signal, assume OK.
  const v =
    cloudbeds?.guestIsCheckedIn ??
    cloudbeds?.isCheckedIn ??
    cloudbeds?.checkedIn ??
    cloudbeds?.reservationCheckedIn ??
    cloudbeds?.is_checked_in ??
    cloudbeds?.checked_in;

  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "yes", "y", "checkedin", "checked_in", "checked-in", "1"].includes(s)) return true;
    if (["false", "no", "n", "notcheckedin", "not_checked_in", "not-checked-in", "0"].includes(s))
      return false;
  }
  return true;
}

/**
 * Fetch door lock keys from Cloudbeds via backend API endpoint.
 * Similar to fetchCloudbedsReservation but specifically for door lock keys.
 * 
 * @param {string} propertyID - Cloudbeds property ID
 * @param {string} [roomNumber] - Optional room number to filter keys
 * @param {string} [reservationId] - Optional reservation ID to filter keys
 * @returns {Promise<Array>} Array of door lock key objects
 */ 
export async function fetchCloudbedsKeys(propertyID, roomNumber = null, reservationId = null) {
  console.log("[Cloudbeds] Fetching door lock keys:", { propertyID, roomNumber, reservationId });

  if (!BACKEND_URL) {
    throw new Error("BACKEND_URL not configured. Set NEXT_PUBLIC_BACKEND_URL in .env.local");
  }

  if (!propertyID) {
    throw new Error("propertyID is required");
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/cloudbeds/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property_id: propertyID,
        room_number: roomNumber,
        reservation_id: reservationId,
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(errorData.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data?.success) {
      console.log("[Cloudbeds] Found", data.keys?.length || 0, "door lock key(s)");
      return data.keys || [];
    }

    throw new Error(data.error || "Failed to fetch door lock keys");
  } catch (e) {
    console.error("[Cloudbeds] Failed to fetch door lock keys:", e.message);
    throw e;
  }
}

/**
 * Get a specific access code for a reservation/room.
 * This is a convenience function that fetches keys and finds a matching one.
 * 
 * @param {string} propertyID - Cloudbeds property ID
 * @param {string} [roomNumber] - Room number to match
 * @param {string} [reservationId] - Reservation ID to match
 * @returns {Promise<string|null>} Access code or null if not found
 */
export async function fetchCloudbedsAccessCode(propertyID, roomNumber = null, reservationId = null) {
  try {
    const keys = await fetchCloudbedsKeys(propertyID, roomNumber, reservationId);
    
    if (!keys || keys.length === 0) {
      return null;
    }

    const now = new Date();

    // Helper function to extract code from key with multiple field variations
    const extractCode = (key) => {
      if (!key) return null;
      const code = key.code 
        || key.access_code 
        || key.accessCode
        || key.pin 
        || key.keyCode
        || key.key_code
        || key.doorCode
        || key.door_code
        || key.roomCode
        || key.room_code
        || key.passcode
        || key.pass_code;
      return code ? String(code).trim() : null;
    };

    // Filter keys: look for active keys matching the room/reservation
    const matchingKeys = keys.filter((key) => {
      // Check if key is active
      const isActive = !key.status || key.status === "active" || key.status === "enabled";

      // Check if key matches the room
      let roomMatches = true;
      if (roomNumber) {
        const roomStr = String(roomNumber || "").toLowerCase();
        const keyRoom = String(key.roomName || key.room_name || key.roomId || key.room_id || "").toLowerCase();
        roomMatches = keyRoom.includes(roomStr) || roomStr.includes(keyRoom);
      }

      // Check if key matches reservation
      let resMatches = true;
      if (reservationId) {
        resMatches = String(key.reservationID || key.reservation_id || "") === String(reservationId);
      }

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
      const code = extractCode(matchingKeys[0]);
      if (code) {
        return code;
      }
    }

    // If no room-specific match, try any active key for the property
    const anyActiveKey = keys.find((key) => {
      const isActive = !key.status || key.status === "active" || key.status === "enabled";
      const code = extractCode(key);
      return isActive && code;
    });

    if (anyActiveKey) {
      const code = extractCode(anyActiveKey);
      if (code) {
        return code;
      }
    }

    return null;
  } catch (error) {
    console.error("[Cloudbeds] Error fetching access code:", error.message);
    return null;
  }
}

