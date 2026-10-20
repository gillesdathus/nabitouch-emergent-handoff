import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Bell, ChevronRight, ClipboardEdit, Headphones, LifeBuoy, MapPin, MessageSquare, Package, Route as RouteIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Avatar, StatusPill, SectionHead, PageSkeleton } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { todayISO, fmtTime, fmtDate, endTime, OPEN, ACTIVE, addDays } from "@/lib/domain";
import { PractitionerSetupRequired, PractitionerUnauthorized, usePractitionerProfile } from "@/components/PractitionerRouteGuard";
import { ProfileReminder } from "@/components/practitioner/ProfileReminder";
import { formatKm, freshnessLabel, isMobileRouteStop, isRoadLeg, providerLabel } from "@/lib/my-route";
import { quickHelpHref } from "@/lib/team-connect";
import { etaCopy } from "@/lib/tracking/providers";

const ready = (a) => a.readiness?.allReady === true && OPEN.includes(a.status) && a.status !== "in_session";
const CANCELLED = new Set(["cancelled", "no_show", "refunded"]);

function sortVisits(rows) {
  return [...rows].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}

function VisitRow({ a, idx, testid }) {
  return (
    <Link to={`/pro/visit/${a.id}`} data-testid={testid} data-ready={ready(a) ? "true" : "false"} className={`nb-card flex items-center gap-4 p-4 hover:border-nb-sky ${ready(a) ? "nb-ready-glow" : ""}`}>
      <div className="w-20 shrink-0 text-sm font-semibold">
        <p>{fmtDate(a.date)}</p>
        <p className="text-xs text-nb-mute">{fmtTime(a.time)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{idx.clients[a.clientId]?.firstName} · {idx.services[a.serviceSlug]?.name || "Visit"} · {a.duration}m</p>
        <p className="truncate text-xs text-nb-mute">{a.locationType === "clinic" ? "Clinic" : "Mobile"} · {a.address?.line || "Address pending"}</p>
        {ready(a) && <p className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-teal-700"><span className="nb-ready-dot" />Space ready</p>}
      </div>
      <StatusPill status={a.status} />
    </Link>
  );
}

function travelSummaryForNext(next, route) {
  if (!next || !route) return { state: "loading" };
  const warning = (route.warnings || []).find((row) => row.appointmentId === next.id);
  const entry = (route.stops || []).find((row) => row.stop?.id === next.id);
  if (!entry) {
    if (next.date !== todayISO()) return { state: "future" };
    return { state: "missing" };
  }
  if (!isMobileRouteStop(entry)) {
    return { state: "clinic" };
  }
  if (!next.address?.line && !entry.stop?.addressLine && !entry.stop?.position) {
    return { state: "no_address", warning };
  }
  if (entry.leg && isRoadLeg(entry.leg)) {
    return {
      state: "leg",
      minutes: entry.leg.minutes,
      km: entry.leg.km,
      depart: entry.leg.depart,
      arrive: entry.leg.arrive,
      provider: entry.leg.provider,
      computedAt: entry.leg.computedAt || route.computedAt,
      warning,
      qualified: false,
    };
  }
  if (entry.leg && !isRoadLeg(entry.leg)) {
    return { state: "eta_unavailable", warning };
  }
  // First stop of the day — no prior leg; leave-by needs optional location preview on My Route.
  return {
    state: "first_stop",
    warning,
    setupMin: route.rules?.setupMin,
    travelBufferMin: route.rules?.travelBufferMin,
  };
}

export default function Today() {
  const { run, api } = useDemo();
  const { loading, capable, me, practitionerId, idx, state, error } = usePractitionerProfile();
  const [route, setRoute] = useState(null);
  const [routeError, setRouteError] = useState("");
  const today = todayISO();

  useEffect(() => {
    if (!practitionerId || !capable) return undefined;
    let live = true;
    setRouteError("");
    api.dailyRoute(practitionerId, today)
      .then((body) => { if (live) setRoute(body); })
      .catch((err) => {
        if (!live) return;
        setRoute(null);
        setRouteError(err?.response?.data?.detail || "Travel estimates unavailable");
      });
    return () => { live = false; };
    // api identity can change every render from the store — key on practitioner + day only.
  }, [practitionerId, capable, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = useMemo(
    () => (state.appointments || []).filter((a) => a.practitionerId === practitionerId && !CANCELLED.has(a.status)),
    [state.appointments, practitionerId],
  );
  const list = useMemo(() => sortVisits(mine.filter((a) => a.date === today)), [mine, today]);
  const upcoming = useMemo(() => sortVisits(mine.filter((a) => a.date > today)), [mine, today]);
  const next = list.find((a) => ACTIVE.includes(a.status)) || list.find((a) => OPEN.includes(a.status)) || upcoming.find((a) => OPEN.includes(a.status));
  const travel = travelSummaryForNext(next, route);

  if (loading) return <PageSkeleton error={error} />;
  if (!capable) return <PractitionerUnauthorized />;
  if (!me) return <PractitionerSetupRequired reason={practitionerId ? "missing_profile" : "missing_subject"} />;

  const soapDue = mine.filter((a) => a.status === "soap_pending" || (a.soapStatus === "draft"));
  const soon = (d) => d <= addDays(today, 60);
  const reminders = [me.licenseExpiry && soon(me.licenseExpiry) && `Licence renewal due ${me.licenseExpiry}`, me.insuranceExpiry && soon(me.insuranceExpiry) && `Liability insurance expires ${me.insuranceExpiry}`].filter(Boolean);
  const notes = [...(state.audit || []).filter((x) => mine.some((a) => a.id === x.appointmentId)).slice(0, 3).map((x) => x.action)];
  const firstName = (me.name || "there").split(" ")[0];
  const openToday = list.filter((a) => OPEN.includes(a.status)).length;
  const openAhead = openToday + upcoming.filter((a) => OPEN.includes(a.status)).length;
  const inProgress = next && ACTIVE.includes(next.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="pro-today">
      <ProfileReminder person={me} />
      <div className="rounded-[30px] p-5 text-white nb-tide">
        <div className="flex items-center gap-3">
          <Avatar person={me} size={46} />
          <div className="flex-1"><p className="text-xs text-white/60">{new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Edmonton" })}</p><p className="font-semibold">Hi {firstName}</p></div>
        </div>
        <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-tight">
          You have <span className="nb-gradient-text">{openAhead}</span> {openAhead === 1 ? "visit" : "visits"} ahead
        </h1>
        {list.length === 0 && upcoming.length > 0 && <p className="mt-2 text-sm text-white/70" data-testid="pro-today-none-today-note">Nothing on the calendar today — upcoming visits are listed below.</p>}
      </div>
      <label className="nb-card flex items-center justify-between gap-3 p-4"><span className="min-w-0 text-sm"><b>{me.available ? "Available for bookings" : "Unavailable"}</b><span className="block text-xs text-nb-mute">Off-duty status hides you from new bookings and location views.</span></span><Switch checked={!!me.available} onCheckedChange={(v) => run(() => api.patch("practitioners", me.id, { available: v }))} data-testid="pro-availability-switch" /></label>

      {next ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[30px] text-white nb-lagoon" data-testid="pro-next-card">
          <div className="p-6">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">
                {inProgress ? "In progress" : next.date === today ? "Next visit" : "Upcoming visit"}
              </p>
              <StatusPill status={next.status} />
            </div>
            <p className="mt-3 text-3xl font-semibold">{fmtTime(next.time)} <span className="text-base font-normal text-white/60">– {fmtTime(endTime(next.time, next.duration))}</span></p>
            {next.date !== today && <p className="mt-1 text-sm text-white/70">{fmtDate(next.date)}</p>}
            <p className="mt-1 text-lg">{idx.clients[next.clientId]?.firstName} {(idx.clients[next.clientId]?.lastName || "").slice(0, 1)}. · {idx.services[next.serviceSlug]?.name || "Visit"} {next.duration}m</p>
            <p className="mt-2 flex items-start gap-1 text-sm text-white/70"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /><span>{next.locationType === "clinic" ? "Clinic" : (next.address?.line || "Address pending")}</span></p>

            <div className="mt-4 space-y-2" data-testid="pro-next-travel">
              {travel.state === "leg" && (
                <>
                  <p className="text-sm font-semibold" data-testid="pro-next-drive">
                    Road travel about {travel.minutes} min{formatKm(travel.km) ? ` · ${formatKm(travel.km)}` : ""}
                  </p>
                  <p className="text-sm text-white/80" data-testid="pro-next-depart">Leave by {travel.depart} · arrive about {travel.arrive}</p>
                  <p className="text-xs text-white/65">{providerLabel(travel.provider)}{travel.qualified ? " (qualified)" : ""} · {etaCopy(travel.provider)}{freshnessLabel(travel.computedAt) ? ` · as of ${freshnessLabel(travel.computedAt)}` : ""}</p>
                </>
              )}
              {travel.state === "first_stop" && (
                <p className="text-sm text-white/80" data-testid="pro-next-first-stop">
                  First stop today — open My Route to preview drive time from your location
                  {travel.setupMin != null ? ` (includes ${travel.setupMin}+${travel.travelBufferMin} min setup/buffer)` : ""}.
                </p>
              )}
              {travel.state === "eta_unavailable" && <p className="text-sm text-amber-100" data-testid="pro-next-eta-unavailable">Driving ETA unavailable — open My Route to retry.</p>}
              {travel.state === "no_address" && <p className="text-sm text-amber-100" data-testid="pro-next-missing-address">Destination address is not ready yet.</p>}
              {travel.state === "clinic" && <p className="text-sm text-white/70" data-testid="pro-next-clinic">In-clinic visit — not shown as a driving stop on My Route.</p>}
              {travel.state === "future" && <p className="text-sm text-white/70" data-testid="pro-next-future-day">Open My Route and pick that date for address-to-address travel.</p>}
              {travel.state === "missing" && !routeError && <p className="text-sm text-white/70">Travel details load on My Route.</p>}
              {routeError && <p className="text-sm text-amber-100" data-testid="pro-next-route-error">{routeError}</p>}
              {travel.warning && <p className="rounded-2xl bg-amber-400/20 px-3 py-2 text-xs font-semibold text-amber-50" data-testid="pro-next-tight-buffer">{travel.warning.message}</p>}
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {ready(next) && <span className="flex items-center gap-1.5 rounded-full bg-teal-400/15 px-3 py-1 font-semibold text-teal-200" data-testid="pro-next-ready"><span className="nb-ready-dot" />Client space ready</span>}
              {next.address?.notes && <span className="rounded-full bg-white/10 px-3 py-1">{next.address.notes}</span>}
            </div>
          </div>
          <div className="grid grid-cols-1 divide-y divide-white/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <Link to={`/pro/visit/${next.id}`} data-testid="pro-open-next-visit" className="flex items-center justify-between bg-white/10 px-6 py-4 text-sm font-semibold hover:bg-white/15">Open visit <ChevronRight className="h-5 w-5" /></Link>
            <Link to="/pro/route" data-testid="pro-open-my-route" className="flex items-center justify-between bg-white/10 px-6 py-4 text-sm font-semibold hover:bg-white/15"><span className="inline-flex items-center gap-2"><RouteIcon className="h-4 w-4" />Open My Route</span><ChevronRight className="h-5 w-5" /></Link>
          </div>
        </motion.div>
      ) : <div className="nb-soft p-6 text-sm" data-testid="pro-today-empty-all">No upcoming appointments. When clients book you, they appear here.</div>}

      {!next && (
        <Link to="/pro/route" className="nb-card flex items-center gap-3 p-4 text-sm hover:border-nb-sky" data-testid="pro-open-my-route-empty">
          <RouteIcon className="h-5 w-5 shrink-0 text-nb-teal" />
          <span className="flex-1"><span className="font-semibold">Open My Route</span><span className="block text-xs text-nb-mute">Inspect itinerary and travel estimates</span></span>
          <ChevronRight className="h-4 w-4 text-sky-300" />
        </Link>
      )}

      <div className="grid gap-3 sm:grid-cols-2" data-testid="pro-team-shortcuts">
        <Link
          to={quickHelpHref("pro", { category: next && OPEN.includes(next.status) ? "running_late" : undefined, appointmentId: next && OPEN.includes(next.status) ? next.id : undefined })}
          className="nb-card flex items-center gap-3 p-4 text-sm hover:border-nb-sky"
          data-testid="pro-today-quick-help"
        >
          <LifeBuoy className="h-5 w-5 shrink-0 text-nb-teal" />
          <span><span className="font-semibold">Quick Help</span><span className="block text-xs text-nb-mute">Running late, vehicle, safety, supplies</span></span>
        </Link>
        <Link to="/pro/team" className="nb-card flex items-center gap-3 p-4 text-sm hover:border-nb-sky" data-testid="pro-today-team-connect">
          <Headphones className="h-5 w-5 shrink-0 text-nb-blue" />
          <span><span className="font-semibold">Team Connect</span><span className="block text-xs text-nb-mute">Messages, requests, and supplies</span></span>
        </Link>
      </div>
      <Link to="/pro/messages" className="nb-card flex items-center gap-3 p-4 text-sm hover:border-nb-sky" data-testid="pro-today-messages">
        <MessageSquare className="h-5 w-5 shrink-0 text-nb-navy" />
        <span className="flex-1"><span className="font-semibold">Client messages</span><span className="block text-xs text-nb-mute">Visit conversations with clients</span></span>
        <ChevronRight className="h-4 w-4 text-sky-300" />
      </Link>

      <div className="nb-card flex gap-3 p-4 text-sm"><Package className="h-5 w-5 shrink-0 text-nb-teal" /><div><p className="font-semibold">Travel prep</p><p className="text-xs text-nb-mute">Table & face cradle · fresh linens · oils & hypoallergenic lotion · bolsters · sanitiser</p></div></div>

      {(soapDue.length > 0 || reminders.length > 0) && (
        <div className="space-y-2" data-testid="pro-attention">
          {soapDue.map((a) => <Link key={a.id} to={`/pro/soap/${a.id}`} data-testid={`pro-soap-due-${a.id}`} className="flex items-center gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900"><ClipboardEdit className="h-5 w-5" /><span className="flex-1">SOAP notes {a.soapStatus === "draft" ? "draft" : "pending"} · {idx.clients[a.clientId]?.firstName} ({a.ref})</span><ChevronRight className="h-4 w-4" /></Link>)}
          {reminders.map((r) => <div key={r} className="flex items-center gap-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-800"><AlertTriangle className="h-5 w-5" />{r}</div>)}
        </div>
      )}

      <div>
        <SectionHead eyebrow="Schedule" title="Today’s visits" />
        <ol className="relative space-y-3 pl-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-sky-200" data-testid="pro-today-agenda">
          {list.map((a, i) => (
            <motion.li key={a.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="relative">
              <span className={`absolute -left-[22px] top-5 h-3 w-3 rounded-full ring-4 ring-[#F3F8FA] ${ACTIVE.includes(a.status) ? "nb-gradient" : "bg-sky-300"}`} />
              <VisitRow a={a} idx={idx} testid={`pro-visit-row-${a.id}`} />
            </motion.li>
          ))}
          {list.length === 0 && <p className="text-sm text-nb-mute" data-testid="pro-no-appointments-today">No appointments today</p>}
        </ol>
      </div>

      <div data-testid="pro-upcoming">
        <SectionHead eyebrow="Ahead" title="Upcoming visits" />
        <div className="space-y-3">
          {upcoming.map((a) => <VisitRow key={a.id} a={a} idx={idx} testid={`pro-upcoming-row-${a.id}`} />)}
          {upcoming.length === 0 && list.length > 0 && <p className="text-sm text-nb-mute" data-testid="pro-upcoming-empty">No further visits scheduled after today.</p>}
          {upcoming.length === 0 && list.length === 0 && <p className="text-sm text-nb-mute" data-testid="pro-schedule-empty">Your schedule is clear.</p>}
        </div>
      </div>

      {notes.length > 0 && <div className="nb-card p-4" data-testid="pro-notifications"><p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Bell className="h-4 w-4" />Recent updates</p>{notes.map((n, i) => <p key={i} className="text-xs text-nb-mute">{n}</p>)}</div>}
      <p className="text-center text-[11px] text-nb-mute">Clinical data is not cached for offline use.</p>
    </div>
  );
}
