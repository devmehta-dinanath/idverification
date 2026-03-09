import { supabase } from "../supabase";
import { inferStepFromSession } from "../session";
import { sendCheckinEmail, sendCheckinSms } from "../email";

const CHECKIN_EMAIL_MAX_AGE_MINUTES = parseInt(
    process.env.CHECKIN_EMAIL_MAX_AGE_MINUTES || "1440",
    10
);

function isValidEmail(email) {
    if (!email || typeof email !== "string") return false;
    const trimmed = email.trim();
    // Pragmatic email validation – not perfect but catches most obvious issues.
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(trimmed);
}

function isValidPhone(phone) {
    if (!phone || typeof phone !== "string") return false;
    const trimmed = phone.trim();
    // Basic E.164-style validation (no hardcoded country rules).
    return /^\+?[1-9]\d{7,14}$/.test(trimmed);
}

function maskEmail(email) {
    if (!email) return null;
    const trimmed = String(email).trim();
    const [user, domain] = trimmed.split("@");
    if (!domain) return trimmed;
    if (user.length <= 2) return `${user[0]}***@${domain}`;
    return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

function maskPhone(phone) {
    if (!phone) return null;
    const digits = String(phone).trim();
    if (digits.length <= 4) return digits;
    const visible = digits.slice(-4);
    return `${"*".repeat(Math.max(digits.length - 4, 0))}${visible}`;
}

export async function handleSendCheckinEmail(req, res) {
    const { session_token, email, phone, channel, locale } = req.body || {};

    if (!session_token || typeof session_token !== "string") {
        return res.status(400).json({ error: "session_token is required" });
    }

    if (!isValidEmail(email)) {
        return res.status(400).json({ error: "A valid email address is required" });
    }

    const trimmedPhone = typeof phone === "string" ? phone.trim() : null;
    const wantsSms =
        channel === "sms" ||
        channel === "email_and_sms" ||
        (channel === undefined && Boolean(trimmedPhone));

    if (wantsSms && trimmedPhone && !isValidPhone(trimmedPhone)) {
        return res.status(400).json({ error: "Invalid phone number format" });
    }

    // --- Load session ---
    const { data: session, error: sessionError } = await supabase
        .from("demo_sessions")
        .select("*")
        .eq("session_token", session_token)
        .single();

    if (sessionError || !session) {
        console.error("[send_checkin_email] Session not found:", session_token, sessionError);
        return res.status(404).json({ error: "Session not found" });
    }

    // --- Eligibility checks ---
    const inferredStep = inferStepFromSession(session);
    const isVerified =
        session.is_verified === true ||
        session.status === "verified" ||
        inferredStep === "results";

    if (!isVerified) {
        return res.status(409).json({
            error: "Session is not in a verified state",
            code: "session_not_verified",
        });
    }

    const roomAccessCode =
        session.room_access_code ||
        session.visitor_access_code ||
        null;

    if (!roomAccessCode) {
        return res.status(409).json({
            error: "Access code is not available for this session",
            code: "access_code_missing",
        });
    }

    // Optional explicit expiry from DB.
    const now = new Date();
    if (session.expires_at) {
        const expiresAt = new Date(session.expires_at);
        if (Number.isFinite(expiresAt.getTime()) && now > expiresAt) {
            return res.status(410).json({
                error: "Session has expired",
                code: "session_expired",
            });
        }
    } else if (CHECKIN_EMAIL_MAX_AGE_MINUTES > 0) {
        const baseTime = new Date(session.updated_at || session.created_at || now);
        const ageMinutes =
            (now.getTime() - baseTime.getTime()) / (1000 * 60);
        if (ageMinutes > CHECKIN_EMAIL_MAX_AGE_MINUTES) {
            return res.status(410).json({
                error: "Session is too old for sending check-in details",
                code: "session_stale",
            });
        }
    }

    // --- Idempotency / one-time semantics ---
    const alreadySentAt = session.checkin_email_sent_at;
    if (alreadySentAt) {
        return res.status(200).json({
            success: true,
            already_sent: true,
            sent_email: false,
            sent_sms: false,
            sent_to_email: session.checkin_email_sent_to || null,
            sent_to_phone: session.checkin_sms_sent_to || null,
            sent_at: alreadySentAt,
        });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // --- Send email / SMS using provider-agnostic helpers ---
    let emailResult = null;
    let smsResult = null;

    try {
        emailResult = await sendCheckinEmail({
            to: normalizedEmail,
            locale: locale || session.consent_locale || "en",
            session,
        });
    } catch (e) {
        console.error("[send_checkin_email] Email send failed:", e?.message || e);
        return res.status(500).json({
            error: "Failed to send check-in email",
        });
    }

    if (wantsSms && trimmedPhone) {
        try {
            smsResult = await sendCheckinSms({
                to: trimmedPhone,
                locale: locale || session.consent_locale || "en",
                session,
            });
        } catch (e) {
            console.warn(
                "[send_checkin_email] SMS send failed (continuing, email already sent):",
                e?.message || e
            );
        }
    }

    // --- Persist send metadata (idempotency marker) ---
    const { error: updateError } = await supabase
        .from("demo_sessions")
        .update({
            checkin_email_sent_at: now.toISOString(),
            checkin_email_sent_to: normalizedEmail,
            checkin_sms_sent_to: trimmedPhone || null,
            checkin_notification_attempts:
                (session.checkin_notification_attempts || 0) + 1,
            updated_at: new Date().toISOString(),
        })
        .eq("session_token", session_token);

    if (updateError) {
        console.warn(
            "[send_checkin_email] Failed to persist notification metadata:",
            updateError.message
        );
        // Do not fail the API if email was already handed off to provider.
    }

    const maskedEmail = maskEmail(normalizedEmail);
    const maskedPhone = trimmedPhone ? maskPhone(trimmedPhone) : null;

    console.log("[send_checkin_email] Notification sent for session", session_token, {
        email: maskedEmail,
        phone: maskedPhone,
        provider_email: emailResult?.provider,
        provider_sms: smsResult?.provider,
    });

    return res.status(200).json({
        success: true,
        already_sent: false,
        sent_email: Boolean(emailResult),
        sent_sms: Boolean(smsResult),
        sent_to_email: normalizedEmail,
        sent_to_phone: trimmedPhone || null,
        sent_at: now.toISOString(),
    });
}


