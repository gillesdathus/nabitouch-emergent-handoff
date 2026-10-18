import { useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, X } from "lucide-react";
import { practitionerStatus } from "@/lib/practitionerStatus";
import { usePractitionerData } from "@/pages/staff/PractitionerProfile";

const KEY = "nb-profile-reminder";

export function ProfileReminder({ person }) {
  const { credentials, schedule } = usePractitionerData(person.id, false);
  const s = practitionerStatus({ person, credentials, schedule });
  const stamp = `${person.id}:${s.day}`;
  const [hidden, setHidden] = useState(() => localStorage.getItem(KEY) === stamp);
  if (s.complete || (!s.reminderToday && !s.overdue) || (hidden && !s.overdue)) return null;
  const missing = s.items.filter((i) => !i.done).map((i) => i.label.toLowerCase());
  return (
    <div role="status" className={`flex items-start gap-3 rounded-2xl p-4 text-sm ring-1 ${s.overdue ? "bg-rose-50 text-rose-900 ring-rose-200" : "bg-amber-50 text-amber-950 ring-amber-200"}`} data-testid="pro-profile-reminder">
      <BellRing className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{s.overdue ? "Your 30-day profile window has ended" : `Complete your profile — ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left`}</p>
        <p className="mt-0.5 text-xs">{s.overdue ? "The owner has been notified and may pause new bookings until it is complete. " : "Profiles not completed within 30 days may stop being offered for booking. "}Still needed: {missing.join(", ")}.</p>
        <Link to="/pro/profile" className="mt-2 inline-block text-xs font-semibold underline" data-testid="pro-profile-reminder-link">Complete my profile</Link>
      </div>
      {!s.overdue && <button type="button" aria-label="Dismiss for today" onClick={() => { localStorage.setItem(KEY, stamp); setHidden(true); }} className="shrink-0 rounded-full p-1 hover:bg-black/5" data-testid="pro-profile-reminder-dismiss"><X className="h-4 w-4" /></button>}
    </div>
  );
}
