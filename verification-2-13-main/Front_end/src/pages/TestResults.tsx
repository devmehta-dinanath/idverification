// DEV-ONLY: Preview the ResultsStep without going through verification
import ResultsStep from "@/components/verify/ResultsStep";
import type { VerificationData } from "@/pages/Verify";

const mockData: VerificationData = {
  guestName: "Test Guest",
  roomNumber: "301",
  isVerified: true,
  roomAccessCode: "4821",
  physicalRoom: "301",
  roomTypeName: "Deluxe Suite",
  checkIn: "2026-03-11",
  checkOut: "2026-03-14",
  wifiSsid: "Bliss",
  wifiPassword: "12345678",
  wifiSecurity: "WPA",
};

export default function TestResults() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-200 via-blue-100 to-amber-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <ResultsStep
          data={mockData}
          onRetry={() => alert("retry")}
          onHome={() => alert("home")}
        />
      </div>
    </div>
  );
}
