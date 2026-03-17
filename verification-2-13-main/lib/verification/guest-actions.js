import { supabase } from "../supabase";
import { normalizeGuestName, normalizeReservationNumber, clampInt, toIntOrNull } from "../utils";
import { lookupGuestReservation } from "../cloudbeds";
import { getPropertyIdFromRequest } from "./request-utils";

let demoSessionColumnCache = null;

async function getDemoSessionColumns() {
    if (demoSessionColumnCache) return demoSessionColumnCache;

    try {
        const { data, error } = await supabase
            .from("demo_sessions")
            .select("*")
            .limit(1);

        if (error) {
            console.warn("[update_guest] Could not inspect demo_sessions columns:", error.message);
            demoSessionColumnCache = new Set();
            return demoSessionColumnCache;
        }

        const firstRow = data && data.length > 0 ? data[0] : null;
        demoSessionColumnCache = new Set(firstRow ? Object.keys(firstRow) : []);
        return demoSessionColumnCache;
    } catch (e) {
        console.warn("[update_guest] Column inspection failed:", e?.message || e);
        demoSessionColumnCache = new Set();
        return demoSessionColumnCache;
    }
}

export async function handleUpdateGuest(req, res) {
    const { session_token, guest_name, booking_ref, room_number, expected_guest_count, flow_type, visitor_first_name, visitor_last_name, visitor_phone, visitor_reason } =
        req.body || {};
    if (!session_token) return res.status(400).json({ error: "Session token required" });

    const bookingValue = booking_ref || room_number || null;

    if (!guest_name || !bookingValue) {
        return res.status(400).json({ error: "Guest name and reservation number are required" });
    }

    // ✅ VISITOR FLOW: Skip booking lookup
    const isVisitor = bookingValue === "VISITOR" || flow_type === "visitor";

    if (isVisitor) {
        console.log("[update_guest] Visitor flow detected, skipping booking lookup");

        const updatePayload = {
            guest_name: guest_name || null,
            room_number: "VISITOR",
            status: "visitor_info_saved",
            current_step: "document",
            expected_guest_count: 1,
            verified_guest_count: 0,
            requires_additional_guest: false,
            visitor_first_name: visitor_first_name || null,
            visitor_last_name: visitor_last_name || null,
            visitor_phone: visitor_phone || null,
            visitor_reason: visitor_reason || null,
            extracted_info: {
                type: "visitor",
            },
            updated_at: new Date().toISOString(),
        };

        const { error: updateError } = await supabase
            .from("demo_sessions")
            .update(updatePayload)
            .eq("session_token", session_token);

        if (updateError) {
            console.error("Error saving visitor info:", updateError);
            return res.status(500).json({ error: "Failed to save visitor info" });
        }

        console.log(`[update_guest] ✅ Visitor session updated in DB: token=${session_token}, step=document, status=visitor_info_saved`);

        return res.json({
            success: true,
            flow_type: "visitor",
        });
    }

    // ✅ GUEST FLOW: Look up reservation directly from Cloudbeds (no local cache)
    console.log(`[update_guest] Querying Cloudbeds for guest="${guest_name}", ref="${bookingValue}"`);

    // Require property ID from header for guest flow.
    const headerPropertyId = getPropertyIdFromRequest(req);
    if (!headerPropertyId) {
        return res.status(403).json({
            error: "Reservation not found. Please enter your name and reservation number exactly as shown in your confirmation email.",
        });
    }

    const { data: s, error: sErr } = await supabase
        .from("demo_sessions")
        .select("verified_guest_count")
        .eq("session_token", session_token)
        .single();

    const verified = !sErr && s ? clampInt(s.verified_guest_count, 0, 10) : 0;

    const cbResult = await lookupGuestReservation(
        guest_name,
        bookingValue,
        { propertyID: String(headerPropertyId).trim() }
    );

    if (!cbResult.found) {
        return res.status(403).json({
            error: "Reservation not found. Please enter your name and reservation number exactly as shown in your confirmation email.",
        });
    }

    const adultsFromCB = clampInt(cbResult.adults, 1, 10);
    const childrenFromCB = clampInt(cbResult.children, 0, 10);

    const expectedOverride = toIntOrNull(expected_guest_count);
    const expectedToSet = expectedOverride === null ? adultsFromCB : clampInt(expectedOverride, 1, 10);

    let physical_room = cbResult.roomName || cbResult.roomNumber || null;

    // Core payload – only columns guaranteed to exist in the DB
    const updatePayload = {
        guest_name,
        room_number: cbResult.roomNumber || bookingValue,
        adults: adultsFromCB,
        children: childrenFromCB,
        status: "guest_info_saved",
        current_step: "document",
        expected_guest_count: expectedToSet,
        requires_additional_guest: verified < expectedToSet,
        cloudbeds_reservation_id: cbResult.reservationId,
        cloudbeds_property_id: cbResult.propertyID,
        physical_room,
        updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
        .from("demo_sessions")
        .update(updatePayload)
        .eq("session_token", session_token);

    if (updateError) {
        console.error("Error saving guest info:", updateError);
        return res.status(500).json({ error: "Failed to save guest info" });
    }

    console.log(
        `[update_guest] ✅ Session updated in DB: token=${session_token}, reservation=${cbResult.reservationId}, room=${cbResult.roomNumber || bookingValue}, step=document, status=guest_info_saved`
    );

    // Attempt to persist extended Cloudbeds columns only if they exist in this DB.
    const extendedPayload = {
        room_type_name: cbResult.roomTypeName || null,
        cloudbeds_check_in: cbResult.checkIn || null,
        cloudbeds_check_out: cbResult.checkOut || null,
        cloudbeds_guest_details: cbResult.guestDetails || null,
    };

    const existingColumns = await getDemoSessionColumns();
    const filteredExtendedPayload = Object.fromEntries(
        Object.entries(extendedPayload).filter(([key]) => existingColumns.has(key))
    );

    if (Object.keys(filteredExtendedPayload).length > 0) {
        const { error: extErr } = await supabase
            .from("demo_sessions")
            .update(filteredExtendedPayload)
            .eq("session_token", session_token);
        if (extErr) {
            console.warn("[update_guest] Extended columns update skipped:", extErr.message);
        } else {
            console.log(`[update_guest] ✅ Extended Cloudbeds fields saved in DB: token=${session_token}, fields=${Object.keys(filteredExtendedPayload).join(",")}`);
        }
    }

    return res.json({
        success: true,
        adults: adultsFromCB,
        children: childrenFromCB,
        expected_guest_count: expectedToSet,
        verified_guest_count: verified,
        requires_additional_guest: verified < expectedToSet,
        remaining_guest_verifications: Math.max(expectedToSet - verified, 0),
    });
}

export async function handleTm30Update(req, res) {
    const { session_token, tm30_info } = req.body || {};
    if (!session_token) return res.status(400).json({ error: "Session token required" });

    const payload = tm30_info && typeof tm30_info === "object" ? tm30_info : {};
    const requiredKeys = [
        "nationality", "sex", "arrival_date_time", "departure_date", "property", "room_number",
    ];

    const missing = requiredKeys.filter((k) => {
        const v = payload[k];
        return v === undefined || v === null || String(v).trim() === "";
    });

    const tm30_status = missing.length === 0 ? "ready" : "draft";

    const { data, error } = await supabase
        .from("demo_sessions")
        .update({
            tm30_info: payload,
            tm30_status,
            updated_at: new Date().toISOString(),
        })
        .eq("session_token", session_token)
        .select("*")
        .single();

    if (error || !data) {
        console.error("tm30_update error:", error);
        return res.status(500).json({ error: error?.message || "Failed to update TM30 info" });
    }

    return res.status(200).json({
        success: true,
        tm30_status,
        missing_fields: missing,
        row: data,
    });
}
