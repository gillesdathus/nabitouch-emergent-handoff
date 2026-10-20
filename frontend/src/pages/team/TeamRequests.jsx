import { Link } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { ModuleNavigation, EmptyState } from "@/components/tide";
import { PriorityPill, RequestStatusPill, TeamComingSoon } from "@/components/team/TeamConnectUI";
import { teamNavFor, teamPath } from "@/lib/team-connect";

const TABS = [
  { id: "new", label: "New" },
  { id: "in_progress", label: "In Progress" },
  { id: "queued", label: "Queued" },
  { id: "resolved", label: "Resolved" },
];

export default function TeamRequests({ role = "pro" }) {
  const board = role === "pro" ? "Your assistance requests" : "Assistance board";
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="team-requests">
      <ModuleNavigation items={teamNavFor(role)} testid="team-module-nav" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="nb-eyebrow">Team Connect</p>
          <h1 className="text-3xl font-semibold tracking-tight">Requests</h1>
          <p className="mt-1 text-sm text-nb-mute">{board}. Lifecycle and atomic accept arrive in Phase 3.</p>
        </div>
      </div>

      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-sky-100 pb-px" data-testid="team-request-tabs" role="tablist">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={index === 1}
            className={`inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold ${index === 1 ? "border-nb-blue text-nb-blue" : "border-transparent text-nb-mute"}`}
            data-testid={`team-request-tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="nb-card space-y-3 bg-[var(--nb-warm)] p-4 opacity-80" data-testid="team-request-sample-card">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-nb-mute">#—</span>
          <div className="flex items-center gap-2">
            <PriorityPill level="high" />
            <RequestStatusPill status="in_progress" />
          </div>
        </div>
        <p className="font-semibold text-nb-ink">Sample layout only</p>
        <p className="text-xs text-nb-mute">Location · appointment link · assigned responder will show here.</p>
      </div>

      <EmptyState
        icon={ClipboardList}
        title="No live requests yet"
        body="Quick Help submissions will land on this board with New → Accepted → In Progress → Resolved."
        testid="team-requests-empty"
      />
      <TeamComingSoon title="Assistance board" body="Escalation timers are server-managed. Acknowledgement stops the unacknowledged timer without auto-resolving." />
      <Link to={teamPath(role)} className="block text-sm text-nb-mute">Back to Team Connect</Link>
    </div>
  );
}
