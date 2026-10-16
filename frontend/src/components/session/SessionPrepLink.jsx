import { Link } from "react-router-dom";
import { ClipboardCheck, ChevronRight, ShieldCheck } from "lucide-react";
import { useSessionReadiness } from "@/components/session/SessionReadiness";

const OPEN_FOR_PREP = ["requested", "confirmed", "assigned", "preparing", "en_route", "arrived", "interrupted"];

export function SessionPrepLink({ appt }) {
  const enabled = OPEN_FOR_PREP.includes(appt.status);
  const { data } = useSessionReadiness(appt.id, { enabled, poll: 0 });
  if (!enabled || !data) return null;
  const steps = [data.intake.state === "confirmed", data.consent.state === "signed"];
  const done = steps.filter(Boolean).length;
  return (
    <Link to={`/me/visit/${appt.id}/prepare`} data-testid="session-prep-link" className={`mt-4 flex items-center gap-3 rounded-2xl p-3 ring-1 transition-transform hover:-translate-y-0.5 ${data.ready ? "bg-teal-50 ring-teal-200" : "bg-amber-50 ring-amber-200"}`}>
      <span className={`grid h-10 w-10 place-items-center rounded-xl ${data.ready ? "bg-white text-teal-600" : "bg-white text-amber-600"}`}>{data.ready ? <ShieldCheck className="h-5 w-5" /> : <ClipboardCheck className="h-5 w-5" />}</span>
      <span className="flex-1">
        <span className="block text-sm font-semibold" data-testid="session-prep-status">{data.ready ? "Health check & consent complete" : "Health check & consent needed"}</span>
        <span className="block text-xs text-nb-mute">{data.ready ? "Your therapist can start on time." : `${done} of 2 done. Treatment starts only after both.`}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-nb-mute" />
    </Link>
  );
}
