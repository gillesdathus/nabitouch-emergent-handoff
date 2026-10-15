import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Conversation } from "@/components/Conversation";
import { EmptyState } from "@/components/tide";
import { useDemo } from "@/store/DemoStore";
import { fmtDate, fmtTime } from "@/lib/domain";

export default function Thread({ viewerRole, backTo }) {
  const { id } = useParams();
  const { state, idx } = useDemo();
  const appt = state.appointments.find((row) => row.id === id);
  if (!appt) return <div className="mx-auto max-w-xl px-5 py-8"><EmptyState title="This visit is not available" body="It is not on this account, or it has not loaded yet." /></div>;
  const client = idx.clients[appt.clientId];
  const practitioner = idx.practitioners[appt.practitionerId];
  const counterpart = viewerRole === "client" ? (practitioner?.name || "Practitioner being assigned") : (client?.preferredName || client?.firstName || "Client");
  return (
    <div className="mx-auto max-w-xl space-y-4 px-5 py-5">
      <Link to={backTo || (viewerRole === "client" ? "/me" : `/pro/visit/${appt.id}`)} className="inline-flex items-center gap-1 text-sm text-nb-mute"><ArrowLeft className="h-4 w-4" />Back</Link>
      <Conversation appointmentId={appt.id} viewerRole={viewerRole} title={`${fmtDate(appt.date)} · ${fmtTime(appt.time)}`} counterpart={counterpart} />
    </div>
  );
}
