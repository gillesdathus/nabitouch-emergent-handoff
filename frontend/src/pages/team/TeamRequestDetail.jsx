import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ModuleNavigation } from "@/components/tide";
import { PriorityPill, RequestStatusPill } from "@/components/team/TeamConnectUI";
import { api, apiError } from "@/lib/api";
import { teamNavFor, teamPath } from "@/lib/team-connect";
import { useDemo } from "@/store/DemoStore";

export default function TeamRequestDetail({ role = "pro" }) {
  const { requestId } = useParams();
  const { user } = useDemo();
  const [row, setRow] = useState(null);
  const [error, setError] = useState("");
  const [update, setUpdate] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.teamRequest(requestId)
      .then((body) => setRow(body?.request || null))
      .catch((err) => setError(apiError(err)));
  };

  useEffect(() => { load(); }, [requestId]); // eslint-disable-line

  const act = async (fn, ok) => {
    setBusy(true);
    try {
      const body = await fn();
      setRow(body?.request || row);
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  if (error && !row) {
    return (
      <div className="mx-auto max-w-3xl space-y-3" data-testid="team-request-error">
        <p className="text-sm text-rose-700">{error}</p>
        <Link to={teamPath(role, "requests")} className="text-sm font-semibold text-nb-blue">Back to requests</Link>
      </div>
    );
  }

  if (!row) return <p className="text-sm text-nb-mute">Loading request…</p>;

  const canAccept = ["new", "escalated"].includes(row.status) && !row.acknowledgedAt;
  const canProgress = ["accepted", "escalated"].includes(row.status) && (row.assigneeId === user?.id || role !== "pro");

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="team-request-detail">
      <ModuleNavigation items={teamNavFor(role)} testid="team-module-nav" />
      <div>
        <Link to={teamPath(role, "requests")} className="text-xs font-semibold text-nb-blue">← Requests</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{row.categoryTitle}</h1>
          <RequestStatusPill status={row.status} />
          <PriorityPill level={row.priority === "urgent" ? "high" : "medium"} />
        </div>
        <p className="mt-1 text-sm text-nb-mute">{row.ref} · {row.requesterName}{row.appointmentRef ? ` · ${row.appointmentRef}` : ""}</p>
      </div>

      {row.note && <div className="nb-card p-4 text-sm" data-testid="team-request-note">{row.note}</div>}

      {row.shieldRelated && (
        <Link
          to={row.shieldHref || (role === "pro" ? "/pro/shield" : "/owner/shield")}
          className="nb-card block p-4 text-sm font-semibold text-nb-teal"
          data-testid="team-request-shield-link"
        >
          Open Security Shield for fleet or safety follow-up
        </Link>
      )}

      {row.status === "new" && row.escalateAt && (
        <p className="text-xs font-semibold text-amber-800" data-testid="team-request-escalate-at">
          Escalates if unacknowledged by {new Date(row.escalateAt).toLocaleString("en-CA", { timeZone: "America/Edmonton", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      )}
      {row.escalatedAt && (
        <p className="text-xs font-semibold text-rose-800" data-testid="team-request-escalated-at">
          Escalated {new Date(row.escalatedAt).toLocaleString("en-CA", { timeZone: "America/Edmonton", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      )}

      {row.category === "running_late" && row.appointmentId && (role === "desk" || role === "owner") && (
        <div className="space-y-2" data-testid="team-request-delay-draft-box">
          <p className="text-xs text-nb-mute">Client delay drafts stay in-app for desk approval. No SMS is sent from Team Connect.</p>
          <button
            type="button"
            className="nb-btn-ghost h-11 text-sm"
            data-testid="team-request-client-draft"
            disabled={busy}
            onClick={() => act(() => api.teamClientCommDraft({ appointmentId: row.appointmentId, assistRequestId: row.id, delayMinutes: 10 }), "Client draft ready for approval")}
          >
            Create client delay draft
          </button>
        </div>
      )}
      {(role === "desk" || role === "owner") && (
        <Link to={teamPath(role, "client-comms")} className="text-sm font-semibold text-nb-blue">Open client delay review</Link>
      )}

      {row.locationShare && row.location && (
        <div className="nb-card p-4 text-sm" data-testid="team-request-location">
          <p className="font-semibold">Shared location (this request only)</p>
          <p className="mt-1 text-xs text-nb-mute">{row.location.lat?.toFixed?.(5)}, {row.location.lng?.toFixed?.(5)} · consented {row.location.consentAt ? "yes" : "no"}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canAccept && (
          <button type="button" disabled={busy} onClick={() => act(() => api.teamAcceptRequest(row.id), "Accepted")} className="nb-btn-primary h-11 px-5" data-testid="team-request-accept">Accept</button>
        )}
        {canProgress && (
          <button type="button" disabled={busy} onClick={() => act(() => api.teamRequestStatus(row.id, { status: "in_progress" }), "In progress")} className="nb-btn-ghost h-11" data-testid="team-request-progress">In progress</button>
        )}
        {row.status !== "resolved" && row.status !== "cancelled" && row.status !== "unable" && (
          <>
            <button type="button" disabled={busy} onClick={() => act(() => api.teamRequestStatus(row.id, { status: "resolved", outcome: "Resolved" }), "Resolved")} className="nb-btn-ghost h-11" data-testid="team-request-resolve">Resolve</button>
            <button type="button" disabled={busy} onClick={() => act(() => api.teamRequestStatus(row.id, { status: "unable", outcome: "Unable to fulfill" }), "Marked unable")} className="nb-btn-ghost h-11 text-amber-800" data-testid="team-request-unable">Unable</button>
            <button type="button" disabled={busy} onClick={() => act(() => api.teamRequestStatus(row.id, { status: "cancelled" }), "Cancelled")} className="nb-btn-ghost h-11 text-rose-700" data-testid="team-request-cancel">Cancel</button>
          </>
        )}
      </div>

      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-nb-teal">Timeline</p>
        <ol className="space-y-2" data-testid="team-request-history">
          {(row.history || []).map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="nb-card flex justify-between gap-3 p-3 text-sm">
              <span><b className="capitalize">{String(entry.status).replace(/_/g, " ")}</b>{entry.note ? ` · ${entry.note}` : ""}<span className="mt-0.5 block text-xs text-nb-mute">{entry.actor}</span></span>
              <span className="shrink-0 text-xs text-nb-mute">{entry.at?.slice?.(11, 16)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-nb-teal">Internal updates</p>
        {(row.updates || []).map((entry) => (
          <div key={entry.id} className="rounded-2xl bg-sky-50 p-3 text-sm">
            <p>{entry.body}</p>
            <p className="mt-1 text-[11px] text-nb-mute">{entry.authorName}</p>
          </div>
        ))}
        <div className="flex gap-2">
          <input className="nb-input flex-1" value={update} onChange={(e) => setUpdate(e.target.value)} placeholder="Add an internal update…" data-testid="team-request-update-input" />
          <button
            type="button"
            disabled={busy || !update.trim()}
            className="nb-btn-primary h-12 px-4"
            data-testid="team-request-update-btn"
            onClick={() => act(async () => {
              const body = await api.teamRequestUpdate(row.id, { body: update });
              setUpdate("");
              return body;
            }, "Update saved")}
          >
            Post
          </button>
        </div>
      </section>
    </div>
  );
}
