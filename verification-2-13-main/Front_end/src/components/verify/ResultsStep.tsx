// ResultsStep.tsx – shows door code + room on success screen
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Home, RotateCcw } from "lucide-react";
import { VerificationData } from "@/pages/Verify";
import confetti from "canvas-confetti";
import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import WifiQRCode from "@/components/WifiQRCode";
import siteLogoSrc from "@/assets/site-logo.png";

type Props = {
  data: VerificationData;
  onRetry: () => void;
  onHome: () => void;
};

const COUNTDOWN_SECONDS = 45;

const ResultsStep = ({ data, onRetry, onHome }: Props) => {
  const isSuccess = Boolean(data.isVerified);
  const { t, i18n } = useTranslation();
  const { toast } = useToast();

  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [email, setEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [alreadySent, setAlreadySent] = useState(false);
  const [sentToEmail, setSentToEmail] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (isSuccess) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      });
    }
  }, [isSuccess]);

  useEffect(() => {
    if (!isSuccess) return;

    if (secondsLeft <= 0) {
      onHome();
      return;
    }

    const interval = setInterval(() => {
      setSecondsLeft((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isSuccess, secondsLeft, onHome]);

  // ---- FIX: accept any possible key name coming back from backend/session ----
  const anyData = data as any;

  const resolvedPhysicalRoom =
    data.physicalRoom || anyData.physical_room || anyData.roomName || anyData.room_name || null;

  const resolvedRoomAccessCode =
    data.roomAccessCode ||
    anyData.room_access_code ||
    anyData.roomAccessCode ||
    anyData.accessCode ||
    anyData.access_code ||
    anyData.doorCode ||
    anyData.door_code ||
    anyData.passcode ||
    anyData.room_key_passcode ||
    anyData.roomKeyPasscode ||
    null;

  // If they typed OTA numeric ID, keep showing the booking ref (roomNumber)
  const displayedReservationRef =
    data.roomNumber || anyData.booking_ref || anyData.bookingRef || anyData.room_number || "";

  const sessionToken = data.sessionToken;
  const wifiSsid = (data as any).wifiSsid || (anyData as any).wifi_ssid || null;
  const wifiPassword = (data as any).wifiPassword ?? (anyData as any).wifi_password ?? null;
  const wifiSecurity = (data as any).wifiSecurity || (anyData as any).wifi_security || null;

  const handleSendDetails = async (event: FormEvent) => {
    event.preventDefault();
    if (alreadySent || isSending) return;

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setFormError("Please enter an email address.");
      return;
    }

    // Basic client-side email validation; server does full validation.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFormError("Please enter a valid email address.");
      return;
    }

    if (!sessionToken) {
      setFormError("Session information is missing. Please start a new verification.");
      toast({
        title: "Session expired",
        description: "Please restart the verification process.",
        variant: "destructive",
      });
      return;
    }

    setFormError(null);
    setIsSending(true);

    try {
      const res = await api.sendCheckinEmail({
        action: "send_checkin_email",
        session_token: sessionToken,
        email: trimmedEmail,
        channel: "email",
        locale: i18n.language,
      });

      if (!res.success && res.error) {
        setFormError(res.error);
        toast({
          title: "Could not send details",
          description: res.error,
          variant: "destructive",
        });
        return;
      }

      if (res.already_sent) {
        setAlreadySent(true);
        setSentToEmail(res.sent_to_email || trimmedEmail);
        setSentToPhone(res.sent_to_phone || null);
        toast({
          title: "Details already sent",
          description: res.sent_to_email
            ? `Check the inbox for ${res.sent_to_email}.`
            : "Check-in details were already sent for this session.",
        });
        return;
      }

      setAlreadySent(true);
      setSentToEmail(res.sent_to_email || trimmedEmail);

      toast({
        title: "Details sent",
        description: "We sent your check-in details to your email.",
      });
    } catch (error: any) {
      const message = error?.message || "Failed to send check-in details.";
      setFormError(message);
      toast({
        title: "Could not send details",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  if (isSuccess) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="glass rounded-3xl p-8 md:p-12 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
        >
          <CheckCircle2 className="w-24 h-24 text-green-400 mx-auto mb-6" />
        </motion.div>

        <h2 className="text-4xl md:text-5xl font-thin text-white mb-4">{t("results.successTitle")}</h2>

        <p className="text-sm text-white/80 mb-4">
          {t("results.redirectCountdown", {
            defaultValue: "Returning to the start page in {{seconds}}s…",
            seconds: secondsLeft,
          })}
        </p>

        <div className="bg-white rounded-xl p-6 mb-6 shadow-lg">
          <p className="text-gray-800 text-lg mb-1">
            <strong>{t("results.guestName")}:</strong> {data.guestName}
          </p>

          <p className="text-gray-800 text-lg mb-1">
            <strong>{t("results.roomNumber")}:</strong> {displayedReservationRef}
          </p>

          <p className="text-gray-800 text-lg">
            <strong>{t("results.physicalRoom")}:</strong> {resolvedPhysicalRoom || t("results.pendingAssignment")}
          </p>
        </div>

        {resolvedRoomAccessCode && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="bg-white rounded-2xl p-8 mb-8 shadow-lg border-2 border-green-500/20"
          >
            <p className="text-gray-500 text-sm mb-2 uppercase tracking-wide font-bold">
              {t("visitor.accessCode", { defaultValue: "Door Access Code" })}
            </p>

            <p className="text-5xl md:text-6xl font-bold text-gray-900 tracking-widest select-all">
              {resolvedRoomAccessCode}
            </p>

            <p className="text-green-600 text-xs mt-3 font-semibold flex items-center justify-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {t("visitor.showAtDoor", { defaultValue: "Valid for entry to the property" })}
            </p>
          </motion.div>
        )}

        {wifiSsid && wifiSecurity ? (
          <div className="mb-8">
            <WifiQRCode
              ssid={wifiSsid}
              password={wifiPassword}
              security={wifiSecurity}
              logoSrc={siteLogoSrc}
            />
          </div>
        ) : null}

        {isSuccess && (
          <div className="bg-white rounded-xl p-6 mb-8 shadow-lg text-left">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {t("results.sendDetailsTitle", {
                defaultValue: "Send your check-in details",
              })}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {t("results.sendDetailsDescription", {
                defaultValue:
                  "Receive your reservation reference, room details, and door access code by email.",
              })}
            </p>

            <form onSubmit={handleSendDetails} className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-800">
                  {t("results.emailLabel", { defaultValue: "Email address" })}
                </label>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  disabled={alreadySent || isSending}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="guest@example.com"
                />
              </div>

              {formError && (
                <p className="text-sm text-red-600" role="alert">
                  {formError}
                </p>
              )}

              {alreadySent && (
                <p className="text-sm text-green-700">
                  {t("results.detailsSentSummary", {
                    defaultValue: "Details sent to {{email}}.",
                    email: sentToEmail || "",
                  })}
                </p>
              )}

              <Button
                type="submit"
                disabled={alreadySent || isSending}
                className="w-full h-11 text-base font-semibold bg-green-500 hover:bg-green-600 text-white"
              >
                {alreadySent
                  ? t("results.detailsAlreadySentButton", {
                      defaultValue: "Details sent",
                    })
                  : isSending
                    ? t("results.sendingDetailsButton", {
                        defaultValue: "Sending…",
                      })
                    : t("results.sendDetailsButton", {
                        defaultValue: "Send details",
                      })}
              </Button>
            </form>
          </div>
        )}

        <div className="glass rounded-xl p-4 mb-8">
          <p className="text-xs text-white/70 text-center leading-relaxed">{t("results.deletionNote")}</p>
        </div>

        <p className="text-2xl text-white font-bold mb-6">{t("results.checkInComplete")}</p>

        <Button onClick={onHome} variant="glass" className="w-full h-14 text-lg font-bold">
          <Home className="w-5 h-5 mr-2" />
          {t("results.backToHome")}
        </Button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className="glass rounded-3xl p-8 md:p-12 text-center"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
      >
        <XCircle className="w-24 h-24 text-red-400 mx-auto mb-6" />
      </motion.div>

      <h2 className="text-4xl md:text-5xl font-thin text-white mb-4">{t("results.failureTitle")}</h2>

      <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-6 mb-6">
        <p className="text-white text-lg mb-2">{t("results.whyFailed")}</p>
        <p className="text-white/80 text-left mt-2">{t("results.failureReasons")}</p>
      </div>

      <div className="glass rounded-xl p-4 mb-8">
        <p className="text-xs text-white/70 text-center leading-relaxed">{t("results.deletionNote")}</p>
      </div>

      <div className="flex gap-4">
        <Button onClick={onRetry} variant="glass" className="flex-1 h-14 text-lg font-bold">
          <RotateCcw className="w-5 h-5 mr-2" />
          {t("results.tryAgain")}
        </Button>
        <Button onClick={onHome} variant="glass" className="flex-1 h-14 text-lg font-bold">
          <Home className="w-5 h-5 mr-2" />
          {t("results.home")}
        </Button>
      </div>
    </motion.div>
  );
};

export default ResultsStep;
