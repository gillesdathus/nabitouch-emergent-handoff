import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function OfflineNotice() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  if (online) return null;
  return (
    <div className="sticky top-0 z-[70] flex items-center justify-center gap-2 bg-amber-100 py-1.5 text-xs text-amber-800" data-testid="offline-banner" role="status">
      <WifiOff className="h-3.5 w-3.5" /> You’re offline. Browsing the saved app shell — bookings and notes need a connection.
    </div>
  );
}
