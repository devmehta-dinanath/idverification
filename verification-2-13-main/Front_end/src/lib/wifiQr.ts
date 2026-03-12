export type WifiSecurity = "WPA" | "WEP" | "nopass";

function escapeWifiField(value: string): string {
  // Common Wi‑Fi QR escaping: backslash + special separators.
  return value.replace(/([\\;,:"])/g, "\\$1");
}

export function buildWifiQrPayload(params: {
  ssid: string;
  password?: string | null;
  security: WifiSecurity | string;
}): string {
  const securityRaw = (params.security || "").toString().trim();
  const security = securityRaw.length ? securityRaw : "WPA";

  const ssid = escapeWifiField((params.ssid || "").toString());
  const password = escapeWifiField((params.password || "").toString());

  if (!ssid) {
    return "";
  }

  if (security === "nopass") {
    return `WIFI:T:nopass;S:${ssid};;`;
  }

  return `WIFI:T:${security};S:${ssid};P:${password};;`;
}

