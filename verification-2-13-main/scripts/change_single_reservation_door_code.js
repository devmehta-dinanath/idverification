require("dotenv").config({ path: ".env.local" });

const crypto = require("crypto");
const fetch = require("node-fetch");
const { createClient } = require("@supabase/supabase-js");

// -----------------------------------------------------------------------------
// Hardcoded values for this one-off script
// -----------------------------------------------------------------------------
const WEBHOOK_EVENT = "reservation.modified";
const RESERVATION_ID = "494N7239BZ";
const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID || "172982356828288";

// Keep this mapping updated with your actual room -> lock IDs
const ROOM_TO_LOCK_ID = {
  "101": 987654,
  "102": 987655,
  "103": 987656,
};

// Cloudbeds and TTLock endpoints
const CLOUDBEDS_BASE = "https://api.cloudbeds.com/api/v1.2";
const CLOUDBEDS_V13_BASE = "https://api.cloudbeds.com/api/v1.3";
const TTLOCK_BASE = "https://euapi.ttlock.com";

// Environment vars
const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!CLOUDBEDS_API_KEY) {
  throw new Error("Missing CLOUDBEDS_API_KEY in environment");
}
if (!TTLOCK_CLIENT_ID || !TTLOCK_CLIENT_SECRET || !TTLOCK_USERNAME || !TTLOCK_PASSWORD) {
  throw new Error("Missing TTLock env vars: TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET, TTLOCK_USERNAME, TTLOCK_PASSWORD");
}

const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

function toMs(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function generateSixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function cloudbedsHeaders() {
  return {
    Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
    Accept: "application/json",
  };
}

async function getReservation(reservationId, propertyId) {
  const url = `${CLOUDBEDS_BASE}/getReservation?reservationID=${encodeURIComponent(reservationId)}&propertyID=${encodeURIComponent(propertyId)}`;
  const res = await fetch(url, { headers: cloudbedsHeaders() });
  const json = await res.json();

  if (!res.ok || !json.success || !json.data) {
    throw new Error(`Cloudbeds getReservation failed: ${json.message || res.statusText}`);
  }

  return json.data;
}

function extractRoomIdOrName(reservationData) {
  const candidate = reservationData.roomNumber
    || reservationData.assignedRoom
    || reservationData.roomName
    || reservationData.roomID
    || reservationData.roomId
    || null;

  if (candidate) return String(candidate).trim();

  const assigned = Array.isArray(reservationData.assigned) ? reservationData.assigned[0] : null;
  if (assigned) {
    return String(assigned.roomName || assigned.roomID || assigned.roomId || "").trim() || null;
  }

  const guestListValues = reservationData.guestList ? Object.values(reservationData.guestList) : [];
  const mainGuest = guestListValues.find((g) => g && g.isMainGuest) || guestListValues[0];
  if (mainGuest) {
    const rooms = Array.isArray(mainGuest.rooms) ? mainGuest.rooms : [];
    const firstRoom = rooms[0];
    if (firstRoom) {
      return String(firstRoom.roomName || firstRoom.roomID || firstRoom.roomId || "").trim() || null;
    }
    return String(mainGuest.roomName || mainGuest.roomID || mainGuest.roomId || "").trim() || null;
  }

  return null;
}

async function getTtlockAccessToken() {
  const passwordMd5 = crypto.createHash("md5").update(TTLOCK_PASSWORD).digest("hex").toLowerCase();

  const body = new URLSearchParams({
    clientId: TTLOCK_CLIENT_ID,
    clientSecret: TTLOCK_CLIENT_SECRET,
    username: TTLOCK_USERNAME,
    password: passwordMd5,
  });

  const res = await fetch(`${TTLOCK_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(`TTLock token failed: ${json.errmsg || json.error_description || JSON.stringify(json)}`);
  }

  return json.access_token;
}

async function deleteOldTtlockCode(accessToken, lockId, keyboardPwdId) {
  if (!keyboardPwdId) return;

  const body = new URLSearchParams({
    clientId: TTLOCK_CLIENT_ID,
    accessToken,
    lockId: String(lockId),
    keyboardPwdId: String(keyboardPwdId),
    deleteType: "2",
    date: String(Date.now()),
  });

  const res = await fetch(`${TTLOCK_BASE}/v3/keyboardPwd/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json = await res.json();
  if (json.errcode !== undefined && json.errcode !== 0) {
    throw new Error(`TTLock delete failed: ${json.errmsg || JSON.stringify(json)}`);
  }

  console.log(`[ttlock] Deleted old keyboardPwdId=${keyboardPwdId}`);
}

async function addTtlockCode(accessToken, lockId, code, startDateMs, endDateMs, name) {
  const body = new URLSearchParams({
    clientId: TTLOCK_CLIENT_ID,
    accessToken,
    lockId: String(lockId),
    keyboardPwd: String(code),
    keyboardPwdName: name,
    keyboardPwdType: "2",
    startDate: String(startDateMs),
    endDate: String(endDateMs),
    addType: "2",
    date: String(Date.now()),
  });

  const res = await fetch(`${TTLOCK_BASE}/v3/keyboardPwd/add`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json = await res.json();
  if (json.errcode !== undefined && json.errcode !== 0) {
    throw new Error(`TTLock add failed: ${json.errmsg || JSON.stringify(json)}`);
  }

  return json.keyboardPwdId;
}

async function findLatestDoorCodeRow(reservationId) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("door_codes")
    .select("id, ttlock_pwd_id, lock_id")
    .eq("reservation_id", reservationId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`[db] Could not read door_codes: ${error.message}`);
    return null;
  }

  return data || null;
}

async function persistDoorCodeRow(payload) {
  if (!supabase) {
    console.warn("[db] Supabase env vars not set, skipping local persistence");
    return;
  } 

  const { error } = await supabase.from("door_codes").insert(payload);
  if (error) {
    console.warn(`[db] Could not insert into door_codes: ${error.message}`);
  } else {
    console.log("[db] Saved new door code row in door_codes");
  }
}

async function markPreviousDoorCodeInactive(previousRowId) {
  if (!supabase || !previousRowId) return;

  const { error } = await supabase
    .from("door_codes")
    .update({ status: "inactive" })
    .eq("id", previousRowId);

  if (error) {
    console.warn(`[db] Could not mark previous door code inactive: ${error.message}`);
  }
}

async function pushDoorCodeToCloudbeds(reservationId, propertyId, doorCode) {
  // Attempt custom field update first.
  const body = new URLSearchParams({
    propertyID: String(propertyId),
    reservationID: String(reservationId),
    customFields: JSON.stringify({ door_code: String(doorCode) }),
  });

  const res = await fetch(`${CLOUDBEDS_V13_BASE}/putReservation`, {
    method: "PUT",
    headers: {
      ...cloudbedsHeaders(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  let json;
  try {
    json = await res.json();
  } catch {
    json = { success: false, message: `HTTP ${res.status}` };
  }

  if (res.ok && json.success) {
    console.log("[cloudbeds] Door code pushed to customFields");
    return;
  }

  // Fallback: add reservation internal note so front desk still sees the code.
  const noteBody = new URLSearchParams({
    propertyID: String(propertyId),
    reservationID: String(reservationId),
    reservationNote: `Door Code: ${doorCode}`,
    type: "internal",
  });

  const noteRes = await fetch(`${CLOUDBEDS_BASE}/putReservationNote`, {
    method: "POST",
    headers: cloudbedsHeaders(),
    body: noteBody,
  });

  const noteJson = await noteRes.json();
  if (!noteRes.ok || !noteJson.success) {
    throw new Error(`Cloudbeds update failed. putReservation=${json.message || "unknown"}, putReservationNote=${noteJson.message || "unknown"}`);
  }

  console.warn("[cloudbeds] Custom field update failed, saved as reservation note instead");
}

async function main() {
  console.log(`Webhook event received: ${WEBHOOK_EVENT}`);

  const reservation = await getReservation(RESERVATION_ID, CLOUDBEDS_PROPERTY_ID);
  const roomId = extractRoomIdOrName(reservation);
  if (!roomId) {
    throw new Error("Could not extract room number/name from reservation");
  }
 
  const lockId = ROOM_TO_LOCK_ID[roomId];
  if (!lockId) {
    throw new Error(`No lock mapping found for room '${roomId}'. Update ROOM_TO_LOCK_ID in this script.`);
  }

  const startDateMs = toMs(reservation.checkInDate || reservation.checkIn || reservation.startDate);
  const endDateMs = toMs(reservation.checkOutDate || reservation.checkOut || reservation.endDate);
  if (!startDateMs || !endDateMs) {
    throw new Error("Could not parse check-in/check-out from reservation data");
  }

  const latest = await findLatestDoorCodeRow(RESERVATION_ID); 
  const oldPwdId = latest?.ttlock_pwd_id || null;

  const newCode = generateSixDigitCode();
  const ttToken = await getTtlockAccessToken();

  if (oldPwdId) {
    await deleteOldTtlockCode(ttToken, lockId, oldPwdId);
  }

  const keyboardPwdId = await addTtlockCode(
    ttToken,
    lockId,
    newCode,
    startDateMs,
    endDateMs,
    `Reservation ${RESERVATION_ID}`
  );

  await persistDoorCodeRow({
    reservation_id: RESERVATION_ID,
    room_id: roomId,
    lock_id: lockId,
    door_code: newCode,
    start_date: new Date(startDateMs).toISOString(),
    end_date: new Date(endDateMs).toISOString(),
    ttlock_pwd_id: keyboardPwdId,
    status: "active",
  });

  if (latest?.id) {
    await markPreviousDoorCodeInactive(latest.id);
  }

  await pushDoorCodeToCloudbeds(RESERVATION_ID, CLOUDBEDS_PROPERTY_ID, newCode);

  console.log("\nDONE");
  console.log(`Reservation: ${RESERVATION_ID}`);
  console.log(`Room: ${roomId}`);
  console.log(`Lock ID: ${lockId}`);
  console.log(`New Door Code: ${newCode}`);
  console.log(`TTLock keyboardPwdId: ${keyboardPwdId}`);
}

main().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
