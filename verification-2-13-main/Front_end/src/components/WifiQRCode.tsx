import { QRCode } from "react-qrcode-logo";
import { useEffect, useState } from "react";
import { buildWifiQrPayload, WifiSecurity } from "@/lib/wifiQr";

type Props = {
  ssid: string;
  password?: string | null;
  security: WifiSecurity | string;
  logoSrc?: string;
  /** Opacity of the background image (0–1). Lower = more scannable. Default 0.25 */
  backgroundImageOpacity?: number;
};

const QR_SIZE = 220;
const OPSICIAN_QR_COLOR = "#000000";

export default function WifiQRCode({
  ssid,
  password,
  security,
  logoSrc,
  backgroundImageOpacity = 0.3,
}: Props) {
  const value = buildWifiQrPayload({ ssid, password, security });

  if (!value) return null;

  const isNoPass = (security || "").toString().trim() === "nopass";
  const cleanPassword = (password || "").toString().trim();

  // Convert logo to grayscale data-URL for use as background behind QR.
  const [bgDataUrl, setBgDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!logoSrc) {
      setBgDataUrl(null);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.filter = "grayscale(1)";
          ctx.drawImage(img, 0, 0);
          setBgDataUrl(canvas.toDataURL("image/png"));
        } else {
          setBgDataUrl(logoSrc);
        }
      } catch {
        setBgDataUrl(logoSrc);
      }
    };
    img.onerror = () => {
      if (!cancelled) setBgDataUrl(logoSrc);
    };
    img.src = logoSrc;

    return () => {
      cancelled = true;
    };
  }, [logoSrc]);

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg">
      <div className="flex items-center justify-center">
        {/* QR container – background image sits behind, QR on top */}
        <div
          className="relative flex items-center justify-center"
          style={{ width: QR_SIZE, height: QR_SIZE }}
        >
          {/* Background image (grayscale, semi-transparent) */}
          {bgDataUrl && (
            <img
              src={bgDataUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 m-auto pointer-events-none select-none object-contain"
              style={{ width: "100%", opacity: backgroundImageOpacity, zIndex: 1 , filter: "grayscale(1)" , borderRadius: "5%" }}
            />
          )}

          {/* QR code on top */}
          <div style={{ position: "relative", zIndex: 2 }}>
            <QRCode
              key={value}
              value={value}
              size={QR_SIZE}
              ecLevel="H"
              qrStyle="dots"
              eyeRadius={12}
              eyeColor={OPSICIAN_QR_COLOR}
              fgColor={OPSICIAN_QR_COLOR}
              bgColor="transparent"
            />
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-center text-gray-900 font-semibold">Wi‑Fi details</div>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
          <span className="text-gray-600">Wi‑Fi:</span>
          <span className="text-gray-900 select-all break-all">{ssid}</span>
          {!isNoPass && cleanPassword ? (
            <>
              <span className="text-gray-400">|</span>
              <span className="text-gray-600">Password:</span>
              <span className="text-gray-900 select-all break-all">{cleanPassword}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

