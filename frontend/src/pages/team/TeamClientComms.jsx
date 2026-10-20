import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ModuleNavigation, EmptyState } from "@/components/tide";
import { api, apiError } from "@/lib/api";
import { teamNavFor, teamPath } from "@/lib/team-connect";
import { MessageSquare } from "lucide-react";

/** Desk/Manager review of delay client-message drafts — never auto-sent. */
export default function TeamClientComms({ role = "desk" }) {
  const [items, setItems] = useState([]);
  const [drafts, setDrafts] = useState({});

  const load = () => {
    api.teamClientComms({ status: "pending_approval" })
      .then((body) => setItems(body?.items || []))
      .catch((err) => toast.error(apiError(err)));
  };

  useEffect(() => { load(); }, []);

  if (role === "pro") {
    return (
      <div className="mx-auto max-w-3xl space-y-4" data-testid="team-client-comms-pro">
        <p className="text-sm text-nb-mute">Client delay messages need Reception or Manager approval before they send.</p>
        <Link to={teamPath(role, "help")} className="text-sm font-semibold text-nb-blue">Open Quick Help</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="team-client-comms">
      <ModuleNavigation items={teamNavFor(role)} testid="team-module-nav" />
      <div>
        <p className="nb-eyebrow">Team Connect</p>
        <h1 className="text-3xl font-semibold tracking-tight">Client delay review</h1>
        <p className="mt-1 text-sm text-nb-mute">Edit the draft, then approve to deliver in-app. Nothing sends automatically. Internal details stay off the client message.</p>
      </div>
      {items.map((row) => (
        <div key={row.id} className="nb-card space-y-3 p-4" data-testid={`team-comm-${row.id}`}>
          <p className="text-sm font-semibold">{row.appointmentRef || row.appointmentId}</p>
          <textarea
            className="nb-input min-h-[96px] py-3"
            value={drafts[row.id] ?? row.draft}
            onChange={(e) => setDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))}
            data-testid={`team-comm-draft-${row.id}`}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="nb-btn-primary h-10 px-4 text-xs"
              data-testid={`team-comm-approve-${row.id}`}
              onClick={() => api.teamClientCommApprove(row.id, { draft: drafts[row.id] ?? row.draft }).then(() => { toast.success("Approved and delivered in-app"); load(); }).catch((e) => toast.error(apiError(e)))}
            >
              Approve & send in-app
            </button>
            <button
              type="button"
              className="nb-btn-ghost h-10 text-xs text-rose-700"
              data-testid={`team-comm-reject-${row.id}`}
              onClick={() => api.teamClientCommReject(row.id).then(() => { toast.success("Rejected"); load(); }).catch((e) => toast.error(apiError(e)))}
            >
              Reject
            </button>
          </div>
        </div>
      ))}
      {items.length === 0 && <EmptyState icon={MessageSquare} title="No drafts waiting" body="When a delay needs a client update, drafts appear here for approval." testid="team-comms-empty" />}
      <Link to={teamPath(role)} className="block text-sm text-nb-mute">Back to Team Connect</Link>
    </div>
  );
}
