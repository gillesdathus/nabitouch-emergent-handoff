import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, MessageCircle } from "lucide-react";
import { SectionHead, PageSkeleton, StatusPill } from "@/components/ui-kit";
import { EmptyState } from "@/components/tide";
import { Conversation } from "@/components/Conversation";
import { useDemo } from "@/store/DemoStore";
import { OPEN, fmtDate, fmtTime } from "@/lib/domain";
import { visibleUnreadFromInbox } from "@/lib/team-connect";
import { PractitionerSetupRequired, PractitionerUnauthorized, usePractitionerProfile } from "@/components/PractitionerRouteGuard";

export default function ProMessages() {
  const { api, idx, state } = useDemo();
  const { loading, capable, me, practitionerId, error } = usePractitionerProfile();
  const [aid, setAid] = useState("");
  const [unread, setUnread] = useState(0);
  const [byAppointment, setByAppointment] = useState({});

  const visits = useMemo(() => {
    return (state.appointments || [])
      .filter((row) => row.practitionerId === practitionerId && OPEN.includes(row.status))
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }, [state.appointments, practitionerId]);

  const refreshInbox = useCallback(() => {
    return api.inbox?.()
      .then((body) => {
        setUnread(visibleUnreadFromInbox(body));
        setByAppointment(body?.byAppointment || {});
      })
      .catch(() => {
        setUnread(0);
        setByAppointment({});
      });
  }, [api]);

  useEffect(() => {
    if (!visits.length) {
      setAid("");
      return;
    }
    if (aid && visits.some((row) => row.id === aid)) return;
    const unreadIds = Object.keys(byAppointment || {}).filter((id) => Number(byAppointment[id]) > 0);
    const preferred = unreadIds.find((id) => visits.some((row) => row.id === id));
    setAid(preferred || visits[0].id);
  }, [visits, aid, byAppointment]);

  useEffect(() => {
    let stop = false;
    const load = () => {
      api.inbox?.()
        .then((body) => {
          if (stop) return;
          setUnread(visibleUnreadFromInbox(body));
          setByAppointment(body?.byAppointment || {});
        })
        .catch(() => {
          if (!stop) {
            setUnread(0);
            setByAppointment({});
          }
        });
    };
    load();
    const timer = setInterval(load, 20000);
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
        {" "}
        <Link to="/pro/team/messages" className="font-semibold text-nb-blue" data-testid="pro-messages-team-link">Team Connect</Link>
      </p>
      {visits.length === 0 && (
        <EmptyState icon={MessageCircle} title="No open conversations" body="Messages appear here for your active visits. Open a visit anytime from Today." testid="pro-messages-empty" />
      )}
      {visits.length > 0 && (
        <>
          <label className="block text-sm">
            <span className="nb-label">Visit</span>
            <select className="nb-input" value={selected?.id || ""} onChange={(event) => setAid(event.target.value)} data-testid="pro-messages-appt-select">
              {visits.map((row) => {
                const count = Number(byAppointment[row.id] || 0);
                return (
                  <option key={row.id} value={row.id}>
                    {count > 0 ? `(${count}) ` : ""}{row.ref} · {idx.clients[row.clientId]?.firstName || "Client"} · {fmtDate(row.date)} {fmtTime(row.time)}
                  </option>
                );
              })}
            </select>
          </label>
          {selected && (
            <div className="space-y-3">
              <div className="nb-card flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold">
                    {Number(byAppointment[selected.id] || 0) > 0 && (
                      <span className="mr-2 inline-flex rounded-full bg-nb-coral px-1.5 text-[10px] font-bold text-white" data-testid="pro-messages-thread-unread">
                        {byAppointment[selected.id]}
                      </span>
                    )}
                    {idx.clients[selected.clientId]?.firstName || "Client"} · {idx.services[selected.serviceSlug]?.name || "Visit"}
                  </p>
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
                onRead={refreshInbox}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
