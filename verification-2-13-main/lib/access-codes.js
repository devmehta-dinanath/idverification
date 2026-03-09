import { supabase } from "./supabase";
import { getDoorLockAccessCode, getVisitorAccessCode } from "./cloudbeds";
import { isConfigured as isTTLockConfigured, getOrCreateVisitorPasscode } from "./ttlock";

/**
 * Get a door access code. Tries TTLock (if configured) then Cloudbeds Door Locks API,
 * then falls back to the Supabase door_code_schedule table.
 *
 * For visitors (isVisitor=true): TTLock creates a temp passcode, else Cloudbeds, else schedule.
 * For guests: Cloudbeds for property/room, else schedule.
 *
 * @param {Object} options
 * @param {string}  [options.propertyID]    - Cloudbeds property ID
 * @param {string}  [options.roomNumber]    - Room number to match in Cloudbeds
 * @param {string}  [options.reservationId] - Cloudbeds reservation ID (optional)
 * @param {boolean} [options.isVisitor]     - If true, search for a visitor code (TTLock or Cloudbeds)
 * @returns {string|null} - The access code, or null if none found
 */
export async function getAccessCode({ propertyID, roomNumber, reservationId, isVisitor } = {}) {
    // ── 1a. VISITOR: try TTLock first (create temp passcode), then Cloudbeds ──
    if (isVisitor) {
        if (isTTLockConfigured()) {
            try {
                console.log(`[getAccessCode] Visitor flow → trying TTLock (create passcode)`);
                const result = await getOrCreateVisitorPasscode({ validHours: 24 });
                if (result?.code) {
                    console.log(`[getAccessCode] ✅ Visitor access code from TTLock (lock ${result.lockId})`);
                    return result.code;
                }
            } catch (err) {
                console.warn(`[getAccessCode] TTLock visitor passcode failed, trying Cloudbeds:`, err.message);
            }
        }
        try {
            console.log(`[getAccessCode] Visitor flow → searching Cloudbeds properties for door lock code`);
            const result = await getVisitorAccessCode();
            if (result?.code) {
                console.log(`[getAccessCode] ✅ Visitor access code from Cloudbeds property ${result.propertyID}`);
                return result.code;
            }
            console.log(`[getAccessCode] No visitor code from Cloudbeds, falling back to Supabase schedule`);
        } catch (err) {
            console.warn(`[getAccessCode] Cloudbeds visitor lookup failed, falling back:`, err.message);
        }
    }
    // ── 1b. GUEST: search specific property/room ──
    else if (propertyID) {
        try {
            console.log(`[getAccessCode] Trying Cloudbeds Door Locks for property ${propertyID}, room ${roomNumber || "any"}`);
            const cbCode = await getDoorLockAccessCode(propertyID, roomNumber, reservationId);
            if (cbCode) {
                console.log(`[getAccessCode] ✅ Got access code from Cloudbeds Door Locks`);
                return cbCode;
            }
            console.log(`[getAccessCode] No code from Cloudbeds, falling back to Supabase schedule`);
        } catch (err) {
            console.warn(`[getAccessCode] Cloudbeds Door Locks failed, falling back to Supabase:`, err.message);
        }
    } else {
        console.log(`[getAccessCode] No propertyID provided, using Supabase schedule`);
    }

    // ── 2. Fallback: Supabase door_code_schedule table ──
    return getAccessCodeFromSchedule();
}

/**
 * Get access code from Supabase door_code_schedule table.
 * Uses Bangkok timezone to determine the current day-of-week and time slot.
 */
async function getAccessCodeFromSchedule() {
    try {
        const now = new Date();

        // Use Intl to get robust Bangkok time parts
        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Bangkok",
            hour12: false,
            weekday: "short", // "Sun", "Mon", etc.
            hour: "numeric",
            minute: "numeric",
        });

        const parts = formatter.formatToParts(now);
        const part = (type) => parts.find((p) => p.type === type)?.value;

        const weekdayStr = part("weekday");
        const hourStr = part("hour");
        const minuteStr = part("minute");

        // Map weekday short string to 0-6 (Sun-Sat) to match JS getDay() and DB schedule
        const dowMap = {
            Sun: 0,
            Mon: 1,
            Tue: 2,
            Wed: 3,
            Thu: 4,
            Fri: 5,
            Sat: 6,
        };

        const dow = dowMap[weekdayStr];
        if (dow === undefined) {
            console.error(`[getAccessCode] FAILED to map weekday: ${weekdayStr}`);
            return null;
        }

        const currentHour = parseInt(hourStr, 10);
        const currentMin = parseInt(minuteStr, 10);
        const totalMins = currentHour * 60 + currentMin;

        console.log(
            `[getAccessCode] Bangkok Time: ${currentHour}:${currentMin} (dow=${dow}, mins=${totalMins}, raw_weekday=${weekdayStr})`
        );

        const { data, error } = await supabase
            .from("door_code_schedule")
            .select("access_code")
            .eq("dow", dow)
            .lte("start_min", totalMins)
            .gte("end_min", totalMins)
            .eq("is_active", true)
            .limit(1);

        if (error) {
            console.error("Error fetching access code:", error);
            return null;
        }

        if (data && data.length > 0) {
            return data[0].access_code;
        }

        console.warn(`[getAccessCode] No active code found for dow=${dow}, mins=${totalMins}`);
        return null;
    } catch (err) {
        console.error("Exception fetching access code:", err);
        return null;
    }
}
