export function getPropertyIdFromRequest(req) {
    if (!req) return null;

    const headers = req.headers || {};
    const headerKey = Object.keys(headers).find(
        (k) => k.toLowerCase() === "x-property-id"
    );

    if (headerKey && headers[headerKey]) {
        return String(headers[headerKey]).trim() || null;
    }

    const body = req.body || {};
    if (body.property_external_id) {
        return String(body.property_external_id).trim() || null;
    }
    if (body.property_id) {
        return String(body.property_id).trim() || null;
    }

    return null;
}

