import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MessageSquare, Plus } from "lucide-react";
import { EmptyState, ModuleNavigation } from "@/components/tide";
import { CreateStaffChat } from "@/components/team/CreateStaffChat";
import { TeamInboxRow, TeamSearchField, UnreadBadge } from "@/components/team/TeamConnectUI";
import { teamNavFor, teamPath, visibleStaffUnreadFromInbox, visibleUnreadFromInbox } from "@/lib/team-connect";
import { useDemo } from "@/store/DemoStore";
import { OPEN, fmtDate, fmtTime } from "@/lib/domain";

function staffTitle(thread, meId) {
  if (thread.kind === "group") return thread.title || "Group";
  const other = (thread.members || []).find((m) => m.id !== meId);
  return other?.name || "Direct message";
}

function staffSubtitle(thread, meId) {
  if (thread.kind === "group") return `${(thread.members || []).length} members`;
  const other = (thread.members || []).find((m) => m.id !== meId);
  return other?.role ? String(other.role) : "Direct";
}

function timeLabel(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-CA", { timeZone: "America/Edmonton", hour: "numeric", minute: "2-digit" });
}

export default function TeamMessages({ role = "pro" }) {
  const { api, state, idx, practitionerId, user } = useDemo();
  const nav = useNavigate();
  const [query, setQuery] = useState("");
  const [inbox, setInbox] = useState({ unread: 0, byAppointment: {}, threads: [] });
  const [staff, setStaff] = useState({ threads: [], unread: 0 });
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = () => {
    api.inbox?.()
      .then((body) => setInbox(body || {}))
      .catch(() => setInbox({ unread: 0, byAppointment: {}, threads: [] }));
    api.teamThreads?.(query)
      .then((body) => setStaff({
        threads: body?.threads || [],
        unread: Number(body?.unread || 0),
        byThread: body?.byThread,
      }))
      .catch(() => setStaff({ threads: [], unread: 0 }));
  };

  useEffect(() => {
    let stop = false;
    const load = () => {
      if (stop) return;
      refresh();
    };
    load();
    const timer = setInterval(load, 20000);
    return () => { stop = true; clearInterval(timer); };
  }, [api, practitionerId, query]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const visitUnread = visibleUnreadFromInbox(inbox);
  const byAppointment = inbox.byAppointment || {};
  const staffUnread = visibleStaffUnreadFromInbox(staff);
  const meId = user?.id;

  const visitHref = (id) => {
    if (role === "pro") return `/pro/visit/${id}/messages`;
    if (role === "desk") return `/desk/messages`;
    return `/owner/messages`;
  };

  return (
    <div className="relative mx-auto max-w-3xl space-y-5 pb-20" data-testid="team-messages">
      <ModuleNavigation items={teamNavFor(role)} testid="team-module-nav" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="nb-eyebrow">Team Connect</p>
          <h1 className="text-3xl font-semibold tracking-tight">Messages</h1>
          <p className="mt-1 text-sm text-nb-mute">
            Client visits
            {visitUnread > 0 ? <> · <span data-testid="team-messages-unread">{visitUnread} unread</span></> : null}
            {" · "}
            Team
            {staffUnread > 0 ? <> · <span data-testid="team-staff-unread">{staffUnread} unread</span></> : " · none unread"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <UnreadBadge count={visitUnread + staffUnread} testid="team-messages-unread-badge" />
        </div>
      </div>

      <TeamSearchField value={query} onChange={setQuery} placeholder="Search message…" testid="team-messages-search" />

      <section className="space-y-3" data-testid="team-staff-threads">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-nb-teal">Team</p>
        {(staff.threads || []).length === 0 && (
          <EmptyState
            icon={MessageSquare}
            title="No staff conversations yet"
            body="Start a direct message or invitation-only group. Only invited members can read it."
            testid="team-staff-empty"
          />
        )}
        {(staff.threads || []).map((thread) => (
          <TeamInboxRow
            key={thread.id}
            to={teamPath(role, `messages/${thread.id}`)}
            person={{
              name: staffTitle(thread, meId),
              initials: staffTitle(thread, meId).slice(0, 1),
              color: thread.kind === "group" ? "#0E9E9A" : "#1565F0",
            }}
            title={staffTitle(thread, meId)}
            subtitle={staffSubtitle(thread, meId)}
            preview={thread.lastPreview || "No messages yet"}
            timeLabel={timeLabel(thread.lastMessageAt || thread.updatedAt)}
            unread={thread.unread}
            showReadReceipt={!thread.unread}
            testid={`team-staff-thread-${thread.id}`}
          />
        ))}
      </section>

      <section className="space-y-3" data-testid="team-client-threads">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-nb-teal">Client visits</p>
        {clientVisits.length === 0 && (
          <EmptyState icon={MessageSquare} title="No open client conversations" body="Active visit chats appear here." testid="team-client-empty" />
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
      </section>

      {role === "pro" && (
        <Link to="/pro/messages" className="text-sm font-semibold text-nb-blue" data-testid="team-messages-classic-link">
          Open classic visit inbox
        </Link>
      )}
      <Link to={teamPath(role)} className="block text-sm text-nb-mute" data-testid="team-messages-back">Back to Team Connect</Link>

      <button
        type="button"
        onClick={() => setCreateOpen(true)}
        className="fixed bottom-[calc(var(--nb-nav-h)+var(--nb-safe-b)+1rem)] right-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-nb-blue text-white shadow-[0_12px_28px_-12px_rgba(21,101,240,.7)] lg:bottom-8"
        aria-label="New conversation"
        data-testid="team-messages-fab"
      >
        <Plus className="h-6 w-6" />
      </button>

      <CreateStaffChat
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(thread) => {
          if (thread?.id) nav(teamPath(role, `messages/${thread.id}`));
          else refresh();
        }}
      />
    </div>
  );
}
