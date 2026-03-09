// pages/api/cloudbeds/keys.js
import { getDoorLockKeys } from "../../../lib/cloudbeds";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { property_id, room_number, reservation_id } = req.body || {};

  try {
    if (!property_id) {
      return res.status(400).json({
        success: false,
        error: "Missing property_id",
      });
    }

    // Fetch all door lock keys for the property
    const keys = await getDoorLockKeys(property_id);

    if (!keys || keys.length === 0) {
      return res.json({
        success: true,
        keys: [],
        message: "No door lock keys found for this property",
      });
    }

    // Filter keys if room_number or reservation_id is provided
    let filteredKeys = keys;
    const now = new Date();

    if (room_number || reservation_id) {
      filteredKeys = keys.filter((key) => {
        // Check if key is active
        const isActive = !key.status || key.status === "active" || key.status === "enabled";
        if (!isActive) return false;

        // Check if key matches the room
        let roomMatches = true;
        if (room_number) {
          const roomStr = String(room_number).toLowerCase();
          const keyRoom = String(key.roomName || key.room_name || key.roomId || key.room_id || "").toLowerCase();
          roomMatches = keyRoom.includes(roomStr) || roomStr.includes(keyRoom);
        }

        // Check if key matches reservation
        let resMatches = true;
        if (reservation_id) {
          resMatches = String(key.reservationID || key.reservation_id || "") === String(reservation_id);
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

        return roomMatches && resMatches && timeValid;
      });
    }

    return res.json({
      success: true,
      keys: filteredKeys,
      total: keys.length,
      filtered: filteredKeys.length,
    });
  } catch (error) {
    console.error("[cloudbeds/keys] Error:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Internal server error",
    });
  }
}


