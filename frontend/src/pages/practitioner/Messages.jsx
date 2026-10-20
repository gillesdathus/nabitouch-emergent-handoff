import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, MessageCircle } from "lucide-react";
import { SectionHead, PageSkeleton, StatusPill } from "@/components/ui-kit";
import { EmptyState } from "@/components/tide";
import { Conversation } from "@/components/Conversation";
import { useDemo } from "@/store/DemoStore";
import { OPEN, fmtDate, fmtTime } from "@/lib/domain";
import { PractitionerSetupRequired, PractitionerUnauthorized, usePractitionerProfile } from "@/components/PractitionerRouteGuard";

export default function ProMessages() {
  const { api, idx, state } = useDemo();
  const { loading, capable, me, practitionerId, error } = usePractitionerProfile();
  const [aid, setAid] = useState("");
  const [unread, setUnread] = useState(0);

  const visits = useMemo(() => {
    return (state.appointments || [])
      .filter((row) => row.practitionerId === practitionerId && OPEN.includes(row.status))
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }, [state.appointments, practitionerId]);

  useEffect(() => {
    if (!visits.length) {
      setAid("");
      return;
    }
    if (!aid || !visits.some((row) => row.id === aid)) setAid(visits[0].id);
  }, [visits, aid]);

  useEffect(() => {
    let stop = false;
    api.inbox?.().then((body) => { if (!stop) setUnread(Number(body?.unread || 0)); }).catch(() => {});
    const timer = setInterval(() => {
      api.inbox?.().then((body) => { if (!stop) setUnread(Number(body?.unread || 0)); }).catch(() => {});
    }, 20000);
    return () => { stop = true; clearInterval(timer); };
  }, [api, practitionerId]);

  if (loading) return <PageSkeleton error={error} />;
  if (!capable) return <PractitionerUnauthorized />;
  if (!me) return <PractitionerSetupRequired reason={practitionerId ? "missing_profile" : "missing_subject"} />;

  const selected = visits.find((row) => row.id === aid) || visits[0];

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="pro-messages">
      <SectionHead eyebrow="Communication" title="Messages" />
      <p className="text-sm text-nb-mute">
        In-app visit conversations with your clients. {unread > 0 ? <span data-testid="pro-messages-unread">{unread} unread</span> : "No unread messages."}
      </p>
      {visits.length === 0 && (
        <EmptyState icon={MessageCircle} title="No open conversations" body="Messages appear here for your active visits. Open a visit anytime from Today." testid="pro-messages-empty" />
      )}
      {visits.length > 0 && (
        <>
          <label className="block text-sm">
            <span className="nb-label">Visit</span>
            <select className="nb-input" value={selected?.id || ""} onChange={(event) => setAid(event.target.value)} data-testid="pro-messages-appt-select">
              {visits.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.ref} · {idx.clients[row.clientId]?.firstName || "Client"} · {fmtDate(row.date)} {fmtTime(row.time)}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <div className="space-y-3">
              <div className="nb-card flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold">{idx.clients[selected.clientId]?.firstName || "Client"} · {idx.services[selected.serviceSlug]?.name || "Visit"}</p>
                  <p className="text-xs text-nb-mute">{fmtDate(selected.date)} {fmtTime(selected.time)} · {selected.locationType === "clinic" ? "Clinic" : "Mobile"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={selected.status} />
                  <Link to={`/pro/visit/${selected.id}`} className="text-sm font-semibold text-nb-blue" data-testid="pro-messages-open-visit">Visit <ChevronRight className="inline h-4 w-4" /></Link>
                </div>
              </div>
              <Conversation
                appointmentId={selected.id}
                viewerRole="practitioner"
                title={selected.ref}
                counterpart={idx.clients[selected.clientId]?.firstName || "Client"}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
