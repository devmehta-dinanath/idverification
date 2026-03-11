import { supabase } from "./supabase";

/**
 * Insert a verified guest row into Supabase.
 * Best-effort: logs and returns null on error, does not throw.
 *
 * Expected payload fields (all optional, best-effort mapping):
 * - session_token, guest_index
 * - firstName, middleName, lastName, gender
 * - passport, nationality, birthDate
 * - startDate, endDate, room, roomType
 * - phone, email
 * - verifiedAt, verificationScore
 * - cloudbeds_reservation_id, cloudbeds_property_id
 */
export async function insertVerifiedGuestRow(payload = {}) {
    try {
        const row = {
            session_token: payload.session_token || null,
            guest_index: payload.guest_index ?? null,

            first_name: payload.firstName || null,
            middle_name: payload.middleName || null,
            last_name: payload.lastName || null,
            gender: payload.gender || null,
            passport_no: payload.passport || null,
            nationality: payload.nationality || null,
            birth_date: payload.birthDate || null,

            start_date: payload.startDate || null,
            end_date: payload.endDate || null,
            room: payload.room || null,
            room_type: payload.roomType || null,

            phone: payload.phone || null,
            email: payload.email || null,

            verified_at: payload.verifiedAt ? new Date(payload.verifiedAt) : null,
            verification_score: payload.verificationScore ?? null,

            cloudbeds_reservation_id: payload.cloudbeds_reservation_id || null,
            cloudbeds_property_id: payload.cloudbeds_property_id || null,
        };

        const { error } = await supabase
            .from("verified_guest_rows")
            .insert(row);

        if (error) {
            console.warn("[verification-log] Failed to insert verified_guest_row:", error.message);
            return null;
        }

        return true;
    } catch (err) {
        console.warn("[verification-log] Unexpected error inserting verified_guest_row:", err?.message || err);
        return null;
    }
}

