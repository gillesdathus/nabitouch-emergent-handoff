import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ExternalLink, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { PageHeader, Notice, StatusBadge } from "@/components/tide";
import { DemoTag } from "@/components/ui-kit";
import { WellnessStudioNav } from "@/components/wellness/WellnessStudioNav";
import { api, apiError } from "@/lib/api";
import { getWellnessStudioDashboard } from "@/fixtures/wellnessStudio";

/**
 * Corporate Wellness Studio → Events.
 * Live Engage attendance when API is enabled; otherwise synthetic overview list.
 * Never shows clinical screening fields.
 */
export default function WellnessStudioEvents() {
  const [status, setStatus] = useState(null);
  const [events, setEvents] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [attendance, setAttendance] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const demoEvents = getWellnessStudioDashboard().events;

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [st, list] = await Promise.all([api.engageStatus(), api.engageEvents()]);
      setStatus(st);
      const rows = list?.events || [];
      setEvents(rows);
      if (!selectedId && rows[0]) setSelectedId(rows[0].id);
    } catch (err) {
      setStatus(null);
      setEvents([]);
      setError(apiError(err) || "Engage API unavailable — showing synthetic studio list.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId || !status?.publicEnabled) {
      setAttendance([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.engageAttendance(selectedId);
        if (!cancelled) setAttendance(res?.attendance || []);
      } catch {
        if (!cancelled) setAttendance([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, status?.publicEnabled]);

  const selected = events.find((e) => e.id === selectedId);

  return (
    <div className="mx-auto max-w-6xl space-y-5" data-testid="wellness-studio-events">
      <PageHeader
        eyebrow="Corporate Wellness Studio"
        title="Events"
        sub="On-site chair massage days. Attendance is employer-safe — health screening never appears here."
        right={(
          <div className="flex flex-wrap items-center gap-2">
            <DemoTag>Engage ops</DemoTag>
            <button type="button" className="nb-btn-ghost h-10 px-3 text-sm" data-testid="ws-events-refresh" onClick={load}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> Refresh
            </button>
          </div>
        )}
      />
      <WellnessStudioNav />

      {status ? (
        <Notice tone={status.writesEnabled ? "warn" : "off"} testid="ws-events-engage-status">
          Public {status.publicEnabled ? "on" : "off"} · Writes {status.writesEnabled ? "on" : "off"} · Service {status.serviceReady ? status.serviceSlug : "not ready"}
          {status.blockers?.length ? ` · ${status.blockers[0]}` : ""}
        </Notice>
      ) : (
        <Notice tone="off" testid="ws-events-engage-offline">
          {error || "Engage API offline. Synthetic event list below — enable ENGAGE_PUBLIC_ENABLED to load live attendance."}
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="nb-card p-4 sm:p-5" data-testid="ws-events-list">
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-nb-teal" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-nb-ink">Scheduled events</h2>
          </div>
          <ul className="space-y-2">
            {(events.length ? events : demoEvents).map((ev) => {
              const id = ev.id;
              const live = Boolean(events.length);
              const on = selectedId === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    data-testid={`ws-event-${id}`}
                    onClick={() => setSelectedId(id)}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${
                      on ? "border-nb-teal bg-[#E3FAF5]" : "border-sky-100 bg-white hover:border-sky-200"
                    }`}
                  >
                    <p className="font-semibold text-nb-ink">{ev.name}</p>
                    <p className="mt-0.5 text-xs text-nb-mute">
                      {ev.date} · {ev.timeWindow || ev.time} · {live ? `${ev.seatsRemaining ?? "—"} seats left` : `${ev.seats} seats (demo)`}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
          {selectedId ? (
            <Link
              to={`/engage/${selectedId}?mode=phone`}
              className="nb-btn-primary mt-4 h-10 w-full text-sm"
              data-testid="ws-events-open-engage"
            >
              Open public Engage <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
        </section>

        <section className="nb-card p-4 sm:p-5" data-testid="ws-events-attendance">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-nb-teal" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-nb-ink">Attendance</h2>
            </div>
            <StatusBadge tone="info">{attendance.length} checked in</StatusBadge>
          </div>
          {!status?.publicEnabled ? (
            <p className="text-sm text-nb-mute">Enable Engage public APIs to load live attendance for {selected?.name || "an event"}.</p>
          ) : attendance.length === 0 ? (
            <p className="text-sm text-nb-mute">No check-ins yet for this event.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-sky-100 text-[11px] uppercase tracking-wide text-nb-mute">
                    <th className="py-2 pr-2 font-semibold">Guest</th>
                    <th className="py-2 pr-2 font-semibold">Slot</th>
                    <th className="py-2 pr-2 font-semibold">Code</th>
                    <th className="py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.map((row) => (
                    <tr key={row.id} className="border-b border-sky-50" data-testid={`ws-att-${row.id}`}>
                      <td className="py-2.5 pr-2 font-medium text-nb-ink">
                        {row.firstName} {row.lastName}
                        {row.privateFollowUp ? (
                          <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                            <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Private
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-2 text-nb-mute">{row.slotLabel || row.slotId}</td>
                      <td className="py-2.5 pr-2 font-mono text-xs">{row.checkInCode}</td>
                      <td className="py-2.5 text-nb-mute">{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[11px] text-nb-mute">
            Screening answers are never shown on this page. Therapists open precautions from the visit brief when writes are live.
          </p>
        </section>
      </div>
    </div>
  );
}
