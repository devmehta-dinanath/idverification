export function getPropertyIdFromRequest(req) {
    if (!req) return null;

    const headers = req.headers || {};
    const headerKey = Object.keys(headers).find(
        (k) => k.toLowerCase() === "x-property-id"
    );

    if (headerKey && headers[headerKey]) {
        return String(headers[headerKey]).trim() || null;
    }

    return null;
}

