import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, Users } from "lucide-react";
import { EmptyState, ModuleNavigation } from "@/components/tide";
import { TeamComingSoon, TeamInboxRow, TeamSearchField, UnreadBadge } from "@/components/team/TeamConnectUI";
import { teamNavFor, teamPath, visibleUnreadFromInbox } from "@/lib/team-connect";
import { useDemo } from "@/store/DemoStore";
import { OPEN, fmtDate, fmtTime } from "@/lib/domain";

export default function TeamMessages({ role = "pro" }) {
  const { api, state, idx, practitionerId } = useDemo();
  const [query, setQuery] = useState("");
  const [inbox, setInbox] = useState({ unread: 0, byAppointment: {}, threads: [] });

  useEffect(() => {
    let stop = false;
    const load = () => api.inbox?.()
      .then((body) => { if (!stop) setInbox(body || {}); })
      .catch(() => { if (!stop) setInbox({ unread: 0, byAppointment: {}, threads: [] }); });
    load();
    const timer = setInterval(load, 20000);
    return () => { stop = true; clearInterval(timer); };
  }, [api, practitionerId]);

  const clientVisits = useMemo(() => {
    const rows = (state.appointments || []).filter((row) => OPEN.includes(row.status));
    const scoped = role === "pro"
      ? rows.filter((row) => row.practitionerId === practitionerId)
      : rows;
    const q = query.trim().toLowerCase();
    return scoped
      .filter((row) => {
        if (!q) return true;
        const client = idx.clients?.[row.clientId];
        const hay = `${client?.firstName || ""} ${client?.lastName || ""} ${row.ref || ""}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }, [state.appointments, practitionerId, role, query, idx.clients]);

  const unread = visibleUnreadFromInbox(inbox);
  const byAppointment = inbox.byAppointment || {};
  const orphanUnread = (inbox.threads || []).filter((t) => {
    const id = t.appointmentId;
    return Number(t.unread) > 0 && !clientVisits.some((row) => row.id === id);
  });

  const visitHref = (id) => {
    if (role === "pro") return `/pro/visit/${id}/messages`;
    if (role === "desk") return `/desk/messages`;
    return `/owner/messages`;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="team-messages">
      <ModuleNavigation items={teamNavFor(role)} testid="team-module-nav" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="nb-eyebrow">Team Connect</p>
          <h1 className="text-3xl font-semibold tracking-tight">Messages</h1>
          <p className="mt-1 text-sm text-nb-mute">
            Client visit conversations
            {unread > 0 ? <> · <span data-testid="team-messages-unread">{unread} unread</span></> : " · none unread"}
          </p>
        </div>
        <UnreadBadge count={unread} testid="team-messages-unread-badge" />
      </div>

      <TeamSearchField value={query} onChange={setQuery} placeholder="Search message…" testid="team-messages-search" />

      <section className="space-y-3" data-testid="team-client-threads">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-nb-teal">Client visits</p>
        {clientVisits.length === 0 && (
          <EmptyState icon={MessageSquare} title="No open client conversations" body="Active visit chats appear here. Staff group messaging is next." testid="team-client-empty" />
        )}
        {clientVisits.map((row) => {
          const client = idx.clients?.[row.clientId] || {};
          const count = Number(byAppointment[row.id] || 0);
          const name = client.firstName || "Client";
          return (
            <TeamInboxRow
              key={row.id}
              to={visitHref(row.id)}
              person={{ name, initials: name.slice(0, 1), color: client.color || "#1565F0", photoUrl: client.photoUrl }}
              title={name}
              subtitle={idx.services?.[row.serviceSlug]?.name || row.ref}
              preview={`${fmtDate(row.date)} ${fmtTime(row.time)}`}
              timeLabel={fmtTime(row.time)}
              unread={count}
              showReadReceipt={count === 0}
              testid={`team-client-thread-${row.id}`}
            />
          );
        })}
        {orphanUnread.length > 0 && (
          <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900" data-testid="team-orphan-unread">
            {orphanUnread.length} unread conversation{orphanUnread.length === 1 ? "" : "s"} on open visits that are not in your local list yet.
            {role === "pro" && (
              <Link to="/pro/messages" className="ml-2 font-semibold text-nb-blue">Open classic inbox</Link>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3" data-testid="team-staff-threads">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-nb-teal">Team</p>
        <TeamComingSoon
          title="Staff and group messaging"
          body="Direct and invitation-only group chats land in Phase 2. Client visit unread counts already use open assigned visits only."
          testid="team-staff-coming-soon"
        />
        <div className="nb-card flex items-center gap-3 p-4 text-sm text-nb-mute">
          <Users className="h-5 w-5 text-nb-teal" />
          <span>Create group and invite flows will appear here. No second messaging engine until Phase 2.</span>
        </div>
      </section>

      {role === "pro" && (
        <Link to="/pro/messages" className="text-sm font-semibold text-nb-blue" data-testid="team-messages-classic-link">
          Open classic visit inbox
        </Link>
      )}
      <Link to={teamPath(role)} className="block text-sm text-nb-mute" data-testid="team-messages-back">Back to Team Connect</Link>
    </div>
  );
}
