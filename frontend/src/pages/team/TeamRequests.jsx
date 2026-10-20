import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Shield } from "lucide-react";
import { EmptyState, ModuleNavigation } from "@/components/tide";
import { PriorityPill, RequestStatusPill } from "@/components/team/TeamConnectUI";
import { api, apiError } from "@/lib/api";
import { QUICK_HELP_CATEGORIES, teamNavFor, teamPath } from "@/lib/team-connect";
import { toast } from "sonner";

const TABS = [
  { id: "active", label: "Active" },
  { id: "new", label: "New" },
  { id: "escalated", label: "Escalated" },
  { id: "in_progress", label: "In Progress" },
  { id: "resolved", label: "Resolved" },
];

function timeLabel(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-CA", { timeZone: "America/Edmonton", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function TeamRequests({ role = "pro" }) {
  const [tab, setTab] = useState(role === "pro" ? "active" : "new");
  const [category, setCategory] = useState("");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  const load = () => {
    api.teamRequestsTick?.().catch(() => {});
    api.teamRequests({ status: tab, mine: role === "pro", category: category || undefined })
      .then((body) => setRows(body?.requests || []))
      .catch((err) => setError(apiError(err)));
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, [tab, role, category]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="team-requests">
      <ModuleNavigation items={teamNavFor(role)} testid="team-module-nav" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="nb-eyebrow">Team Connect</p>
          <h1 className="text-3xl font-semibold tracking-tight">Requests</h1>
          <p className="mt-1 text-sm text-nb-mute">
            {role === "pro" ? "Your assistance requests" : "Assistance board — accept is atomic so two people cannot claim the same request"}
          </p>
        </div>
        <Link to={teamPath(role, "help")} className="nb-btn-primary h-10 px-4 text-xs" data-testid="team-requests-new">Quick Help</Link>
      </div>

      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-sky-100 pb-px" data-testid="team-request-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold ${tab === item.id ? "border-nb-blue text-nb-blue" : "border-transparent text-nb-mute"}`}
            data-testid={`team-request-tab-${item.id}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <label className="block text-sm" data-testid="team-request-category-filter">
        <span className="nb-label">Category</span>
        <select className="nb-input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {QUICK_HELP_CATEGORIES.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.title}</option>
          ))}
        </select>
      </label>

      {error && <p className="text-sm text-rose-700">{error}</p>}

      <div className="space-y-3" data-testid="team-request-list">
        {rows.map((row) => (
          <Link
            key={row.id}
            to={teamPath(role, `requests/${row.id}`)}
            className="nb-card block space-y-2 bg-[var(--nb-warm)] p-4 transition-colors hover:border-nb-sky"
            data-testid={`team-request-card-${row.id}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-nb-mute">{row.ref}</span>
              <div className="flex items-center gap-2">
                {row.shieldRelated && <Shield className="h-3.5 w-3.5 text-nb-teal" aria-label="Shield related" data-testid={`team-request-shield-${row.id}`} />}
                <PriorityPill level={row.priority === "urgent" ? "high" : "medium"} />
                <RequestStatusPill status={row.status} />
              </div>
            </div>
            <p className="font-semibold text-nb-ink">{row.categoryTitle}</p>
            <p className="text-xs text-nb-mute">
              {row.requesterName}
              {row.appointmentRef ? ` · ${row.appointmentRef}` : ""}
              {" · "}
              {timeLabel(row.createdAt)}
            </p>
            {row.status === "new" && row.escalateAt && (
              <p className="text-[11px] font-semibold text-amber-800" data-testid={`team-request-escalate-${row.id}`}>
                Escalates {timeLabel(row.escalateAt)}
              </p>
            )}
            {row.escalatedAt && (
              <p className="text-[11px] font-semibold text-rose-800" data-testid={`team-request-escalated-${row.id}`}>
                Escalated {timeLabel(row.escalatedAt)}
              </p>
            )}
            {row.note && <p className="line-clamp-2 text-sm text-nb-mute">{row.note}</p>}
          </Link>
        ))}
      </div>

      {rows.length === 0 && !error && (
        <EmptyState
          icon={ClipboardList}
          title="No requests here"
          body="Quick Help submissions appear on this board with New → Accepted → In Progress → Resolved."
          testid="team-requests-empty"
        />
      )}

      {(role === "desk" || role === "owner") && (
        <button type="button" className="text-xs font-semibold text-nb-blue" onClick={() => api.teamRequestsTick().then((b) => { toast.success(`Escalation sweep · ${b.escalated || 0}`); load(); }).catch((e) => toast.error(apiError(e)))} data-testid="team-requests-tick">
          Run escalation check
        </button>
      )}
      <Link to={teamPath(role)} className="block text-sm text-nb-mute">Back to Team Connect</Link>
    </div>
  );
}
