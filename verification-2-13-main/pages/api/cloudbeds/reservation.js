// pages/api/cloudbeds/reservation.js
import { lookupGuestReservation, getReservationDoorCode } from "../../../lib/cloudbeds";
import { getAccessCode } from "../../../lib/access-codes";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { reservation_id, third_party_identifier, sub_reservation_id } = req.body || {};

  try {
    // Try reservationID first, then thirdPartyIdentifier, then subReservationID
    const lookups = [];
    
    if (reservation_id) {
      lookups.push({ reservation_id });
    }
    if (third_party_identifier) {
      lookups.push({ third_party_identifier });
    }
    if (sub_reservation_id && reservation_id) {
      lookups.push({ reservation_id: reservation_id.split("-")[0], sub_reservation_id });
    }

    // If no specific lookup provided, try all with the first available value
    const bookingRef = reservation_id || third_party_identifier || sub_reservation_id;
    if (!bookingRef) {
      return res.status(400).json({
        success: false,
        error: "Missing reservation_id, third_party_identifier, or sub_reservation_id",
      });
    }

    // Try to find reservation in Cloudbeds using lookupGuestReservation
    // Note: We need guest name for lookupGuestReservation, but we can try without it first
    // lookupGuestReservation will search across all properties
    const cbResult = await lookupGuestReservation("", bookingRef);
    
    if (cbResult.found) {
      // Try to get door code from reservation custom fields first
      let accessCode = await getReservationDoorCode(cbResult.reservationId, cbResult.propertyID);
      
      // If not found in reservation, try doorlock API
      if (!accessCode) {
        accessCode = await getAccessCode({
          propertyID: cbResult.propertyID,
          roomNumber: cbResult.roomNumber,
          reservationId: cbResult.reservationId,
        });
      }

      return res.json({
        success: true,
        guestName: cbResult.guestName,
        roomName: cbResult.roomNumber,
        accessCode: accessCode,
        reservationId: cbResult.reservationId,
        propertyID: cbResult.propertyID,
        guestIsCheckedIn: true, // You may need to check this from Cloudbeds reservation status
      });
    }

    return res.status(404).json({
      success: false,
      error: "Reservation not found in Cloudbeds",
    });
  } catch (error) {
    console.error("[cloudbeds/reservation] Error:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Internal server error",
    });
  }
}

