import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import Dashboard from "@/pages/owner/Dashboard";
import { VisualCalendar } from "@/components/ops/VisualCalendar";
import { ClientProfile } from "@/components/ops/Profiles";
import { TrainingBridgeProvider } from "@/store/DemoStore";
import { api } from "@/lib/api";
import { todayISO } from "@/lib/domain";

const LABELS = { practitioner: "Practitioner", client: "Client", desk: "Receptionist", owner: "Manager" };

export default function TrainingWorkspace() {
  const [session, setSession] = useState(undefined);
  const [bundle, setBundle] = useState(null);
  const [notes, setNotes] = useState([]);
  const [clientId, setClientId] = useState(null);
  const [cursor, setCursor] = useState(todayISO());
  const [bio, setBio] = useState("Fictional practitioner for Nabitouch training.");

  const refresh = async () => {
    const [me, state, inbox] = await Promise.all([api.trainingMe(), api.trainingState(), api.trainingNotifications()]);
    setSession(me);
    setBundle(state);
    setNotes(inbox.notifications || []);
    return state;
  };
  useEffect(() => { refresh().catch(() => setSession(null)); }, []); // eslint-disable-line

  const idx = useMemo(() => {
    if (!bundle) return null;
    const by = (name, key = "id") => Object.fromEntries((bundle[name] || []).map((row) => [row[key], row]));
    return { services: by("services", "slug"), clients: by("clients"), practitioners: by("practitioners"), soap: by("soap", "appointmentId"), settings: (bundle.settings || [])[0] || { gst: 0.05, cashEnabled: true, receptionPerms: {} } };
  }, [bundle]);

  if (session === undefined) return <p className="p-8 text-sm text-nb-mute">Loading training workspace…</p>;
  if (!session || !bundle || !idx) {
    return (
      <div className="mx-auto max-w-lg p-8" data-testid="training-signed-out">
        <h1 className="text-2xl font-semibold">Training sign-in</h1>
        <p className="mt-2 text-sm text-nb-mute">Use the training identity from the Training Center. This does not open an operational account.</p>
        <TrainingLogin onDone={refresh} />
        <Link to="/login" className="mt-4 inline-block text-sm font-semibold text-nb-blue">Operational sign-in</Link>
      </div>
    );
  }

  const user = session.user;
  const role = user.role;
  const run = async (fn, message) => {
    const result = await fn();
    await refresh();
    if (message) toast.success(message);
    return result;
  };
  const facade = {
    book: (body) => api.trainingBook(body),
    transition: (id, to) => api.trainingTransition(id, to),
    event: (id, name, _actor, _label, body) => name === "rescheduled" ? api.trainingReschedule(id, body || {}) : api.trainingTransition(id, name),
    patch: (_coll, id, doc) => doc?.checkedIn ? api.trainingTransition(id, "arrived") : Promise.reject(new Error("That change is not available in training")),
    recordCash: (id) => api.trainingCash(id),
    schedule: async () => ({ schedule: (bundle.schedules || [])[0], days: [], onboardingStatus: "approved" }),
    addException: (id, body) => api.trainingAvailability({ practitionerId: id, exceptions: [body] }),
    saveWeekly: (_id, body) => api.trainingAvailability(body),
    pauseBookings: () => Promise.resolve({}),
    approveSchedule: () => Promise.resolve({}),
    trainingApprove: (id) => api.trainingApprove(id),
    trainingReport: () => api.trainingReport(),
    trainingProfile: (body) => api.trainingProfile(body),
    trainingSoap: (id) => api.trainingSoap(id, { sections: { S: "Training note" } }),
  };
  const bridge = {
    state: bundle, idx, user, api: facade, run, training: true, practitionerId: user.subject,
    perm: (key) => !!(idx.settings?.receptionPerms || {})[key] || role === "owner",
    refresh, demoMode: false,
  };
  const visit = (bundle.appointments || []).find((item) => item.status !== "cancelled");

  return (
    <TrainingBridgeProvider value={bridge}>
      <div className="min-h-screen bg-amber-50/40" data-testid="training-workspace">
        <p className="bg-amber-200 px-4 py-2 text-center text-sm font-semibold text-amber-950" data-testid="training-banner">TRAINING MODE — isolated data only. No real bookings, payments, messages, or GPS.</p>
        <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">{LABELS[role] || role} training</p>
              <h1 className="text-3xl font-semibold">{user.name}</h1>
              <p className="text-sm text-nb-mute">Expires {session.scenario?.expiresAt?.slice(0, 16).replace("T", " ")} · {session.done?.length || 0} of {session.tasks?.length || 0} guided tasks</p>
            </div>
            <button type="button" className="nb-btn-ghost h-10 px-3 text-sm" onClick={() => api.trainingLogout().then(() => setSession(null))}>Leave training</button>
          </header>
          <div className="h-2 overflow-hidden rounded-full bg-amber-100"><div className="h-full bg-nb-turq" style={{ width: `${session.tasks?.length ? Math.round(((session.done?.length || 0) / session.tasks.length) * 100) : 0}%` }} /></div>
          <ol className="flex flex-wrap gap-2" data-testid="training-tasks">
            {(session.tasks || []).map((task) => <li key={task} className={`rounded-full px-3 py-1 text-xs font-semibold ${session.done?.includes(task) ? "bg-teal-100 text-teal-900" : "bg-white text-nb-mute ring-1 ring-amber-100"}`}>{task}</li>)}
          </ol>
          {role === "owner" && <Dashboard />}
          {role === "owner" && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="nb-btn-primary h-10 px-3 text-sm" onClick={() => run(() => facade.trainingApprove(`${session.scenario.id}-noah`), "Training practitioner approved")}>Approve sample practitioner</button>
              <button type="button" className="nb-btn-ghost h-10 px-3 text-sm" onClick={() => run(() => facade.trainingReport(), "Training report saved")}>Generate training report</button>
            </div>
          )}
          {role !== "client" && (
            <VisualCalendar appointments={bundle.appointments || []} practitioners={bundle.practitioners || []} services={idx.services} clients={idx.clients} cursor={cursor} onCursor={setCursor} onOpen={() => visit && role === "practitioner" && run(() => facade.transition(visit.id, "arrived"), "Training appointment opened")} />
          )}
          {role === "practitioner" && (
            <div className="rounded-3xl bg-white p-4 ring-1 ring-amber-100">
              <label className="block text-sm">Biography<textarea className="nb-input mt-1 h-auto py-3" value={bio} onChange={(event) => setBio(event.target.value)} /></label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="nb-btn-primary h-10 px-3 text-sm" onClick={() => run(() => facade.trainingProfile({ bio }), "Training biography saved")}>Save biography</button>
                <button type="button" className="nb-btn-ghost h-10 px-3 text-sm" onClick={() => run(() => facade.saveWeekly(user.subject, { weekly: [{ weekday: 1, start: "09:00", end: "15:00" }] }), "Training availability saved")}>Save availability</button>
                {visit && <button type="button" className="nb-btn-ghost h-10 px-3 text-sm" onClick={() => run(() => facade.trainingSoap(visit.id), "Training note saved")}>Complete sample SOAP note</button>}
              </div>
            </div>
          )}
          {role === "desk" && visit && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="nb-btn-primary h-10 px-3 text-sm" onClick={() => run(() => facade.book({ client: { id: visit.clientId }, practitionerId: visit.practitionerId, appointment: { serviceSlug: "trn-relax", duration: 60, date: todayISO(), time: "18:30", pricing: { total: 105 } } }), "Training booking saved")}>Create training booking</button>
              <button type="button" className="nb-btn-ghost h-10 px-3 text-sm" onClick={() => run(() => facade.transition(visit.id, "arrived"), "Training client checked in")}>Check in client</button>
              <button type="button" className="nb-btn-ghost h-10 px-3 text-sm" onClick={() => run(() => facade.recordCash(visit.id), "Training cash recorded")}>Record training cash</button>
            </div>
          )}
          {role === "client" && (
            <div className="space-y-3">
              {(bundle.appointments || []).map((item) => <button key={item.id} type="button" className="block w-full rounded-3xl bg-white p-4 text-left ring-1 ring-amber-100" onClick={() => { setClientId(item.clientId); run(() => api.trainingProgress("invoice"), ""); }}><b>{item.ref}</b><span className="block text-sm text-nb-mute">{item.invoiceBanner} · {item.date} {item.time}</span></button>)}
              {visit && <button type="button" className="nb-btn-ghost h-10 px-3 text-sm" onClick={() => run(() => facade.event(visit.id, "rescheduled", user.name, "", { date: todayISO(), time: "19:00" }), "Training appointment rescheduled")}>Reschedule sample visit</button>}
              <button type="button" className="nb-btn-primary h-10 px-3 text-sm" onClick={() => run(() => facade.book({ client: { id: user.subject }, practitionerId: `${session.scenario.id}-avery`, appointment: { serviceSlug: "trn-relax", duration: 60, date: todayISO(), time: "18:00", pricing: { total: 105 } } }), "Training booking saved")}>Book training service</button>
            </div>
          )}
          <section className="rounded-3xl bg-white p-4 ring-1 ring-amber-100" data-testid="training-inbox">
            <p className="font-semibold">Training inbox</p>
            {notes.length ? notes.map((row) => <p key={row.id} className="text-sm text-nb-mute">{row.text}</p>) : <p className="text-sm text-nb-mute">No training messages. Nothing is sent to a real client or staff member.</p>}
          </section>
        </div>
        {clientId && <ClientProfile clientId={clientId} onClose={() => setClientId(null)} />}
      </div>
    </TrainingBridgeProvider>
  );
}

function TrainingLogin({ onDone }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    try {
      await api.trainingLogin(email, password);
      setPassword("");
      await onDone();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Training sign-in failed");
    }
  };
  return (
    <form className="mt-4 space-y-3" onSubmit={submit} data-testid="training-login">
      <input className="nb-input" type="email" required placeholder="Training email" value={email} onChange={(event) => setEmail(event.target.value)} data-testid="training-email" />
      <input className="nb-input" type="password" required placeholder="Training password" value={password} onChange={(event) => setPassword(event.target.value)} data-testid="training-password" />
      <button className="nb-btn-primary h-11 w-full" data-testid="training-sign-in">Enter training</button>
    </form>
  );
}
