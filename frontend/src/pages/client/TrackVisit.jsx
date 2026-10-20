import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, MapPin, MessageCircle, Navigation, Receipt, RefreshCw, RotateCcw, Star } from "lucide-react";
import { toast } from "sonner";
import { LiveTripCard } from "@/components/LiveTripCard";
import { LiveMap } from "@/components/LiveMap";
import { ArrivalMoment } from "@/components/ArrivalMoment";
import { SessionPrepLink } from "@/components/session/SessionPrepLink";
import { BillingFacts } from "@/components/BillingFacts";
import { PaymentPanel } from "@/components/PaymentPanel";
import { Avatar, ClientTracker, StatusPill } from "@/components/ui-kit";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useDemo } from "@/store/DemoStore";
import { api, apiError } from "@/lib/api";
import { DONE, fmtDate, fmtTime, isClinicVisit, isMobileTrackable, money, trackVisitView, visitNavigationPoint } from "@/lib/domain";
import { preferredBookingAddress, rebookStepForAddress } from "@/lib/booking-selection";
import { shouldShowPosition, useLiveSession } from "@/lib/tracking/live";
import { ClientArrivalCode, TrackVisitVehicle } from "@/components/ArrivalCodePanel";
import { restrictedFlag } from "@/lib/feature-flags";

function serviceLabel(services, slug) {
  return services?.[slug]?.name || "Treatment";
}

function ReceiptDialog({ appt, services, practitioners, onClose }) {
  if (!appt) return null;
  const p = appt.pricing || {};
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="rounded-3xl sm:max-w-md" data-testid="track-receipt-dialog">
        <DialogTitle>Receipt · {appt.ref}</DialogTitle>
        <p className="text-xs text-amber-800">This summary is not a tax receipt.</p>
        <div className="space-y-1.5 text-sm">
          <p className="text-nb-mute">{serviceLabel(services, appt.serviceSlug)} · {appt.duration} min · {fmtDate(appt.date)}</p>
          <p className="text-nb-mute">Practitioner: {practitioners[appt.practitionerId]?.name || "—"}</p>
          <div className="border-t border-dashed pt-2" />
          {[["Treatment", p.base], ["Discount", -(p.discount || 0)], ["Enhancements", p.addons], ["Travel", p.travel], ["GST", p.tax]]
            .filter(([, v]) => v)
            .map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <span>{label}</span>
                <span>{value < 0 ? `−${money(-value)}` : money(value)}</span>
              </div>
            ))}
          <div className="flex justify-between font-semibold"><span>Total</span><span>{money(p.total)}</span></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DestinationMap({ dest, tag = "Destination" }) {
  if (!dest?.lat || !dest?.lng) return null;
  return (
    <div data-testid="track-dest-map-wrap">
      <LiveMap height={220} testid="track-dest-map" tag={tag} dests={[{ pos: dest, label: "You" }]} markers={[]} routes={[]} />
    </div>
  );
}

function StateMessage({ view, clinic, driving, hasLiveEta }) {
  if (clinic) {
    return (
      <p className="text-sm text-nb-mute" data-testid="track-clinic-note">
        This is an in-clinic visit. Live travel tracking is only available for mobile appointments.
      </p>
    );
  }
  if (view === "confirmed") {
    return (
      <p className="text-sm text-nb-mute" data-testid="track-confirmed-message">
        Your appointment is confirmed. We&apos;ll notify you when your therapist is on the way.
      </p>
    );
  }
  if (view === "en_route" && !driving) {
    return (
      <p className="flex items-start gap-2 rounded-2xl bg-cyan-50 p-3 text-sm text-cyan-900" data-testid="track-en-route-waiting">
        <Navigation className="mt-0.5 h-4 w-4 shrink-0" />
        Your therapist is on the way. ETA temporarily unavailable.
      </p>
    );
  }
  if (view === "en_route" && driving && !hasLiveEta) {
    return (
      <p className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900" data-testid="track-eta-unavailable">
        <Navigation className="mt-0.5 h-4 w-4 shrink-0" />
        Your therapist is on the way. ETA temporarily unavailable.
      </p>
    );
  }
  if (view === "in_session") {
    return <p className="text-sm font-medium text-nb-navy" data-testid="track-in-session-message">Your massage is in progress.</p>;
  }
  if (view === "cancelled") {
    return <p className="text-sm text-rose-800" data-testid="track-cancelled-message">This appointment was cancelled. Live tracking is not available.</p>;
  }
  if (view === "rescheduled") {
    return <p className="text-sm text-nb-mute" data-testid="track-rescheduled-message">This appointment was rescheduled. Open your updated visit from My Nabitouch.</p>;
  }
  if (view === "interrupted") {
    return <p className="text-sm text-amber-800" data-testid="track-interrupted-message">Treatment is paused. Your practitioner will resume or end the visit from their app.</p>;
  }
  if (view === "safety_hold") {
    return <p className="text-sm text-rose-800" data-testid="track-safety-message">This visit is on hold for safety. Nabitouch or your practitioner will follow up.</p>;
  }
  return null;
}

function LiveEtaPanel({ sess, onRefresh, refreshing }) {
  const etaMin = sess?.eta?.etaMin;
  const arrival = etaMin != null
    ? new Date(Date.now() + etaMin * 60000).toLocaleTimeString("en-CA", { timeZone: "America/Edmonton", hour: "numeric", minute: "2-digit" })
    : null;
  const updatedAt = sess?.eta?.updatedAt || sess?.lastFixAt;
  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleTimeString("en-CA", { timeZone: "America/Edmonton", hour: "numeric", minute: "2-digit" })
    : null;
  return (
    <div className="nb-card flex flex-wrap items-center justify-between gap-3 p-4" data-testid="track-live-eta">
      <div>
        <p className="text-sm font-semibold" data-testid="track-eta-clock">Estimated arrival: {arrival || "—"}</p>
        {updatedLabel && <p className="text-xs text-nb-mute" data-testid="track-eta-updated">Last updated: {updatedLabel}</p>}
        {sess?.stale && <p className="text-xs text-amber-800" data-testid="track-eta-stale">GPS is outdated. ETA may be out of date.</p>}
      </div>
      <button type="button" disabled={refreshing} onClick={onRefresh} className="nb-btn-ghost h-11 gap-2 px-4 text-sm" data-testid="track-eta-refresh">
        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh ETA
      </button>
    </div>
  );
}

export default function TrackVisit() {
  const { id } = useParams();
  const nav = useNavigate();
  const { me, user, state, idx, patchDraft } = useDemo();
  const [receipt, setReceipt] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const shieldFleet = restrictedFlag(idx?.settings, "securityShieldFleetEnabled");
  const shieldArrival = restrictedFlag(idx?.settings, "securityShieldArrivalCodeEnabled");

  const appt = useMemo(() => {
    if (!me || !id) return null;
    return (state.appointments || []).find((row) => row.id === id && row.clientId === me.id) || null;
  }, [me, id, state.appointments]);

  const practitioner = appt ? idx.practitioners[appt.practitionerId] : null;
  const service = appt ? idx.services[appt.serviceSlug] : null;
  const view = trackVisitView(appt);
  const clinic = isClinicVisit(appt);
  const mobile = isMobileTrackable(appt);
  const driving = Boolean(mobile && view === "en_route" && appt?.trip?.sharing);
  const sess = useLiveSession(appt, driving);
  const livePos = shouldShowPosition(sess);
  const hasLiveEta = Boolean(driving && livePos && sess?.eta && sess.eta.etaMin != null);
  const dest = visitNavigationPoint(appt) || appt?.trip?.to || null;
  const showDestMap = mobile && !clinic && dest && !livePos && ["confirmed", "en_route", "arrived", "preparing"].includes(view);
  const showLiveMap = driving && livePos;

  const refreshEta = async () => {
    if (!appt?.id || refreshing) return;
    setRefreshing(true);
    try {
      const res = await api.trackingEtaRefresh(appt.id);
      if (!res.ok) toast.message("ETA temporarily unavailable", { description: "A fresh GPS fix is needed before ETA can update." });
      else toast.success("ETA updated");
    } catch (err) {
      toast.error(apiError(err) || "Could not refresh ETA");
    } finally {
      setRefreshing(false);
    }
  };

  const rebook = () => {
    if (!appt) return;
    const key = appt.serviceSlug;
    const svc = idx.services[key];
    if (!svc) { nav("/book"); return; }
    const prices = Object.keys(svc.prices || {});
    const duration = appt.duration || Number(prices.includes("60") ? 60 : prices[0]);
    const locationType = appt.locationType || "home";
    const address = preferredBookingAddress(me);
    const step = rebookStepForAddress(address, { locationType });
    patchDraft({
      serviceId: svc.id || null,
      serviceSlug: svc.slug,
      duration,
      practitionerId: appt.practitionerId || me.preferredPractitioners?.[0] || "",
      locationType,
      address: address || null,
      addressQuery: address?.line || "",
      step,
      forceWhere: step === 0,
      date: null,
      time: null,
      checkoutSessionId: null,
      checkoutAmountCents: null,
      depositCents: null,
      invoiceId: null,
      idempotencyKey: undefined,
    });
    nav(svc.id ? `/book?service=${encodeURIComponent(svc.id)}` : "/book");
  };

  if (!user || user.role !== "client" || !me) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center" data-testid="track-visit-signed-out">
        <h1 className="text-2xl font-semibold">Track your visit</h1>
        <p className="mt-2 text-sm text-nb-mute">Sign in to follow your mobile appointment.</p>
        <Link to={`/login?next=/me/visit/${encodeURIComponent(id || "")}/track`} className="nb-btn-primary mt-6 inline-flex" data-testid="track-visit-signin">Sign in</Link>
      </div>
    );
  }

  if (!appt) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center" data-testid="track-visit-missing">
        <h1 className="text-2xl font-semibold">Visit not found</h1>
        <p className="mt-2 text-sm text-nb-mute">This appointment is not on your account, or it is no longer available.</p>
        <Link to="/me" className="nb-btn-primary mt-6 inline-flex" data-testid="track-visit-back-me">Back to My Nabitouch</Link>
      </div>
    );
  }

  const destination = clinic ? "Clinic visit" : (appt.address?.line || "Address on the visit");

  return (
    <div className="mx-auto max-w-xl space-y-4 px-5 pb-32 pt-4" data-testid="track-visit-page">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => nav("/me")} className="grid h-11 w-11 place-items-center rounded-full bg-white ring-1 ring-sky-100" data-testid="track-visit-back" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="nb-eyebrow">Track visit</p>
          <h1 className="truncate text-lg font-semibold tracking-tight" data-testid="track-visit-title">
            {view === "en_route" && mobile ? "Your therapist is on the way!" : view === "arrived" ? "Your therapist has arrived." : view === "completed" ? "Visit completed" : "Your visit"}
          </h1>
        </div>
        <StatusPill status={appt.status} client testid="track-visit-status" />
      </div>

      <section className="relative overflow-hidden rounded-[28px] p-5 text-white nb-lagoon" data-testid="track-visit-hero">
        <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-nb-turq/35 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <Avatar person={practitioner} photo={practitioner?.photo} size={52} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold" data-testid="track-visit-practitioner">{practitioner?.name || "Practitioner being assigned"}</p>
            <p className="text-sm text-white/75" data-testid="track-visit-service">{serviceLabel(idx.services, appt.serviceSlug)} · {appt.duration} min</p>
          </div>
        </div>
        <p className="relative mt-4 nb-num text-2xl font-semibold" data-testid="track-visit-when">
          {fmtDate(appt.date, { weekday: "short", month: "short", day: "numeric" })} · {fmtTime(appt.time)}
        </p>
        <p className="relative mt-2 flex items-start gap-1.5 text-xs text-white/80" data-testid="track-visit-address">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{destination}
        </p>
      </section>

      {showDestMap && (
        <DestinationMap
          dest={dest}
          tag={view === "en_route" ? "On the way · destination" : view === "arrived" ? "Arrived" : "Confirmed destination"}
        />
      )}

      {showLiveMap && (
        <div data-testid="track-visit-live">
          <LiveTripCard appt={appt} practitioner={practitioner} />
          <div className="mt-3">
            <LiveEtaPanel sess={sess} onRefresh={refreshEta} refreshing={refreshing} />
          </div>
        </div>
      )}

      {shieldFleet && mobile && !clinic && ["confirmed", "preparing", "en_route", "arrived", "in_session"].includes(view) && (
        <TrackVisitVehicle appt={appt} practitioner={practitioner} />
      )}

      {shieldArrival && mobile && !clinic && ["confirmed", "preparing", "en_route", "arrived"].includes(view) && (
        <ClientArrivalCode apptId={appt.id} />
      )}

      <div className="nb-card space-y-4 p-5">
        <ClientTracker appt={appt} />
        <StateMessage view={view} clinic={clinic} driving={driving} hasLiveEta={hasLiveEta} />
        {!clinic && ["confirmed", "en_route", "arrived"].includes(view) && <SessionPrepLink appt={appt} />}
      </div>

      {view === "arrived" && mobile && (
        <ArrivalMoment appt={appt} practitioner={practitioner} service={service} />
      )}

      {view === "completed" && (
        <section className="nb-card space-y-3 p-5" data-testid="track-visit-completed">
          <p className="font-semibold">Appointment summary</p>
          <p className="text-sm text-nb-mute">{serviceLabel(idx.services, appt.serviceSlug)} · {appt.duration} min · {fmtDate(appt.date)} · {fmtTime(appt.time)}</p>
          <p className="text-sm text-nb-mute">With {practitioner?.name || "your practitioner"} · {destination}</p>
          <BillingFacts appointmentId={appt.id} />
          <PaymentPanel appt={appt} role="client" />
          <div className="flex flex-wrap gap-2 pt-1">
            {DONE.includes(appt.status) && (
              <button type="button" onClick={() => setReceipt(true)} className="nb-btn-ghost h-11 flex-1 gap-2 text-sm" data-testid="track-visit-receipt">
                <Receipt className="h-4 w-4" />Receipt
              </button>
            )}
            <Link to="/me/reviews" className="nb-btn-ghost h-11 flex-1 gap-2 text-sm" data-testid="track-visit-review">
              <Star className="h-4 w-4" />Feedback
            </Link>
            <button type="button" onClick={rebook} className="nb-btn-primary h-11 flex-1 gap-2 text-sm" data-testid="track-visit-rebook">
              <RotateCcw className="h-4 w-4" />Rebook
            </button>
          </div>
        </section>
      )}

      {appt.practitionerId && !["cancelled", "no_show"].includes(appt.status) && (
        <Link to={`/me/messages/${appt.id}`} className="nb-btn-ghost flex h-12 w-full items-center justify-center gap-2" data-testid="track-visit-message">
          <MessageCircle className="h-4 w-4" />Message practitioner
        </Link>
      )}

      {receipt && <ReceiptDialog appt={appt} services={idx.services} practitioners={idx.practitioners} onClose={() => setReceipt(false)} />}
    </div>
  );
}
