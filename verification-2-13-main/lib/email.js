import { getReservation } from "./cloudbeds";
import nodemailer from "nodemailer";

/**
 * Lightweight, provider-agnostic email + SMS helpers for check-in notifications.
 *
 * NOTE:
 * - No property-specific data is hardcoded here. Everything comes from
 *   session data, Cloudbeds reservation data, or environment variables.
 * - In local/dev environments where an email provider is not configured,
 *   these helpers log the payload instead of sending real messages.
 */

const EMAIL_MODE = process.env.CHECKIN_EMAIL_MODE || process.env.EMAIL_PROVIDER || "log"; // "log" | "smtp"
const SMS_MODE = process.env.CHECKIN_SMS_MODE || process.env.SMS_PROVIDER || "log"; // "log" | future real providers

/**
 * Fetch reservation details from Cloudbeds when IDs are available.
 * Returns null if lookup fails for any reason.
 */
async function safeGetReservationForSession(session) {
    const reservationId = session.cloudbeds_reservation_id;
    const propertyId = session.cloudbeds_property_id || session.property_external_id || null;

    if (!reservationId) return null;

    try {
        const data = await getReservation(reservationId, propertyId || undefined);
        return data || null;
    } catch (e) {
        console.warn("[email] getReservation failed for session", session.session_token, e?.message || e);
        return null;
    }
}

/**
 * Derive property display information using only live data.
 * Falls back to IDs when friendly names are not available.
 */
function buildPropertyInfo(session, reservationData) {
    const propertyId =
        reservationData?.propertyID ||
        reservationData?.propertyId ||
        session.cloudbeds_property_id ||
        session.property_external_id ||
        null;

    const propertyName =
        reservationData?.propertyName ||
        reservationData?.property_name ||
        reservationData?.hotelName ||
        null;

    // Addresses / contact info may or may not be present in reservation data;
    // we only use what is available to avoid introducing hardcoded property data.
    const addressLine1 =
        reservationData?.addressLine1 ||
        reservationData?.address1 ||
        reservationData?.propertyAddress1 ||
        null;

    const addressLine2 =
        reservationData?.addressLine2 ||
        reservationData?.address2 ||
        reservationData?.propertyAddress2 ||
        null;

    const city =
        reservationData?.city ||
        reservationData?.propertyCity ||
        null;

    const country =
        reservationData?.country ||
        reservationData?.propertyCountry ||
        null;

    const supportPhone =
        reservationData?.phone ||
        reservationData?.propertyPhone ||
        process.env.PROPERTY_SUPPORT_PHONE ||
        null;

    const supportEmail =
        reservationData?.email ||
        reservationData?.propertyEmail ||
        process.env.PROPERTY_SUPPORT_EMAIL ||
        null;

    return {
        id: propertyId,
        name: propertyName || (propertyId ? `Property ${propertyId}` : "Your Property"),
        addressLine1,
        addressLine2,
        city,
        country,
        supportPhone,
        supportEmail,
    };
}

function buildReservationReference(session, reservationData) {
    return (
        reservationData?.reservationID ||
        reservationData?.reservationId ||
        session.cloudbeds_reservation_id ||
        session.room_number ||
        session.booking_ref ||
        session.id ||
        "Reservation"
    );
}

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function buildCheckinEmailContent({ to, locale, session, reservationData }) {
    const property = buildPropertyInfo(session, reservationData);
    const reservationRef = buildReservationReference(session, reservationData);

    const guestName = session.guest_name || reservationData?.guestName || "Guest";

    const physicalRoom =
        session.physical_room ||
        reservationData?.assignedRoomName ||
        reservationData?.roomName ||
        null;

    const roomAccessCode =
        session.room_access_code ||
        session.visitor_access_code ||
        null;

    const checkIn = reservationData?.startDate || reservationData?.checkIn || null;
    const checkOut = reservationData?.endDate || reservationData?.checkOut || null;

    const brandName = "OPSIAN";
    const subject = `Your check-in details – Reservation ${reservationRef}`;

    const lines = [];
    lines.push(`Dear ${guestName},`);
    lines.push("");
    lines.push(`Your identity verification was successful. Here are your ${brandName} check-in details:`);
    lines.push("");
    lines.push(`Reservation: ${reservationRef}`);
    if (physicalRoom) {
        lines.push(`Room: ${physicalRoom}`);
    } else {
        lines.push("Room: Pending assignment (please see the front desk on arrival).");
    }
    if (checkIn || checkOut) {
        lines.push(
            `Stay: ${
                checkIn ? `Check-in ${checkIn}` : ""
            }${checkIn && checkOut ? " – " : ""}${checkOut ? `Check-out ${checkOut}` : ""}`
        );
    }
    lines.push("");
    if (roomAccessCode) {
        lines.push("Door Access Code:");
        lines.push(roomAccessCode);
        lines.push(
            "Use this code at the property entrance keypad. For your security, do not share this code with others."
        );
        lines.push("");
    }
    lines.push(
        "If you experience any issues at the door or with your reservation, please contact the property team."
    );
    if (property.supportPhone) {
        lines.push(`Phone: ${property.supportPhone}`);
    }
    if (property.supportEmail) {
        lines.push(`Email: ${property.supportEmail}`);
    }
    lines.push("");
    lines.push(
        "This email was generated from your verification session. For your privacy, your ID images and selfies are deleted according to our data-retention policy."
    );

    const textBody = lines.join("\n");

    const htmlBody = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#e8d5c0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <!--[if mso]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:100%;"><v:fill type="gradient" color="#d7e4f4" color2="#f2b27c" angle="180"/><v:textbox inset="0,0,0,0"><![endif]-->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
      style="min-height:100%;background:linear-gradient(180deg,#d4e3f3 0%,#e8cdb0 50%,#e8aa6e 100%);">
      <tr>
        <td align="center" style="padding:48px 16px 48px 16px;">

          <!-- Outer container (max 600px) -->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;">

            <!-- ── BRAND HEADER ── -->
            <tr>
              <td align="center" style="padding:0 0 24px 0;">
                <div style="font-size:30px;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:#1e293b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  ${escapeHtml(brandName)}
                </div>
                <div style="font-size:13px;color:#475569;margin-top:4px;letter-spacing:0.03em;">
                  Fast, secure &amp; compliant identity verification
                </div>
              </td>
            </tr>

            <!-- ── MAIN CARD ── -->
            <tr>
              <td style="background-color:#ffffff;border-radius:24px;padding:0;overflow:hidden;box-shadow:0 20px 60px rgba(15,23,42,0.18);">

                <!-- Card header band -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding:28px 36px 20px 36px;border-bottom:1px solid #f1f5f9;text-align:center;">
                      <div style="font-size:26px;font-weight:700;color:#111827;margin-bottom:4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                        Guest Check&#8209;In
                      </div>
                      <div style="font-size:13px;color:#6b7280;">
                        Check&#8209;in details for your upcoming stay
                      </div>
                    </td>
                  </tr>

                  <!-- Greeting -->
                  <tr>
                    <td style="padding:24px 36px 0 36px;font-size:15px;color:#1e293b;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      <p style="margin:0 0 8px 0;font-weight:600;">Dear ${escapeHtml(guestName)},</p>
                      <p style="margin:0 0 20px 0;color:#374151;">
                        Your identity verification was successful. Here are your check&#8209;in details.
                      </p>
                    </td>
                  </tr>

                  <!-- ── STAY DETAILS BOX ── -->
                  <tr>
                    <td style="padding:0 36px 20px 36px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                        style="background-color:#f8fafc;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;">
                        <tr>
                          <td style="padding:14px 20px 10px 20px;">
                            <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                              Stay Details
                            </div>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                              style="font-size:14px;color:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                              <tr>
                                <td style="padding:5px 0;font-weight:600;color:#374151;width:120px;vertical-align:top;">Reservation</td>
                                <td style="padding:5px 0;color:#111827;font-weight:500;">${escapeHtml(reservationRef)}</td>
                              </tr>
                              ${
                                  physicalRoom
                                      ? `<tr>
                                <td style="padding:5px 0;font-weight:600;color:#374151;vertical-align:top;">Room</td>
                                <td style="padding:5px 0;color:#111827;font-weight:500;">${escapeHtml(physicalRoom)}</td>
                              </tr>`
                                      : `<tr>
                                <td style="padding:5px 0;font-weight:600;color:#374151;vertical-align:top;">Room</td>
                                <td style="padding:5px 0;color:#6b7280;font-style:italic;">Pending assignment (please see the front desk on arrival).</td>
                              </tr>`
                              }
                              ${
                                  checkIn || checkOut
                                      ? `<tr>
                                <td style="padding:5px 0;font-weight:600;color:#374151;vertical-align:top;">Stay</td>
                                <td style="padding:5px 0;color:#111827;font-weight:500;">
                                  ${checkIn ? `Check&#8209;in ${escapeHtml(checkIn)}` : ""}${checkIn && checkOut ? " &ndash; " : ""}${checkOut ? `Check&#8209;out ${escapeHtml(checkOut)}` : ""}
                                </td>
                              </tr>`
                                      : ""
                              }
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- ── DOOR ACCESS CODE ── -->
                  ${
                      roomAccessCode
                          ? `<tr>
                    <td style="padding:0 36px 24px 36px;">
                      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                        Door Access Code
                      </div>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                        style="background-color:#0f172a;border-radius:14px;overflow:hidden;">
                        <tr>
                          <td style="padding:20px 24px;text-align:center;">
                            <div style="font-size:32px;font-weight:700;letter-spacing:0.42em;color:#f9fafb;font-family:'Courier New',Courier,monospace;">
                              ${escapeHtml(roomAccessCode)}
                            </div>
                            <div style="font-size:12px;color:#94a3b8;margin-top:8px;line-height:1.5;">
                              Use this code at the property entrance keypad.&nbsp;
                              For your security, do not share this code with others.
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>`
                          : ""
                  }

                  <!-- ── SUPPORT NOTE ── -->
                  <tr>
                    <td style="padding:0 36px 20px 36px;font-size:13px;color:#6b7280;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      If you experience any issues at the door or with your reservation, please contact the property team.
                      ${property.supportPhone ? `<br/>Phone: <span style="color:#374151;font-weight:600;">${escapeHtml(property.supportPhone)}</span>` : ""}
                      ${property.supportEmail ? `<br/>Email: <a href="mailto:${escapeHtml(property.supportEmail)}" style="color:#3b82f6;text-decoration:none;">${escapeHtml(property.supportEmail)}</a>` : ""}
                    </td>
                  </tr>

                  <!-- ── FOOTER BAND ── -->
                  <tr>
                    <td style="padding:14px 36px 18px 36px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;line-height:1.6;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      This email was generated from your verification session. For your privacy, your ID images and selfies are deleted according to our data&#8209;retention policy.
                    </td>
                  </tr>

                </table>
              </td>
            </tr>

            <!-- Bottom spacer brand note -->
            <tr>
              <td align="center" style="padding:20px 0 0 0;font-size:11px;color:#64748b;letter-spacing:0.04em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                &copy; ${new Date().getFullYear()} ${escapeHtml(brandName)} &mdash; Secure AI hotel check&#8209;in
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
    <!--[if mso]></v:textbox></v:rect><![endif]-->
  </body>
</html>
`.trim();

    return { subject, textBody, htmlBody, property, reservationRef, guestName, roomAccessCode };
}

export async function sendCheckinEmail({ to, locale, session }) {
    if (!to) {
        throw new Error("Email recipient required");
    }

    const reservationData = await safeGetReservationForSession(session);
    const content = buildCheckinEmailContent({ to, locale, session, reservationData });

    // --- SMTP provider (real sending) ---
    if (EMAIL_MODE === "smtp") {
        const host = process.env.SMTP_HOST;
        const portRaw = process.env.SMTP_PORT;
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;
        const from = process.env.SMTP_FROM;

        if (!host || !portRaw || !user || !pass || !from) {
            console.warn(
                "[sendCheckinEmail] SMTP mode requested but SMTP_* env vars are incomplete. Falling back to log mode."
            );
        } else {
            const port = parseInt(portRaw, 10) || 587;
            const secure =
                process.env.SMTP_SECURE === "true" || port === 465;

            const transporter = nodemailer.createTransport({
                host,
                port,
                secure,
                auth: {
                    user,
                    pass,
                },
            });

            const mailOptions = {
                from,
                to,
                subject: content.subject,
                text: content.textBody,
                html: content.htmlBody,
            };

            const replyTo = process.env.SMTP_REPLY_TO;
            if (replyTo) {
                Object.assign(mailOptions, { replyTo });
            }

            const info = await transporter.sendMail(mailOptions);
            console.log("[sendCheckinEmail] Email sent via SMTP:", {
                messageId: info.messageId,
                to,
            });

            return {
                provider: "smtp",
                mode: EMAIL_MODE,
                to,
                subject: content.subject,
                messageId: info.messageId,
            };
        }
    }

    // --- Log mode (default / fallback) ---
    if (EMAIL_MODE === "log" || !process.env.EMAIL_PROVIDER) {
        console.log("[sendCheckinEmail] (log mode) Prepared email:", {
            to,
            subject: content.subject,
            textBody: content.textBody,
        });
        return {
            provider: "log",
            mode: EMAIL_MODE,
            to,
            subject: content.subject,
        };
    }

    // Placeholder for real provider integration.
    // Implementations can be added here using EMAIL_PROVIDER and its credentials.
    console.warn(
        "[sendCheckinEmail] EMAIL_PROVIDER is set but no concrete provider implementation exists. Falling back to log mode."
    );
    console.log("[sendCheckinEmail] (fallback log) Prepared email:", {
        to,
        subject: content.subject,
        textBody: content.textBody,
    });
    return {
        provider: "log-fallback",
        mode: EMAIL_MODE,
        to,
        subject: content.subject,
    };
}

export async function sendCheckinSms({ to, locale, session }) {
    if (!to) {
        throw new Error("SMS recipient required");
    }

    const reservationData = await safeGetReservationForSession(session);
    const property = buildPropertyInfo(session, reservationData);
    const reservationRef = buildReservationReference(session, reservationData);

    const physicalRoom =
        session.physical_room ||
        reservationData?.assignedRoomName ||
        reservationData?.roomName ||
        null;

    const roomAccessCode =
        session.room_access_code ||
        session.visitor_access_code ||
        null;

    const guestName = session.guest_name || reservationData?.guestName || "Guest";

    const parts = [];
    parts.push(`${property.name} – check-in details for ${guestName}`);
    parts.push(`Ref: ${reservationRef}`);
    if (physicalRoom) {
        parts.push(`Room: ${physicalRoom}`);
    }
    if (roomAccessCode) {
        parts.push(`Door code: ${roomAccessCode}`);
    }
    if (property.supportPhone) {
        parts.push(`Help: ${property.supportPhone}`);
    }

    const message = parts.join(" | ");

    if (SMS_MODE === "log" || !process.env.SMS_PROVIDER) {
        console.log("[sendCheckinSms] (log mode) Prepared SMS:", {
            to,
            message,
        });
        return {
            provider: "log",
            mode: SMS_MODE,
            to,
        };
    }

    // Placeholder for real SMS provider integration.
    console.warn(
        "[sendCheckinSms] SMS_PROVIDER is set but no concrete provider implementation exists. Falling back to log mode."
    );
    console.log("[sendCheckinSms] (fallback log) Prepared SMS:", {
        to,
        message,
    });
    return {
        provider: "log-fallback",
        mode: SMS_MODE,
        to,
    };
}


