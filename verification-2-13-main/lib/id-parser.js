import { normalizeKey } from "./utils";

// Minimum confidence threshold (0-100)
const MIN_CONFIDENCE = 50; // Only accept fields with at least 50% confidence

// Helper to parse dates from various formats
function parseDate(dateStr) {
    if (!dateStr) return null;
    
    // Try common formats: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYMMDD
    const clean = String(dateStr).trim();
    
    // YYMMDD format (from MRZ)
    if (/^\d{6}$/.test(clean)) {
        const yy = parseInt(clean.slice(0, 2));
        const mm = parseInt(clean.slice(2, 4));
        const dd = parseInt(clean.slice(4, 6));
        const year = yy < 50 ? 2000 + yy : 1900 + yy;
        return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
    
    // Try to parse as ISO date
    const date = new Date(clean);
    if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
    }
    
    return clean; // Return as-is if can't parse
}

export function parseMrzTD3(mrz) {
    try {
        const clean = String(mrz || "")
            .replace(/\r/g, "\n")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .join("")
            .replace(/\s+/g, "")
            .toUpperCase();

        const lines =
            clean.includes("\n")
                ? clean.split("\n").filter(Boolean)
                : clean.length >= 88
                    ? [clean.slice(0, 44), clean.slice(44, 88)]
                    : clean.length >= 44
                        ? [clean.slice(0, 44), clean.slice(44, 88)]
                        : [];

        if (lines.length < 2) return null;

        const l2 = String(lines[1] || "").padEnd(44, "<");

        const passportNumberRaw = l2.slice(0, 9);
        const passport_number = passportNumberRaw.replace(/</g, "").trim() || null;

        const nationality = l2.slice(10, 13).replace(/</g, "").trim() || null;

        const dob_yymmdd_raw = l2.slice(13, 19);
        const dob_yymmdd = dob_yymmdd_raw.replace(/</g, "").trim() || null;

        const sexRaw = l2.slice(20, 21);
        const sex = sexRaw.replace(/</g, "").trim() || null;

        const exp_yymmdd_raw = l2.slice(21, 27);
        const exp_yymmdd = exp_yymmdd_raw.replace(/</g, "").trim() || null;

        return {
            passport_number,
            nationality,
            sex,
            dob_yymmdd,
            exp_yymmdd,
            line1: lines[0] || null,
            line2: lines[1] || null,
        };
    } catch {
        return null;
    }
}

export function parseAnalyzeIdFields(fields = []) {
    const raw = {};
    const confidenceScores = {};
    
    for (const f of fields) {
        const key = normalizeKey(f?.Type?.Text);
        const valueDetection = f?.ValueDetection;
        const confidence = valueDetection?.Confidence || 0;
        const text = valueDetection?.Text;
        const normalizedValue = valueDetection?.NormalizedValue;
        
        // Only include fields above confidence threshold
        if (key && text && confidence >= MIN_CONFIDENCE) {
            // Prefer normalized value if available (Textract's cleaned version)
            raw[key] = normalizedValue?.Value?.Formatted || text;
            confidenceScores[key] = confidence;
        } else if (key && text) {
            console.warn(`[id-parser] Skipping low-confidence field: ${key} = "${text}" (confidence: ${confidence.toFixed(1)}%)`);
        }
    }
    
    // Enhanced field name matching with more variations
    let first_name = 
        raw.first_name || 
        raw.firstname || 
        raw.given_name || 
        raw.givenname || 
        raw.first ||
        raw.fname ||
        null;
        
    let middle_name = 
        raw.middle_name || 
        raw.middlename || 
        raw.second_name || 
        raw.secondname ||
        raw.middle ||
        raw.mname ||
        null;
        
    let last_name = 
        raw.last_name || 
        raw.lastname || 
        raw.surname || 
        raw.family_name || 
        raw.familyname ||
        raw.last ||
        raw.lname ||
        null;

    // Try to split full_name if individual parts are missing
    let full_name = raw.full_name || raw.name || null;
    if (full_name && (!first_name || !last_name)) {
        const nameParts = full_name.trim().split(/\s+/);
        if (nameParts.length >= 2 && !first_name && !last_name) {
            // Assume first part is first name, last part is last name
            if (!first_name) first_name = nameParts[0];
            if (!last_name) last_name = nameParts[nameParts.length - 1];
            if (nameParts.length > 2 && !middle_name) {
                middle_name = nameParts.slice(1, -1).join(' ');
            }
        }
    } else {
        full_name = [first_name, middle_name, last_name].filter(Boolean).join(" ") || full_name || null;
    }

    // Parse dates with better handling
    const dob = parseDate(raw.date_of_birth || raw.dob || raw.birth_date || raw.dateofbirth);
    const date_of_issue = parseDate(raw.date_of_issue || raw.issue_date || raw.issued_date || raw.date_of_issuance);
    const expiration_date = parseDate(raw.expiration_date || raw.expiry_date || raw.expiry || raw.expiration || raw.valid_until);

    const document_number =
        raw.document_number ||
        raw.passport_number ||
        raw.id_number ||
        raw.identity_document_number ||
        raw.personal_number ||
        raw.passport_no ||
        raw.document_no ||
        null;

    const id_type = raw.id_type || raw.document_type || raw.type || null;
    const mrz_code = raw.mrz_code || raw.mrz || raw.machine_readable_zone || null;

    const sex = raw.sex || raw.gender || raw.sex_code || null;
    let nationality = raw.nationality || raw.country || raw.country_code || raw.nationality_code || null;

    const mrz_parsed = mrz_code ? parseMrzTD3(mrz_code) : null;

    // Use MRZ data as fallback if direct fields are missing
    if (!nationality && mrz_parsed?.nationality) nationality = mrz_parsed.nationality;
    const sexFinal = sex || mrz_parsed?.sex || null;

    const documentNumberFinal = document_number || mrz_parsed?.passport_number || null;
    const dobFinal = dob || mrz_parsed?.dob_yymmdd || null;
    const expirationFinal = expiration_date || mrz_parsed?.exp_yymmdd || null;

    return {
        text: null,
        id_type,
        document_number: documentNumberFinal,
        last_name,
        first_name,
        middle_name,
        date_of_birth: dobFinal,
        date_of_issue,
        expiration_date: expirationFinal,
        nationality,
        sex: sexFinal,
        mrz_code,
        mrz_parsed,
        full_name,
        raw,
        confidence_scores: confidenceScores, // Include confidence scores for debugging
    };
}
