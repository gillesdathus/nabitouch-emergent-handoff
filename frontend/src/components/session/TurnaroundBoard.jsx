import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui-kit";
import { api } from "@/lib/api";
import { NEXT_STATE, OPS_STATE, fmtClockTime, fmtSpan } from "@/lib/turnaround";

const ALERT_LABEL = { at_risk: "Next booking at risk", running_late: "Running late for next booking", adjustment: "Schedule adjustment requested", reception: "Practitioner asked reception for help" };

function useBoard() {
  const [board, setBoard] = useState(null);
  const load = useCallback(() => api.turnaroundBoard().then(setBoard).catch(() => {}), []);
  useEffect(() => {
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 20000);
    return () => clearInterval(timer);
  }, [load]);
  return { board, load };
}

function PersonRow({ row, person }) {
  const st = OPS_STATE[row.state] || OPS_STATE.idle;
  const next = row.next ? NEXT_STATE[row.next.state] : null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-sky-100" data-testid={`turnaround-row-${row.practitionerId}`}>
      <Avatar person={person} size={34} />
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{row.name}</p><p className="text-xs text-nb-mute">{row.ref ? `${row.ref} · ${row.time}` : "No visit in progress"}{row.treatment ? ` · ${fmtSpan(row.treatment.elapsedSec * 1000)} of ${row.treatment.bookedMin} min` : ""}{row.cleanup && row.state === "cleanup_in_progress" ? ` · cleanup ${fmtSpan(row.cleanup.remainingSec * 1000)} left` : ""}</p></div>
      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${st.tone}`} data-testid={`turnaround-state-${row.practitionerId}`}>{st.label}</span>
      {row.next && <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${next?.tone || ""}`} data-testid={`turnaround-next-${row.practitionerId}`}>Next {row.next.time} · {next?.label}</span>}
    </div>
  );
}

export function TurnaroundBoard({ people = {}, compact = false }) {
  const { board, load } = useBoard();
  if (!board) return <div className="nb-card h-24 animate-pulse" data-testid="turnaround-board-loading" />;
  const rows = compact ? board.practitioners.filter((row) => row.state !== "idle") : board.practitioners;
  const ack = async (id) => { try { await api.ackTurnaroundAlert(id); toast.success("Alert acknowledged"); load(); } catch (err) { toast.error(err?.response?.data?.detail || "Not saved"); } };
  return (
    <section className="nb-card space-y-3 rounded-[28px] p-5" data-testid="turnaround-board">
      <div className="flex items-center justify-between gap-2"><p className="nb-eyebrow flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" />Practitioner status · live</p><span className="text-[11px] text-nb-mute">Updated {fmtClockTime(board.serverNow)}</span></div>
      {board.alerts.length > 0 && <ul className="space-y-2" data-testid="turnaround-alerts">{board.alerts.slice(0, compact ? 3 : 20).map((alert) => (
        <li key={alert.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-900 ring-1 ring-rose-100" data-testid={`turnaround-alert-${alert.id}`}>
          <AlertTriangle className="h-4 w-4" /><span className="flex-1"><b>{ALERT_LABEL[alert.kind] || alert.kind}</b> · {people[alert.practitionerId]?.name || alert.practitionerId} · {alert.ref}{alert.nextRef ? ` → ${alert.nextRef}` : ""}{typeof alert.bufferMin === "number" ? ` · buffer ${Math.round(alert.bufferMin)} min` : ""}{alert.note ? ` · “${alert.note}”` : ""} · {fmtClockTime(alert.at)}</span>
          <button type="button" onClick={() => ack(alert.id)} className="inline-flex items-center gap-1 font-semibold" data-testid={`turnaround-alert-ack-${alert.id}`}><Check className="h-3.5 w-3.5" />Acknowledge</button>
        </li>))}</ul>}
      <div className="space-y-2">{rows.length ? rows.map((row) => <PersonRow key={row.practitionerId} row={row} person={people[row.practitionerId]} />) : <p className="text-sm text-nb-mute" data-testid="turnaround-board-empty">No practitioner is in a session, cleaning up or travelling right now.</p>}</div>
      <p className="text-[11px] text-nb-mute">Shows timing only. Treatment notes and health details are never shown here. Nothing is rescheduled automatically.{compact && <> <Link to="/owner/turnaround" className="font-semibold text-nb-blue" data-testid="turnaround-board-more">Turnaround settings & report</Link></>}</p>
    </section>
  );
}
