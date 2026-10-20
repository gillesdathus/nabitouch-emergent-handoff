import { useEffect, useMemo, useState } from "react";
import { VisualCalendar } from "@/components/ops/VisualCalendar";
import { AppointmentSheet } from "@/components/AppointmentSheet";
import WeeklyHoursEditor from "@/components/schedule/WeeklyHoursEditor";
import CampaignSlotsEditor from "@/components/schedule/CampaignSlotsEditor";
import BreaksEditor from "@/components/schedule/BreaksEditor";
import TimeOffEditor from "@/components/schedule/TimeOffEditor";
import { useDemo } from "@/store/DemoStore";
import { addDays, todayISO } from "@/lib/domain";

const SECTIONS = [
  ["weekly", "Weekly Hours"],
  ["campaign", "Campaign Slots"],
  ["breaks", "Breaks"],
  ["timeoff", "Time Off / Exceptions"],
];

const TONE = {
  available: "bg-teal-100 text-teal-900",
  campaign: "bg-violet-100 text-violet-950",
  booked: "bg-sky-200 text-sky-950",
  blocked: "bg-amber-100 text-amber-950",
  unavailable: "bg-slate-100 text-slate-500",
};

function monthStart(day) {
  return `${day.slice(0, 8)}01`;
}

function monthEnd(day) {
  const [year, month] = day.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${day.slice(0, 8)}${String(last).padStart(2, "0")}`;
}

export default function Availability({ mode = "pro" }) {
  const { state, api, user, practitionerId, idx } = useDemo();
  const people = state.practitioners || [];
  const [personId, setPersonId] = useState(mode === "pro" ? practitionerId : people[0]?.id || "");
  const [cursor, setCursor] = useState(todayISO());
  const [view, setView] = useState("week");
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [section, setSection] = useState("weekly");
  const [weeklyConflicts, setWeeklyConflicts] = useState(null);
  const [exceptionConflicts, setExceptionConflicts] = useState(null);
  const [pendingException, setPendingException] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [campaigns, setCampaigns] = useState([]);

  const range = useMemo(() => {
    if (view === "day") return [cursor, cursor];
    if (view === "month") return [monthStart(cursor), monthEnd(cursor)];
    return [cursor, addDays(cursor, 6)];
  }, [cursor, view]);

  const load = () => {
    if (!personId) return;
    api.schedule(personId, { start: range[0], end: range[1] })
      .then(setPayload)
      .catch((err) => setError(err?.response?.data?.detail || "The schedule could not be loaded."));
  };

  useEffect(() => { load(); }, [personId, range[0], range[1]]); // eslint-disable-line

  useEffect(() => {
    if (!api.campaigns) return;
    api.campaigns().then((rows) => setCampaigns(Array.isArray(rows) ? rows : rows?.campaigns || [])).catch(() => setCampaigns([]));
  }, [api]);

  const schedule = payload?.schedule;
  const campaignChoices = useMemo(() => {
    const trial = (campaigns || []).filter((row) => row.offerKind === "trial" || row.id === "cmp-ten-minutes-on-us");
    if (!trial.length) return [{ id: "cmp-ten-minutes-on-us", title: "10 Minutes. On Us." }];
    return trial.map((row) => ({ id: row.id, title: row.title || row.name || "10 Minutes. On Us." }));
  }, [campaigns]);

  const saveWeekly = async (body) => {
    setError("");
    try {
      const result = await api.saveWeekly(personId, body);
      setWeeklyConflicts(null);
      load();
      return result;
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.conflicts) {
        setWeeklyConflicts(detail.conflicts);
        throw err;
      }
      const message = typeof detail === "string" ? detail : detail?.message;
      setError(message || "The schedule was not saved.");
      throw err;
    }
  };

  const saveCampaignBlocksList = async (next) => {
    setError("");
    try {
      const result = await api.saveCampaignBlocks(personId, { campaignBlocks: next });
      load();
      return result;
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const message = typeof detail === "string" ? detail : detail?.message;
      setError(message || "Campaign slots were not saved.");
      throw err;
    }
  };

  const saveException = async (body) => {
    setError("");
    try {
      const result = await api.addException(personId, body);
      setExceptionConflicts(null);
      setPendingException(null);
      load();
      return result;
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.conflicts) {
        setExceptionConflicts(detail.conflicts);
        setPendingException(body);
        throw err;
      }
      const message = typeof detail === "string" ? detail : detail?.message;
      setError(message || "The change was not saved.");
      throw err;
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5" data-testid="availability-page">
      <div>
        <p className="nb-eyebrow">Your calendar</p>
        <h1 className="text-3xl font-semibold tracking-tight">Sche<span className="font-display font-normal italic nb-gradient-text">dule</span></h1>
        <p className="text-sm text-nb-mute">
          Weekly hours, campaign slots, breaks, and time off in one place. Times use Edmonton local time.
          Reception may assist when authorized. Existing visits are never cancelled from this screen.
        </p>
      </div>

      {mode === "owner" && (
        <label className="block text-sm"><span className="nb-label">Practitioner</span>
          <select className="nb-input" value={personId} onChange={(event) => setPersonId(event.target.value)} data-testid="availability-practitioner">
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}{person.onboardingStatus === "draft" ? " · draft" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {["day", "week", "month"].map((item) => (
          <button key={item} type="button" className={view === item ? "nb-chip-on" : "nb-chip-off"} onClick={() => setView(item)} data-testid={`availability-view-${item}`}>
            {item}
          </button>
        ))}
        <button type="button" className="nb-btn-ghost h-10" onClick={() => setCursor(addDays(cursor, view === "month" ? -30 : view === "day" ? -1 : -7))}>Previous</button>
        <button type="button" className="nb-btn-ghost h-10" onClick={() => setCursor(todayISO())}>Today</button>
        <button type="button" className="nb-btn-ghost h-10" onClick={() => setCursor(addDays(cursor, view === "month" ? 30 : view === "day" ? 1 : 7))}>Next</button>
        <button
          type="button"
          className="nb-btn-ghost h-10"
          data-testid="availability-pause"
          onClick={async () => { await api.pauseBookings(personId, !schedule?.acceptingBookings); load(); }}
        >
          {schedule?.acceptingBookings ? "Pause new bookings" : "Paused"}
        </button>
        {user?.role === "owner" && (
          <button
            type="button"
            className="nb-btn-primary h-10"
            data-testid="availability-approve"
            onClick={async () => {
              try {
                await api.approveSchedule(personId);
                load();
              } catch (err) {
                const detail = err?.response?.data?.detail;
                const message = typeof detail === "string" ? detail : detail?.message;
                setError(message || "Approval was not saved.");
              }
            }}
          >
            Approve schedule
          </button>
        )}
      </div>

      {schedule && (
        <p className="text-sm text-nb-mute" data-testid="availability-status">
          Status: {schedule.status}. {schedule.acceptingBookings ? "Accepting new bookings." : "Not accepting new bookings."}
          {" "}Onboarding: {payload?.onboardingStatus}. Campaign blocks: {(schedule.campaignBlocks || []).length}.
        </p>
      )}
      {error && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" data-testid="availability-error">{error}</p>}

      <VisualCalendar
        appointments={(state.appointments || []).filter((item) => !personId || item.practitionerId === personId)}
        practitioners={people}
        services={idx?.services || {}}
        clients={idx?.clients || {}}
        cursor={cursor}
        onCursor={setCursor}
        onOpen={setOpenId}
        onSlot={() => setSection("breaks")}
      />
      {openId && <AppointmentSheet apptId={openId} role={mode === "owner" ? "owner" : "pro"} onClose={() => setOpenId(null)} />}

      <div className="flex flex-wrap gap-2 text-xs" data-testid="availability-day-legend">
        {Object.entries(TONE).filter(([key]) => key !== "unavailable").map(([key, className]) => (
          <span key={key} className={`rounded-full px-3 py-1 font-medium ${className}`}>{key}</span>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Schedule sections" data-testid="schedule-sections">
        {SECTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            className={section === id ? "nb-chip-on" : "nb-chip-off"}
            onClick={() => setSection(id)}
            data-testid={`schedule-section-${id}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="nb-card p-4 sm:p-5">
        {section === "weekly" && (
          <WeeklyHoursEditor
            schedule={schedule}
            services={(state.services || []).filter((service) => service.kind !== "trial")}
            onSave={saveWeekly}
            conflicts={weeklyConflicts}
          />
        )}
        {section === "campaign" && (
          <CampaignSlotsEditor
            blocks={schedule?.campaignBlocks || []}
            campaigns={campaignChoices}
            onSave={saveCampaignBlocksList}
          />
        )}
        {section === "breaks" && (
          <BreaksEditor
            exceptions={schedule?.exceptions}
            onSave={saveException}
            conflicts={exceptionConflicts}
            onKeep={() => pendingException && saveException({ ...pendingException, resolution: "keep_appointments" }).catch(() => {})}
          />
        )}
        {section === "timeoff" && (
          <TimeOffEditor
            exceptions={schedule?.exceptions}
            onSave={saveException}
            conflicts={exceptionConflicts}
            canOwnerOverride={user?.role === "owner"}
            onKeep={() => pendingException && saveException({ ...pendingException, resolution: "keep_appointments" }).catch(() => {})}
          />
        )}
      </div>

      {mode === "owner" && (
        <form
          className="nb-card grid gap-3 p-4 sm:grid-cols-4"
          data-testid="availability-buffers"
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const body = {};
            ["setupMin", "cleanupMin", "travelBufferMin"].forEach((key) => {
              const value = data.get(key);
              if (value !== "" && value != null) body[key] = Number(value);
            });
            try {
              await api.patch("settings", "app", { scheduling: body });
              setError("");
            } catch (err) {
              setError(err?.response?.data?.detail || "The buffers were not saved.");
            }
          }}
        >
          <p className="sm:col-span-4 text-sm font-semibold">Travel buffers (owner)</p>
          <label className="text-sm">Setup minutes<input className="nb-input" name="setupMin" inputMode="numeric" data-testid="buffer-setup" /></label>
          <label className="text-sm">Cleanup minutes<input className="nb-input" name="cleanupMin" inputMode="numeric" data-testid="buffer-cleanup" /></label>
          <label className="text-sm">Travel buffer<input className="nb-input" name="travelBufferMin" inputMode="numeric" data-testid="buffer-travel" /></label>
          <button className="nb-btn-dark h-12" data-testid="buffer-save">Save buffers</button>
        </form>
      )}
    </div>
  );
}
