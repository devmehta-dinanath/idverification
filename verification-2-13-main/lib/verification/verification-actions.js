import { supabase } from "../supabase";
import { s3, rekognition, runTextractAnalyzeIdWithTimeout, BUCKET } from "../aws";
import { normalizeBase64, clampInt, streamToBuffer } from "../utils";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { CompareFacesCommand, DetectFacesCommand } from "@aws-sdk/client-rekognition";
import { getAccessCode } from "../access-codes";
import { getGuests, putGuestDocument, addReservationNote, lookupGuestReservation } from "../cloudbeds";
import { appendGuestRow } from "../google-sheets";
import { getPropertyIdFromRequest } from "./request-utils";

// ── Dev Mode: bypass AWS when credentials are missing ────────────────────────
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_AVAILABLE = Boolean(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY);

if (!AWS_AVAILABLE) {
    console.warn("⚠️  [DEV MODE] AWS credentials not found — Rekognition/Textract/S3 will be bypassed with mock data.");
    console.warn("   AWS_ACCESS_KEY_ID:", AWS_ACCESS_KEY_ID ? `✅ Set (${AWS_ACCESS_KEY_ID.substring(0, 8)}...)` : "❌ Missing");
    console.warn("   AWS_SECRET_ACCESS_KEY:", AWS_SECRET_ACCESS_KEY ? "✅ Set" : "❌ Missing");
} else {
    console.log("✅ AWS credentials loaded — Textract/Rekognition/S3 enabled");
    console.log("   S3_REGION:", process.env.S3_REGION || process.env.AWS_REGION || "ap-southeast-7 (default)");
    console.log("   REKOGNITION_REGION:", process.env.REKOGNITION_REGION || "ap-southeast-1 (default)");
    console.log("   TEXTRACT_REGION:", process.env.TEXTRACT_REGION || "ap-southeast-1 (default)");
    console.log("   S3_BUCKET_NAME:", process.env.S3_BUCKET_NAME || "⚠️  Not set");
}

export async function handleValidateDocument(req, res) {
    const { image_data, session_token } = req.body || {};
    if (!image_data) return res.status(400).json({ error: "image_data required" });

    const base64Data = normalizeBase64(image_data);
    if (!base64Data) return res.status(400).json({ error: "Invalid image_data format" });

    const imageBuffer = Buffer.from(base64Data, "base64");
    if (imageBuffer.length < 1000) {
        return res.json({
            success: true,
            document_valid: false,
            has_face: false,
            is_readable: false,
            failure_reason: "image_too_small",
        });
    }

    // ── DEV MODE: bypass AWS ─────────────────────────────────────────────────
    if (!AWS_AVAILABLE) {
        console.log("[DEV MODE] validate_document → bypassing AWS, returning mock valid");
        return res.json({
            success: true,
            document_valid: true,
            has_face: true,
            is_readable: true,
            failure_reason: null,
            face_quality: { brightness: 80, sharpness: 90, confidence: 99 },
            _dev_mode: true,
        });
    }

    const textractResult = await runTextractAnalyzeIdWithTimeout(imageBuffer, 15000);

    let hasFace = false;
    let faceQuality = null;
    try {
        const detectResult = await rekognition.send(
            new DetectFacesCommand({
                Image: { Bytes: imageBuffer },
                Attributes: ["ALL"],
            })
        );
        const faces = detectResult.FaceDetails || [];
        hasFace = faces.length > 0;
        if (faces.length > 0) {
            faceQuality = {
                brightness: faces[0]?.Quality?.Brightness || 0,
                sharpness: faces[0]?.Quality?.Sharpness || 0,
                confidence: faces[0]?.Confidence || 0,
            };
        }
    } catch (e) {
        console.warn("DetectFaces failed during document validation:", e?.message);
        hasFace = false;
    }

    let isReadable = false;
    if (textractResult.ok && textractResult.data) {
        const d = textractResult.data;
        const hasName = Boolean(d.full_name || d.first_name || d.last_name);
        const hasDocNumber = Boolean(d.document_number);
        const hasDob = Boolean(d.date_of_birth);
        isReadable = hasName || hasDocNumber || hasDob;
    }

    let isVisitorFlow = false;
    if (session_token) {
        try {
            const { data: sess } = await supabase
                .from("demo_sessions")
                .select("extracted_info, room_number")
                .eq("session_token", session_token)
                .single();
            isVisitorFlow = sess?.extracted_info?.type === "visitor" || sess?.room_number === "VISITOR";
        } catch (e) {
            console.warn("[validate_document] Could not fetch session for flow detection:", e.message);
        }
    }

    let documentValid = hasFace && (isReadable || isVisitorFlow);
    let failureReason = null;

    if (!hasFace && !isReadable) {
        failureReason = "not_an_id";
    } else if (!hasFace) {
        failureReason = "no_face_detected";
    } else if (!isReadable) {
        failureReason = "not_readable";
    }

    if (hasFace && faceQuality && faceQuality.sharpness < 10) {
        documentValid = false;
        failureReason = "too_blurry";
    }

    return res.json({
        success: true,
        document_valid: documentValid,
        has_face: hasFace,
        is_readable: isReadable,
        failure_reason: failureReason,
        face_quality: faceQuality,
    });
}

export async function handleValidateSelfie(req, res) {
    const { image_data } = req.body || {};
    if (!image_data) return res.status(400).json({ error: "image_data required" });

    const base64Data = normalizeBase64(image_data);
    if (!base64Data) return res.status(400).json({ error: "Invalid image_data format" });

    const imageBuffer = Buffer.from(base64Data, "base64");
    if (imageBuffer.length < 1000) {
        return res.json({
            success: true,
            selfie_valid: false,
            failure_reason: "image_too_small",
        });
    }

    // ── DEV MODE: bypass AWS ─────────────────────────────────────────────────
    if (!AWS_AVAILABLE) {
        console.log("[DEV MODE] validate_selfie → bypassing AWS, returning mock valid");
        return res.json({
            success: true,
            selfie_valid: true,
            failure_reason: null,
            face_details: { brightness: 80, sharpness: 90, eyesOpen: true, confidence: 99 },
            _dev_mode: true,
        });
    }

    let selfieValid = false;
    let failureReason = null;
    let faceDetails = null;

    try {
        const detectResult = await rekognition.send(
            new DetectFacesCommand({
                Image: { Bytes: imageBuffer },
                Attributes: ["ALL"],
            })
        );

        const faces = detectResult.FaceDetails || [];

        if (faces.length === 0) {
            failureReason = "no_face_detected";
        } else if (faces.length > 1) {
            failureReason = "multiple_faces";
        } else {
            const face = faces[0];
            const brightness = face?.Quality?.Brightness || 0;
            const sharpness = face?.Quality?.Sharpness || 0;
            const eyesOpen = face?.EyesOpen?.Value;
            const confidence = face?.Confidence || 0;

            faceDetails = { brightness, sharpness, eyesOpen, confidence };

            if (brightness < 30) {
                failureReason = "too_dark";
            } else if (sharpness < 10) {
                failureReason = "too_blurry";
            } else if (eyesOpen === false) {
                failureReason = "eyes_closed";
            } else if (confidence < 80) {
                failureReason = "low_confidence";
            } else {
                selfieValid = true;
            }
        }
    } catch (e) {
        console.error("DetectFaces failed during selfie validation:", e?.message);
        failureReason = "detection_error";
    }

    return res.json({
        success: true,
        selfie_valid: selfieValid,
        failure_reason: failureReason,
        face_details: faceDetails,
    });
}

export async function handleUploadDocument(req, res) {
    const { session_token, image_data } = req.body || {};

    if (!session_token) return res.status(400).json({ error: "Session token required" });
    if (!image_data) return res.status(400).json({ error: "image_data required" });

    const { data: sess, error: sessErr } = await supabase
        .from("demo_sessions")
        .select("guest_name, room_number, expected_guest_count, verified_guest_count, extracted_info, current_step, document_url, visitor_access_code, visitor_access_granted_at, visitor_access_expires_at")
        .eq("session_token", session_token)
        .single();

    if (sessErr || !sess) {
        console.error("[upload_document] Session lookup failed:", sessErr?.message || "not found");
        return res.status(404).json({ error: "Session not found" });
    }

    // Fetch Cloudbeds IDs separately (columns may not exist in older DB schemas)
    let cloudbeds_reservation_id = null;
    let cloudbeds_property_id = null;
    try {
        const { data: cbData } = await supabase
            .from("demo_sessions")
            .select("cloudbeds_reservation_id, cloudbeds_property_id")
            .eq("session_token", session_token)
            .single();
        cloudbeds_reservation_id = cbData?.cloudbeds_reservation_id;
        cloudbeds_property_id = cbData?.cloudbeds_property_id;
    } catch (_) { /* columns may not exist yet */ }
    if (!sess.guest_name || !sess.room_number) {
        return res.status(403).json({ error: "Complete Step 1 first." });
    }

    const expected = clampInt(sess.expected_guest_count, 1, 10);
    const verifiedBefore = clampInt(sess.verified_guest_count, 0, 10);
    const guestIndex = clampInt(verifiedBefore + 1, 1, expected);

    // ── Idempotency / duplicate submission guard ─────────────────────────────
    // NOTE: document_url is stored at session-level (overwritten per guest in current design),
    // so we use extracted_info.guest_index + current_step to determine if THIS guest's doc
    // was already uploaded.
    const lastDocGuestIndex = clampInt(sess?.extracted_info?.guest_index, 0, 10);
    const alreadyAtSelfieForThisGuest =
        sess.current_step === "selfie" &&
        Boolean(sess.document_url) &&
        lastDocGuestIndex === guestIndex;
    const alreadyDone =
        sess.current_step === "results" ||
        sess.status === "verified" ||
        sess.is_verified === true;
    if (alreadyAtSelfieForThisGuest || alreadyDone) {
        return res.json({
            success: true,
            guest_index: guestIndex,
            already_uploaded: true,
            visitor_access_code: sess.visitor_access_code || null,
            visitor_access_granted_at: sess.visitor_access_granted_at || null,
            visitor_access_expires_at: sess.visitor_access_expires_at || null,
        });
    }

    const base64Data = normalizeBase64(image_data);
    const imageBuffer = Buffer.from(base64Data, "base64");
    const s3Key = `demo/${session_token}/document_${guestIndex}.jpg`;

    // ── S3 upload (skip in dev mode) ─────────────────────────────────────────
    if (AWS_AVAILABLE) {
        console.log(`[upload_document] Uploading document to S3: ${s3Key} (${(imageBuffer.length / 1024).toFixed(2)}KB)`);
        try {
            await s3.send(
                new PutObjectCommand({
                    Bucket: BUCKET,
                    Key: s3Key,
                    Body: imageBuffer,
                    ContentType: "image/jpeg",
                })
            );
            console.log(`[upload_document] ✅ Document uploaded to S3 successfully`);
        } catch (s3Err) {
            console.error(`[upload_document] ❌ S3 upload failed:`, s3Err?.message || s3Err);
        }
    } else {
        console.log(`[DEV MODE] upload_document → skipping S3 upload for ${s3Key}`);
    }

    // ── Push document to Cloudbeds (best-effort) ────────────────────────────
    if (cloudbeds_reservation_id && cloudbeds_property_id) {
        try {
            const guests = await getGuests(cloudbeds_reservation_id, cloudbeds_property_id);
            const guestId = guests[guestIndex - 1]?.guestID || guests[0]?.guestID || null;
            await putGuestDocument(
                cloudbeds_property_id,
                cloudbeds_reservation_id,
                guestId,
                base64Data,
                "passport"
            );
            console.log(`[upload_document] Pushed ID document to Cloudbeds reservation ${cloudbeds_reservation_id} (guest ${guestIndex})`);
        } catch (cbErr) {
            console.warn("[upload_document] Cloudbeds document push failed (non-fatal):", cbErr.message);
        }
    }

    const documentUrl = AWS_AVAILABLE ? `s3://${BUCKET}/${s3Key}` : `dev://local/${s3Key}`;

    // Only advance to selfie if we're currently at document step.
    // If a duplicate request arrives after we already advanced, don't regress flow.
    const { data: updatedRows, error: updErr } = await supabase
        .from("demo_sessions")
        .update({
            status: "document_uploaded",
            current_step: "selfie",
            document_url: documentUrl,
            extracted_info: {
                text: `Textract pending (async) [guest ${guestIndex}]`,
                textract_ok: null,
                textract_error: null,
                textract: null,
                guest_index: guestIndex,
            },
            updated_at: new Date().toISOString(),
        })
        .eq("session_token", session_token)
        .eq("current_step", "document")
        .select("session_token");

    if (updErr) {
        console.warn("[upload_document] update failed (continuing as idempotent):", updErr.message);
    } else if (!updatedRows || updatedRows.length === 0) {
        // Someone else already advanced the step (or session is not in document step).
        // Treat as idempotent success.
        return res.json({
            success: true,
            guest_index: guestIndex,
            already_uploaded: true,
            visitor_access_code: sess.visitor_access_code || null,
            visitor_access_granted_at: sess.visitor_access_granted_at || null,
            visitor_access_expires_at: sess.visitor_access_expires_at || null,
        });
    }

    const isVisitorSession = sess.extracted_info?.type === "visitor" || sess.room_number === "VISITOR";
    let visitorCodeData = null;

    if (isVisitorSession) {
        const access_code = await getAccessCode({
            isVisitor: true,
        });
        if (access_code) {
            const now = new Date();
            const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);

            visitorCodeData = {
                visitor_access_code: access_code,
                visitor_access_granted_at: now.toISOString(),
                visitor_access_expires_at: expiresAt.toISOString(),
            };

            await supabase
                .from("demo_sessions")
                .update({
                    ...visitorCodeData,
                    status: "visitor_access_granted",
                    updated_at: new Date().toISOString()
                })
                .eq("session_token", session_token);
        }
    }

    if (AWS_AVAILABLE) {
        console.log(`[upload_document] Starting Textract OCR for guest ${guestIndex} (async, timeout: 15s)...`);
        runTextractAnalyzeIdWithTimeout(imageBuffer, 15000).then(async (result) => {
            if (result.ok) {
                console.log(`[upload_document] ✅ Textract OCR completed successfully for guest ${guestIndex}`);
                console.log(`[upload_document] Extracted fields:`, {
                    name: result.data?.full_name || `${result.data?.first_name || ""} ${result.data?.last_name || ""}`.trim(),
                    document_number: result.data?.document_number || "N/A",
                    date_of_birth: result.data?.date_of_birth || "N/A",
                    nationality: result.data?.nationality || "N/A",
                });
            } else {
                console.warn(`[upload_document] ⚠️  Textract OCR failed for guest ${guestIndex}:`, result.error);
            }

            let extractedInfoUpdate = {
                text: result.ok ? "Textract success" : "Textract failed",
                textract_ok: result.ok,
                textract_error: result.ok ? null : result.error,
                textract: result.ok ? result.data : null,
                guest_index: guestIndex,
            };

            if (isVisitorSession) {
                extractedInfoUpdate.type = "visitor";
                if (visitorCodeData?.visitor_access_code) {
                    extractedInfoUpdate.access_code = visitorCodeData.visitor_access_code;
                }
            }

            await supabase
                .from("demo_sessions")
                .update({
                    extracted_info: extractedInfoUpdate,
                    updated_at: new Date().toISOString(),
                })
                .eq("session_token", session_token);
        }).catch((err) => {
            console.error(`[upload_document] ❌ Textract OCR error for guest ${guestIndex}:`, err?.message || err);
        });
    } else {
        console.log("[DEV MODE] upload_document → skipping Textract OCR");
        const devExtractedInfo = { text: "DEV MODE — Textract skipped", textract_ok: true, textract: { full_name: "Dev Test" }, guest_index: guestIndex };
        if (isVisitorSession) { devExtractedInfo.type = "visitor"; }
        await supabase.from("demo_sessions").update({ extracted_info: devExtractedInfo, updated_at: new Date().toISOString() }).eq("session_token", session_token);
    }

    return res.json({
        success: true,
        guest_index: guestIndex,
        already_uploaded: false,
        visitor_access_code: visitorCodeData?.visitor_access_code,
        visitor_access_granted_at: visitorCodeData?.visitor_access_granted_at,
        visitor_access_expires_at: visitorCodeData?.visitor_access_expires_at,
    });
}

export async function handleVerifyFace(req, res) {
    const { session_token, selfie_data } = req.body || {};

    if (!session_token) return res.status(400).json({ error: "Session token required" });
    if (!selfie_data) return res.status(400).json({ error: "selfie_data required" });

    const { data: session, error: sessionError } = await supabase
        .from("demo_sessions")
        .select("*")
        .eq("session_token", session_token)
        .single();

    if (sessionError || !session) return res.status(404).json({ error: "Session not found" });

    const expected = clampInt(session.expected_guest_count, 1, 10);
    const verifiedBefore = clampInt(session.verified_guest_count, 0, 10);
    const guestIndex = clampInt(verifiedBefore + 1, 1, expected);
    const docKey = `demo/${session_token}/document_${guestIndex}.jpg`;

    // ── Idempotency / duplicate submission guard ─────────────────────────────
    // If we're already beyond selfie step, don't do AWS work again.
    const terminal =
        session.current_step === "results" ||
        session.status === "verified" ||
        session.is_verified === true ||
        verifiedBefore >= expected;

    if (terminal) {
        return res.json({
            success: true,
            guest_verified: true,
            next_step: "results",
            already_verified: true,
            access_code: session.room_access_code || null,
            room_access_code: session.room_access_code || null,
        });
    }

    // If backend expects the NEXT guest's document, but we received verify_face,
    // this is very likely a duplicate/late retry from the previous guest.
    if (session.current_step === "document" && verifiedBefore > 0) {
        return res.json({
            success: true,
            guest_verified: true,
            next_step: "document",
            already_verified: true,
            access_code: session.room_access_code || null,
            room_access_code: session.room_access_code || null,
        });
    }

    let similarity, livenessScore, verificationScore, guest_verified, isLive;
    const selfieBase64 = normalizeBase64(selfie_data);
    const selfieBuffer = Buffer.from(selfieBase64, "base64");
    const selfieKey = `demo/${session_token}/selfie_${guestIndex}.jpg`;

    if (!AWS_AVAILABLE) {
        // ── DEV MODE: skip S3 + Rekognition, mock a successful verification ──
        console.log(`[DEV MODE] verify_face → bypassing AWS, auto-verifying guest ${guestIndex}`);
        similarity = 0.95;
        livenessScore = 0.98;
        isLive = true;
        verificationScore = 0.4 + 0.98 * 0.3 + 0.95 * 0.3;
        guest_verified = true;
    } else {
        let docBuffer;
        try {
            const docObj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: docKey }));
            docBuffer = await streamToBuffer(docObj.Body);
        } catch {
            return res.status(400).json({ error: "ID document not found. Upload it first." });
        }

        await s3.send(new PutObjectCommand({
            Bucket: BUCKET, Key: selfieKey, Body: selfieBuffer, ContentType: "image/jpeg",
        }));

        const livenessResult = await rekognition.send(new DetectFacesCommand({
            Image: { Bytes: selfieBuffer }, Attributes: ["ALL"],
        }));

        const face = livenessResult.FaceDetails?.[0];
        isLive = Boolean(face?.EyesOpen?.Value) && (face?.Quality?.Brightness || 0) > 40;
        livenessScore = (face?.Confidence || 0) / 100;

        const compareResult = await rekognition.send(new CompareFacesCommand({
            SourceImage: { Bytes: selfieBuffer }, TargetImage: { Bytes: docBuffer }, SimilarityThreshold: 80,
        }));

        similarity = (compareResult.FaceMatches?.[0]?.Similarity || 0) / 100;
        verificationScore = (isLive ? 0.4 : 0) + livenessScore * 0.3 + similarity * 0.3;
        guest_verified = isLive && similarity >= 0.65;
    }

    const verifiedAfter = guest_verified ? Math.min(verifiedBefore + 1, expected) : verifiedBefore;
    const requiresAdditionalGuest = verifiedAfter < expected;
    const next_step = guest_verified ? (requiresAdditionalGuest ? "document" : "results") : "selfie";

    // Optimistic locking: only apply this transition if verified_guest_count is still what we read.
    // Prevents double-increment from duplicate/concurrent submissions.
    const selfieUrl = AWS_AVAILABLE ? `s3://${BUCKET}/${selfieKey}` : `dev://local/${selfieKey}`;
    const { data: updated, error: updateErr } = await supabase
        .from("demo_sessions")
        .update({
            status: guest_verified ? (requiresAdditionalGuest ? "partial_verified" : "verified") : "failed",
            current_step: next_step,
            selfie_url: selfieUrl,
            is_verified: verifiedAfter >= expected,
            requires_additional_guest: requiresAdditionalGuest,
            verification_score: verificationScore,
            liveness_score: livenessScore,
            face_match_score: similarity,
            verified_guest_count: verifiedAfter,
            updated_at: new Date().toISOString(),
        })
        .eq("session_token", session_token)
        .eq("verified_guest_count", verifiedBefore)
        .select("session_token, verified_guest_count, current_step, requires_additional_guest, is_verified, room_access_code");

    const updateApplied = !updateErr && updated && updated.length > 0;
    if (updateErr) {
        console.warn("[verify_face] update failed (continuing):", updateErr.message);
    }

    let access_code = null;
    if (verifiedAfter >= expected) {
        // If a prior call already issued a code, reuse it.
        if (session.room_access_code) {
            access_code = session.room_access_code;
        }
        // Fetch Cloudbeds IDs from session for door lock lookup
        let cb_prop_id_for_code = null;
        let cb_res_id_for_code = null;
        try {
            const { data: cbSess } = await supabase
                .from("demo_sessions")
                .select("cloudbeds_reservation_id, cloudbeds_property_id")
                .eq("session_token", session_token)
                .single();
            cb_prop_id_for_code = cbSess?.cloudbeds_property_id;
            cb_res_id_for_code = cbSess?.cloudbeds_reservation_id;
        } catch (_) { /* columns may not exist */ }

        if (!access_code) {
            access_code = await getAccessCode({
                propertyID: cb_prop_id_for_code,
                roomNumber: session.room_number,
                reservationId: cb_res_id_for_code,
            });
            if (access_code) {
                const now = new Date();
                const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
                await supabase.from("demo_sessions").update({
                    room_access_code: access_code,
                    visitor_access_granted_at: now.toISOString(),
                    visitor_access_expires_at: expiresAt.toISOString(),
                }).eq("session_token", session_token);
            }
        }
    }

    // ── Push verification result to Cloudbeds as a reservation note (best-effort) ──
    // Only push a Cloudbeds note if we actually applied the update (avoid duplicates).
    const cb_res_id = session.cloudbeds_reservation_id;
    const cb_prop_id = session.cloudbeds_property_id;
    if (updateApplied && cb_res_id && cb_prop_id) {
        try {
            const noteText = [
                `=== ID Verification Result ===`,
                `Guest ${guestIndex}: ${session.guest_name || "Unknown"}`,
                `Status: ${guest_verified ? "✅ VERIFIED" : "❌ FAILED"}`,
                `Face Match Score: ${(similarity * 100).toFixed(1)}%`,
                `Liveness Score: ${(livenessScore * 100).toFixed(1)}%`,
                `Overall Score: ${(verificationScore * 100).toFixed(1)}%`,
                `All Guests Verified: ${verifiedAfter >= expected ? "Yes" : `${verifiedAfter}/${expected}`}`,
                `Verified At: ${new Date().toISOString()}`,
                `Session: ${session_token}`,
            ].join("\n");
            await addReservationNote(cb_res_id, cb_prop_id, noteText);
            console.log(`[verify_face] Pushed verification note to Cloudbeds reservation ${cb_res_id}`);
        } catch (cbErr) {
            console.warn("[verify_face] Cloudbeds note push failed (non-fatal):", cbErr.message);
        }
    }

    // ── Append guest row to Google Sheet when all guests are verified (best-effort) ──
    if (updateApplied && verifiedAfter >= expected) {
        try {
            // Re-fetch from Cloudbeds using reservation ID (not room_number which is now the
            // physical room "404") to get fresh guest details: nationality, phone, email, dates.
            let cbData = null;
            const cbResId = session.cloudbeds_reservation_id;
            if (cbResId) {
                try {
                    const headerPropertyId = getPropertyIdFromRequest(req);
                    const propertyIdForLookup =
                        headerPropertyId || session.cloudbeds_property_id || session.property_external_id || null;
                    cbData = await lookupGuestReservation(
                        session.guest_name,
                        cbResId,
                        propertyIdForLookup ? { propertyID: propertyIdForLookup } : undefined
                    );
                } catch (cbErr) {
                    console.warn("[verify_face] Cloudbeds re-fetch for sheet failed:", cbErr.message);
                }
            }

            const gd = cbData?.guestDetails || session.cloudbeds_guest_details || {};
            // Textract OCR results take precedence over Cloudbeds for passport/DOB/nationality
            const textract = session.extracted_info?.textract || {};
            const nameParts = (session.guest_name || "").split(/\s+/);
            const cbFirst = gd.firstName || "";
            const firstParts = cbFirst ? cbFirst.split(/\s+/) : nameParts;
            const firstName = textract.first_name || firstParts[0] || "";
            const middleName = textract.middle_name || (firstParts.length > 1 ? firstParts.slice(1).join(" ") : "");
            const lastName = textract.last_name || gd.lastName || nameParts.slice(1).join(" ") || "";

            await appendGuestRow({
                firstName,
                middleName,
                lastName,
                gender: gd.gender || textract.sex || "",
                passport: textract.document_number || gd.documentNumber || "",
                nationality: textract.nationality || gd.country || "",
                birthDate: textract.date_of_birth || gd.birthdate || "",
                startDate: cbData?.checkIn || session.cloudbeds_check_in || "",
                endDate: cbData?.checkOut || session.cloudbeds_check_out || "",
                room: cbData?.roomName || cbData?.roomNumber || session.physical_room || session.room_number || "",
                roomType: cbData?.roomTypeName || session.room_type_name || "",
                phone: gd.phone || gd.guestPhone || "",
                email: gd.email || gd.guestEmail || "",
                verifiedAt: new Date().toISOString(),
                verificationScore,
            });
        } catch (sheetErr) {
            console.warn("[verify_face] Google Sheets append failed (non-fatal):", sheetErr.message);
        }
    }

    // If we lost the optimistic lock, treat as idempotent success and let the client re-fetch session.
    if (!updateApplied && guest_verified) {
        return res.json({
            success: true,
            guest_verified: true,
            next_step: session.requires_additional_guest ? "document" : "results",
            already_verified: true,
            access_code: session.room_access_code || access_code,
            room_access_code: session.room_access_code || access_code,
        });
    }

    return res.json({ success: true, guest_verified, next_step, access_code, room_access_code: access_code, is_verified: verifiedAfter >= expected, requires_additional_guest: requiresAdditionalGuest });
}
