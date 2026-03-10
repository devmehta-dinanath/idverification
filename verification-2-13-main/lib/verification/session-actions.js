import { supabase } from "../supabase";
import { generateToken } from "../utils";
import { inferStepFromSession } from "../session";
import { clampInt } from "../utils";
import { getPropertyIdFromRequest } from "./request-utils";

export async function handleStartVisitor(req, res) {
    const headerPropertyId = getPropertyIdFromRequest(req);
    const { property_external_id: bodyPropertyExternalId } = req.body || {};
    const property_external_id =
        headerPropertyId || bodyPropertyExternalId || process.env.DEFAULT_PROPERTY_EXTERNAL_ID || null;

    const token = generateToken();
    const expected_guest_count = 1;
    const verified_guest_count = 0;
    const requires_additional_guest = false;

    const { error } = await supabase.from("demo_sessions").insert({
        session_token: token,
        status: "started",
        current_step: "welcome",
        expected_guest_count,
        verified_guest_count,
        requires_additional_guest,
        // Persist property context so this session is tied to a kiosk/online property.
        property_external_id,
        extracted_info: { type: "visitor" },
        updated_at: new Date().toISOString(),
    });

    if (error) {
        console.error("Error creating visitor session:", error);
        return res.status(500).json({ error: "Failed to create visitor session" });
    }

    return res.json({
        success: true,
        session_token: token,
        verify_url: `/verify/${token}?type=visitor`,
    });
}

export async function handleStart(req, res) {
    const headerPropertyId = getPropertyIdFromRequest(req);
    const { property_external_id: bodyPropertyExternalId } = req.body || {};
    const property_external_id =
        headerPropertyId || bodyPropertyExternalId || process.env.DEFAULT_PROPERTY_EXTERNAL_ID || null;

    const token = generateToken();
    const expected_guest_count = 1;
    const verified_guest_count = 0;
    const requires_additional_guest = expected_guest_count > verified_guest_count;

    const { error } = await supabase.from("demo_sessions").insert({
        session_token: token,
        status: "started",
        current_step: "welcome",
        expected_guest_count,
        verified_guest_count,
        requires_additional_guest,
        // Persist property context so this session is tied to a kiosk/online property.
        property_external_id,
        updated_at: new Date().toISOString(),
    });

    if (error) {
        console.error("Error creating session:", error);
        return res.status(500).json({ error: "Failed to create session" });
    }

    return res.json({
        session_token: token,
        verify_url: `/verify/${token}`,
    });
}

export async function handleGetSession(req, res) {
    const { session_token } = req.body || {};
    if (!session_token) return res.status(400).json({ error: "Session token required" });

    const { data: session, error } = await supabase
        .from("demo_sessions")
        .select("*")
        .eq("session_token", session_token)
        .single();

    if (error || !session) {
        console.error(`[verify.js] Session not found: ${session_token}`, error);
        return res.status(404).json({ error: "Session not found" });
    }

    // Optional inactivity timeout (DISABLED by default to avoid changing flow).
    // Enable by setting SESSION_INACTIVITY_TIMEOUT_MINUTES to a positive integer.
    const timeoutMinutesRaw = process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES;
    const timeoutMinutes = timeoutMinutesRaw ? parseInt(timeoutMinutesRaw, 10) : NaN;
    if (!Number.isNaN(timeoutMinutes) && timeoutMinutes > 0) {
        try {
            const last = new Date(session.updated_at || session.created_at || Date.now());
            const minutesSince = (Date.now() - last.getTime()) / (1000 * 60);
            const terminal =
                session.status === "verified" ||
                session.status === "failed" ||
                session.is_verified === true ||
                session.current_step === "results";
            if (!terminal && minutesSince > timeoutMinutes) {
                return res.status(410).json({
                    error: "Session expired",
                    expired: true,
                    message: "This session has been inactive for too long. Please start a new session.",
                });
            }
        } catch (e) {
            // If timestamp parsing fails, do not block the session.
            console.warn("[get_session] inactivity timeout check failed:", e?.message || e);
        }
    }

    const current_step = inferStepFromSession(session);
    const expected = clampInt(session.expected_guest_count, 1, 10);
    const verified = clampInt(session.verified_guest_count, 0, 10);

    const requires =
        session.requires_additional_guest === true
            ? true
            : session.requires_additional_guest === false
                ? false
                : verified < expected;

    return res.json({
        success: true,
        session: {
            ...session,
            current_step,
            expected_guest_count: expected,
            verified_guest_count: verified,
            requires_additional_guest: requires,
            remaining_guest_verifications: Math.max(expected - verified, 0),
            // Helpful for multi-guest loops: "who is next?"
            // (does not require a DB column)
            guest_index: Math.min(verified + 1, expected),
        },
    });
}

export async function handleLogConsent(req, res) {
    const { session_token, consent_given, consent_time, consent_locale } = req.body || {};
    if (!session_token) return res.status(400).json({ error: "Session token required" });

    const { data: existing, error: findError } = await supabase
        .from("demo_sessions")
        .select("session_token")
        .eq("session_token", session_token)
        .single();

    if (findError || !existing) return res.status(404).json({ error: "Session not found" });

    const { error: updateError } = await supabase
        .from("demo_sessions")
        .update({
            consent_given: Boolean(consent_given),
            consent_time: consent_time || new Date().toISOString(),
            consent_locale: consent_locale || "en",
            status: "consent_logged",
            current_step: "welcome",
            updated_at: new Date().toISOString(),
        })
        .eq("session_token", session_token);

    if (updateError) {
        console.error("Error updating consent:", updateError);
        return res.status(500).json({ error: "Failed to log consent" });
    }

    return res.json({ success: true, message: "Consent logged successfully" });
}
