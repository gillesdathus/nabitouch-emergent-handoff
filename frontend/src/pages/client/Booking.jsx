import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, MapPin, Clock, User, Layers, HeartHandshake, Gift } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { InstallCard } from "@/components/InstallCard";
import { toast } from "sonner";
import { apiError } from "@/lib/api";
import { PromoBanner } from "@/components/client";
import { SuccessMark, ClientTracker } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { StepWhere, StepService, StepWhen, StepYou, StepPay } from "./BookingSteps";
import { Stepper } from "@/components/tide";
import { quote, zoneFor, money, fmtDate, fmtTime, LOCATION_TYPES, welcomeOfferListed, paymentChoice, clinicBookable, isTrialService } from "@/lib/domain";
import { formatCents } from "@/lib/billing";
import {
  addressReady,
  addressSelectionPatch,
  bookingPathForService,
  confirmAddressForBooking,
  isLockedBookingAppointment,
  preferredBookingAddress,
  resolveCatalogueService,
  serviceSelectionPatch,
} from "@/lib/booking-selection";

const STEPS = ["Where", "Service", "When", "You", "Payment", "Review"];

function Breakdown({ q, compact, settlement }) {
  const Row = ({ l, v, cls = "", testid }) => <div className={`flex justify-between ${cls}`} data-testid={testid}><span>{l}</span><span className="tabular-nums">{v}</span></div>;
  return (
    <div className={`space-y-1.5 ${compact ? "text-xs" : "text-sm"}`} data-testid="price-breakdown">
      <Row l="Treatment" v={money(q.base)} />
      {q.discount > 0 && <Row l={q.promoName || "Discount"} v={`−${money(q.discount)}`} cls="font-medium text-nb-teal" testid="breakdown-discount" />}
      {q.discount > 0 && <Row l="Discounted treatment subtotal" v={money(q.treatmentAfterDiscount)} cls="text-nb-mute" />}
      {q.addons > 0 && <Row l={`Enhancements (${q.addonList.join(", ")})`} v={money(q.addons)} />}
      <Row l="Travel fee" v={q.travel ? money(q.travel) : "Included"} testid="breakdown-travel" />
      <Row l="GST (5%)" v={money(q.tax)} testid="breakdown-tax" />
      <div className="my-2 border-t border-dashed border-sky-200" />
      <Row l="Appointment total" v={money(q.total)} cls={`font-semibold text-nb-ink ${compact ? "text-sm" : "text-lg"}`} testid="breakdown-total" />
      {settlement && <>
        <Row l="Due now" v={formatCents(settlement.dueNowCents)} testid="breakdown-due-now" />
        <Row l="Remaining balance" v={formatCents(settlement.remainingCents)} testid="breakdown-remaining" />
        <p className="text-xs text-nb-mute" data-testid="breakdown-settlement-note">{settlement.totalCents === 0 ? "Nothing is due online for this visit." : settlement.choice === "cash" ? "Cash is payable at the visit. This booking is not prepaid." : settlement.dueNowCents < settlement.totalCents ? "The deposit is due online. The remaining balance is collected later and is not paid yet." : "The full total is due online. It is paid only after Stripe verifies the payment."}</p>
      </>}
    </div>
  );
}

export default function Booking() {
  const { draft, patchDraft, state, idx, me, run, api, resetDraft, register } = useDemo();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [done, setDone] = useState(null);
  const [guestTrack, setGuestTrack] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverQuote, setServerQuote] = useState(null);
  const [settlement, setSettlement] = useState(null);
  const [quoteNote, setQuoteNote] = useState("");
  const [wallet, setWallet] = useState([]);
  const autoAddressKey = useRef("");
  useEffect(() => { if (me) api.plansMine().then((r) => setWallet(r.wallet || [])).catch(() => setWallet([])); }, [me, api]);
  const creditGroup = wallet.find((w) => w.serviceSlug === draft.serviceSlug && Number(w.duration) === Number(draft.duration) && w.available > 0);
  const useCredit = !!(me && creditGroup && draft.useCredit);
  const [winback, setWinback] = useState(null);
  const [followups, setFollowups] = useState([]);
  useEffect(() => { if (me) api.winbackMine().then((r) => setWinback(r.invite)).catch(() => setWinback(null)); }, [me, api]);
  useEffect(() => { if (me) api.followupMine().then((r) => setFollowups(r.coupons || [])).catch(() => setFollowups([])); }, [me, api]);
  const winbackCode = !useCredit && winback && draft.useWinback ? winback.code : undefined;
  const followup = !useCredit && !winbackCode && followups[0] && draft.useFollowup ? followups[0] : null;
  const followupCode = followup?.code;
  const g = draft.guest;
  const step = draft.step;
  const service = idx?.services?.[draft.serviceSlug] || resolveCatalogueService(state?.services, draft.serviceId || draft.serviceSlug);

  // Returning clients: auto-select primary/confirmed saved address and skip Where when ready.
  useEffect(() => {
    if (!me) {
      autoAddressKey.current = "";
      return undefined;
    }
    if (draft.forceWhere || draft.locationType === "clinic") return undefined;
    const saved = preferredBookingAddress(me);
    if (!saved) return undefined;
    const key = `${me.id}:${saved.id || saved.line}`;
    if (autoAddressKey.current === key) return undefined;
    let cancelled = false;
    const applyReady = (addr) => {
      if (cancelled) return;
      autoAddressKey.current = key;
      const skipWhere = draft.step === 0;
      patchDraft({
        ...addressSelectionPatch(addr, { query: addr.line }),
        forceWhere: false,
        ...(skipWhere ? { step: 1 } : {}),
      });
    };
    if (draft.address && addressReady(draft.address)) {
      autoAddressKey.current = key;
      if (draft.step === 0) patchDraft({ step: 1, forceWhere: false });
      return undefined;
    }
    if (draft.address && draft.address.id && saved.id && draft.address.id !== saved.id) {
      autoAddressKey.current = key;
      return undefined;
    }
    if (addressReady(saved)) {
      applyReady({ ...saved });
      return undefined;
    }
    autoAddressKey.current = key;
    confirmAddressForBooking(api, saved)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) applyReady(result.address);
        else {
          patchDraft({
            ...addressSelectionPatch(result.address || saved, { query: (result.address || saved).line }),
            forceWhere: false,
            step: 0,
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        patchDraft({
          ...addressSelectionPatch(saved, { query: saved.line }),
          step: 0,
        });
      });
    return () => { cancelled = true; };
  }, [me, api, draft.forceWhere, draft.locationType, draft.address, draft.step, patchDraft]);

  const goChangeAddress = () => {
    autoAddressKey.current = "";
    patchDraft({ forceWhere: true, step: 0 });
  };

  // Apply ?service=<id|slug> from catalogue / auth return without forcing re-selection.
  useEffect(() => {
    if (!state?.services?.length) return undefined;
    const appointmentId = params.get("appointment") || params.get("appointmentId");
    if (appointmentId) {
      const existing = state.appointments?.find((row) => row.id === appointmentId);
      if (isLockedBookingAppointment(existing)) {
        toast.message("This visit is complete. Use reschedule or modify from My Nabitouch.");
        nav("/me", { replace: true });
        return undefined;
      }
    }
    const key = params.get("service") || params.get("serviceId");
    if (!key) return undefined;
    const selected = resolveCatalogueService(state.services, key);
    if (!selected) return undefined;
    if (draft.serviceId === selected.id || draft.serviceSlug === selected.slug) {
      if (!draft.serviceId && selected.id) patchDraft({ serviceId: selected.id });
      return undefined;
    }
    patchDraft({ ...serviceSelectionPatch(selected, draft), step: draft.step || 0 });
    return undefined;
  }, [state, params]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the URL service id aligned when the client changes treatment in-flow.
  useEffect(() => {
    if (!service?.id) return;
    const current = params.get("service") || params.get("serviceId");
    if (current === service.id || current === service.slug) return;
    const next = new URLSearchParams(params);
    next.set("service", service.id);
    next.delete("serviceId");
    setParams(next, { replace: true });
  }, [service?.id, service?.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // In-clinic stays off until owner activates it; never leave a stale clinic draft selected.
  // Trial campaigns may still reserve clinic time when a street address exists.
  useEffect(() => {
    if (!idx?.settings) return;
    const trialDraft = Boolean(draft.campaignId && isTrialService(service));
    if (draft.locationType === "clinic" && !clinicBookable(idx.settings.clinic) && !trialDraft) {
      patchDraft({ locationType: "home" });
    }
  }, [idx?.settings, draft.locationType, draft.campaignId, service?.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const zr = draft.locationType !== "clinic" && draft.address ? zoneFor(draft.address, state.zones) : null;
  const q = quote({ service, duration: draft.duration, addons: draft.addons, zone: zr?.zone, km: zr?.km, serverTravel: draft.address?.quoted ? draft.address.travelFee : undefined, client: me || null, promotions: state.promotions, settings: idx?.settings, locationType: draft.locationType });
  const trialFlowEarly = Boolean(draft.campaignId && isTrialService(service));
  const reviewAt = trialFlowEarly ? 4 : 5;
  const shown = step === reviewAt && serverQuote ? serverQuote : q;
  const quotePayload = step === reviewAt ? {
    useCredit,
    winbackCode,
    followupCode,
    campaignId: useCredit || winbackCode || followupCode ? undefined : draft.campaignId || undefined,
    client: me ? { id: me.id } : { firstName: g.firstName, lastName: g.lastName, email: g.email, phone: g.phone },
    practitionerId: draft.practitionerId || null,
    appointment: {
      serviceSlug: draft.serviceSlug, duration: draft.duration, date: draft.date, time: draft.time, locationType: draft.locationType,
      address: draft.locationType === "clinic" ? { line: idx.settings.clinic?.address || "" } : draft.address,
      addonIds: draft.addons, paymentMethod: "self", payNow: paymentChoice(draft, idx.settings),
    },
  } : null;
  const quoteKey = JSON.stringify(quotePayload);
  useEffect(() => {
    if (quoteKey === "null") {
      setServerQuote(null);
      setSettlement(null);
      setQuoteNote("");
      return undefined;
    }
    let stop = false;
    setServerQuote(null);
    setSettlement(null);
    setQuoteNote("");
    api.quoteBooking(JSON.parse(quoteKey))
      .then((res) => { if (!stop) { setServerQuote(res.pricing); setSettlement(res.settlement || null); } })
      .catch((error) => { if (!stop) setQuoteNote(apiError(error)); });
    return () => { stop = true; };
  }, [quoteKey, api]);
  const trialFlow = Boolean(draft.campaignId && isTrialService(service));
  const clinic = idx.settings?.clinic || {};
  const clinicReady = Boolean(clinic.addressReady === true || String(clinic.address || "").trim());
  const whereOk = draft.locationType === "clinic"
    ? (trialFlow ? clinicReady : clinicBookable(clinic))
    : (!!zr?.zone && draft.address?.clientConfirmed === true);
  const guestContactOk = g.firstName && g.lastName && /\S+@\S+/.test(g.email) && g.phone;
  const trialExtrasOk = !trialFlowEarly || Boolean((me?.dob || g.dob) && ["yes", "no", "unsure"].includes(g.insuranceStatus));
  const guestProfileOk = trialFlowEarly || !g.createProfile || (g.dob && (g.password || "").length >= 8);
  const youOk = me ? trialExtrasOk : (guestContactOk && trialExtrasOk && guestProfileOk);
  const ok = [
    whereOk,
    !!service && !!service.prices[String(draft.duration)],
    !!draft.date && !!draft.time,
    youOk,
    trialFlow || !!paymentChoice(draft, idx.settings),
    true,
  ];
  const whereBlockedReason = !whereOk
    ? (draft.locationType === "clinic"
      ? (trialFlow
        ? "The clinic address is not ready for this free trial yet. Book a regular massage instead, or try again shortly."
        : "In-clinic booking is not open right now. Choose a mobile visit from the options above, or book another treatment.")
      : "Confirm a service address in our Edmonton zones to continue.")
    : "";
  const go = (n) => {
    patchDraft(n === 0 ? { step: n, forceWhere: true } : { step: n, forceWhere: false });
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  };
  const changeTreatment = () => {
    go(1);
    if (service) nav(bookingPathForService(service), { replace: true });
  };

  const confirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      let pid = draft.practitionerId || null;
      const payNow = trialFlow ? undefined : paymentChoice(draft, idx.settings);
      const clinicPin = idx.settings.clinic || {};
      const address = draft.locationType === "clinic" ? { line: clinicPin.address, zoneId: null, ...(Number.isFinite(Number(clinicPin.lat)) && Number.isFinite(Number(clinicPin.lng)) && clinicPin.lat !== "" && clinicPin.lng !== "" ? { lat: Number(clinicPin.lat), lng: Number(clinicPin.lng) } : {}) } : { ...draft.address, zoneId: zr?.zone?.id, notes: draft.addressNotes };
      const client = me ? { id: me.id } : { firstName: g.firstName, lastName: g.lastName, preferredName: "", email: g.email, phone: g.phone, dob: g.dob, insuranceStatus: g.insuranceStatus || undefined, marketingConsent: g.marketingConsent, smsConsent: !!g.smsConsent, hasProfile: g.createProfile, language: "English", contactMethod: "Text", addresses: [{ ...address, id: "ad-1", label: LOCATION_TYPES.find((l) => l.id === draft.locationType).label.replace("My ", "") }], insurance: draft.pendingInsurance ? [draft.pendingInsurance] : [], favorites: [draft.serviceSlug], preferredPractitioners: [], emergencyContact: "", photo: null };
      if (!me && g.createProfile) {
        try { await register({ email: g.email, password: g.password, firstName: g.firstName, lastName: g.lastName, phone: g.phone, dob: g.dob, marketingConsent: g.marketingConsent, smsConsent: !!g.smsConsent, profile: { addresses: client.addresses, insurance: client.insurance, favorites: client.favorites } }); }
        catch (e) { toast.error(apiError(e)); return; }
      }
      const res = await run(() => api.book({
        client, practitionerId: pid, actor: me ? fullNameOf(me) : `${g.firstName} (guest)`,
        useCredit: trialFlow ? false : useCredit,
        winbackCode: trialFlow ? undefined : winbackCode,
        followupCode: trialFlow ? undefined : followupCode,
        campaignId: useCredit || winbackCode || followupCode ? undefined : draft.campaignId || undefined,
        recoveryCaseId: draft.recoveryCaseId || undefined,
        idempotencyKey: draft.idempotencyKey || undefined,
        appointment: { serviceSlug: draft.serviceSlug, duration: draft.duration, date: draft.date, time: draft.time, locationType: draft.locationType, address, addonIds: trialFlow ? [] : draft.addons, paymentMethod: "self", payNow, selfMethod: payNow === "cash" ? "cash" : (payNow ? "card" : undefined), preferences: { goals: draft.goals, focus: draft.focus, notes: draft.notes }, checkedIn: false, feedback: null },
      }));
      setDone(res.appointment);
      setGuestTrack(res.trackingCapability || null);
      resetDraft();
    } finally { setSubmitting(false); }
  };

  if (done) {
    const listed = state.appointments.find((a) => a.id === done.id);
    const live = listed?.serviceSlug ? listed : done;
    const firstBooking = (idx.clients[live.clientId]?.onlineBookings || 1) <= 1;
    const trialVisit = live.appointmentKind === "trial" || live.pricing?.campaignOfferKind === "trial" || live.serviceSlug === "ten-minutes-on-us";
    return (
      <div className="mx-auto max-w-xl px-5 py-14 text-center" data-testid="booking-confirmation">
        <SuccessMark size={84} />
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">Request <span className="font-display font-normal italic nb-gradient-text">received</span></h1>
        <p className="mt-2 text-nb-mute">Reference <b data-testid="booking-ref">{live.ref}</b> · {idx.services[live.serviceSlug]?.name || live.serviceSlug}, {live.duration} min · {fmtDate(live.date)} at {fmtTime(live.time)}</p>
        {trialVisit && <p className="mt-2 text-sm text-nb-teal" data-testid="confirmation-trial">10 Minutes. On Us. — free neck-and-shoulder trial. No payment due.</p>}
        {(live.status === "requested" || !live.practitionerId) && <p className="mt-2 text-sm" data-testid="booking-unassigned">This is a booking request. A practitioner has not been assigned.</p>}
        <div className="nb-card mt-8 p-5 text-left"><ClientTracker appt={live} /><div className="mt-5"><Breakdown q={live.pricing} settlement={live.paymentDue} /></div>{live.pricing?.welcomeOffer && <p className="mt-3 text-xs text-nb-mute" data-testid="confirmation-welcome">First-booking welcome offer applied to the treatment price.</p>}{!trialVisit && <p className="mt-3 text-xs text-nb-mute" data-testid="booking-settlement-note">{live.payNow === "cash" ? "This confirms the appointment request, not a payment. Cash is due at the visit and this booking is not prepaid." : "This confirms the appointment request, not a payment. Online card payment is recorded only after Stripe verifies it."}</p>}</div>
        <p className="mt-4 text-xs text-nb-mute">This environment does not send a confirmation text or email.</p>
        {guestTrack?.token && <p className="mt-3 text-sm"><Link to={{ pathname: "/track", hash: guestTrack.token }} data-testid="guest-tracking-link">Follow this visit</Link> <span className="text-xs text-nb-mute">This link expires in two hours and only shows this appointment while location sharing is on.</span></p>}
        {firstBooking && !trialVisit && <InstallCard />}
        {trialVisit && (
          <div className="nb-card mt-6 p-5 text-left" data-testid="trial-next-cta">
            <p className="font-semibold">Ready for a full massage?</p>
            <p className="mt-1 text-sm text-nb-mute">Book a regular session when you are ready. Your first-booking welcome offer stays available for an eligible regular booking.</p>
            <Link to="/book" className="nb-btn-primary mt-4 inline-flex h-11 px-5 text-sm" data-testid="trial-book-regular">Book a regular massage</Link>
          </div>
        )}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link to="/me" data-testid="confirmation-view-visit-btn" className="nb-btn-primary">{trialVisit ? "View appointment" : "View my visit"}</Link>
          <Link to={trialVisit ? "/me" : "/"} data-testid="confirmation-home-btn" className="nb-btn-ghost h-12">{trialVisit ? "Back to My Nabitouch" : "Back home"}</Link>
        </div>
      </div>
    );
  }

  const flowSteps = trialFlow ? ["Where", "Service", "When", "You", "Review"] : STEPS;
  const reviewStep = trialFlow ? 4 : 5;
  const Body = trialFlow
    ? [StepWhere, StepService, StepWhen, StepYou][step]
    : [StepWhere, StepService, StepWhen, StepYou, StepPay][step];
  const advance = () => {
    if (trialFlow && step === 3) go(reviewStep);
    else go(step + 1);
  };
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_340px]" data-testid={trialFlow ? "booking-trial-flow" : "booking-regular-flow"}>
      <div className="min-w-0">
        <div className="mb-8" data-testid="booking-progress">
          <div className="mb-3 flex items-center justify-between text-xs font-medium text-nb-mute"><span>Step {Math.min(step, reviewStep) + 1} of {flowSteps.length} · <b className="text-nb-ink">{flowSteps[Math.min(step, reviewStep)]}</b></span><span>{shown.welcomeOffer && <span className="text-nb-teal">First-booking welcome offer — confirmed when you submit</span>}{trialFlow && <span className="text-nb-teal">Free 10-minute trial · $0</span>}</span></div>
          <Stepper steps={flowSteps} current={Math.min(step, reviewStep)} testid="booking-stepper" onStep={(index) => {
            const target = trialFlow && index === 4 ? reviewStep : index;
            if (!(target > step && !ok.slice(0, Math.min(target, 4)).every(Boolean))) go(target);
          }} />
          <div className="sr-only">{flowSteps.map((label, index) => (
            <button key={label} type="button" disabled={index > step && !ok.slice(0, index).every(Boolean)} onClick={() => go(trialFlow && index === 4 ? reviewStep : index)} aria-label={`Step ${index + 1}: ${label}`} data-testid={`booking-step-indicator-${index}`}>{label}</button>
          ))}</div>
          {service && step !== 1 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-3" data-testid="booking-selected-service">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-nb-mute">Selected treatment</p>
                <p className="truncate text-sm font-semibold text-nb-ink">{service.name} · {draft.duration} min</p>
              </div>
              <button type="button" onClick={changeTreatment} data-testid="booking-change-treatment" className="text-sm font-semibold text-nb-blue underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nb-blue focus-visible:ring-offset-2">
                Change treatment
              </button>
            </div>
          )}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
            {step < reviewStep ? <Body /> : (
              <div data-testid="step-review">
                <h2 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">{trialFlow ? "Confirm your free trial" : "Review & confirm"}</h2>
                <div className="nb-card divide-y divide-sky-100">
                  {[[User, `${service.name} · ${draft.duration} min`, draft.addons.length ? q.addonList.join(", ") : "No enhancements", 1],
                    [Clock, `${fmtDate(draft.date)} at ${fmtTime(draft.time)}`, draft.practitionerId ? idx.practitioners[draft.practitionerId].name : "Request only — a practitioner is not assigned yet", 2],
                    [MapPin, draft.locationType === "clinic" ? "In clinic" : draft.address?.line, zr?.zone ? `${zr.zone.name}` : "", 0]].map(([I, t, s, st]) => (
                    <div key={st} className="flex items-center gap-4 p-5"><I className="h-5 w-5 text-nb-blue" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{t}</p><p className="text-xs text-nb-mute">{s}</p></div><button onClick={() => (st === 0 ? goChangeAddress() : go(st))} data-testid={`review-edit-${st}`} className="text-xs font-semibold text-nb-blue">{st === 0 && draft.locationType !== "clinic" ? "Change address" : "Edit"}</button></div>))}
                  {creditGroup && <label className={`flex items-center gap-4 p-5 transition-colors ${useCredit ? "tint-mint" : ""}`} data-testid="booking-credit-toggle"><Layers className="h-5 w-5 text-nb-teal" /><span className="flex-1 text-sm"><b>Use a package credit</b><span className="block text-xs text-nb-mute">{creditGroup.available} {creditGroup.serviceName} {creditGroup.duration} min credit{creditGroup.available === 1 ? "" : "s"} left. The credit is held now and used when the visit is completed. It does not combine with other offers.</span></span><Switch checked={useCredit} onCheckedChange={(v) => patchDraft({ useCredit: v })} data-testid="booking-credit-switch" /></label>}
                  {winback && !useCredit && <label className={`flex items-center gap-4 p-5 transition-colors ${winbackCode ? "tint-lagoon" : ""}`} data-testid="booking-winback-toggle"><HeartHandshake className="h-5 w-5 text-nb-blue" /><span className="flex-1 text-sm"><b>Welcome back · {winback.percent}% off</b><span className="block text-xs text-nb-mute">Your one-time code {winback.code} applies to the treatment price, until {fmtDate(winback.expiresAt.slice(0, 10))}. It does not combine with other offers.</span></span><Switch checked={!!winbackCode} onCheckedChange={(v) => patchDraft({ useWinback: v, useFollowup: v ? false : draft.useFollowup })} data-testid="booking-winback-switch" /></label>}
                  {followups[0] && !useCredit && !winbackCode && <label className={`flex items-center gap-4 p-5 transition-colors ${followupCode ? "tint-lagoon" : ""}`} data-testid="booking-followup-toggle"><Gift className="h-5 w-5 text-nb-teal" /><span className="flex-1 text-sm"><b>Follow-up · {followups[0].percent}% off</b><span className="block text-xs text-nb-mute">Code {followups[0].code} until {fmtDate(followups[0].expiresAt.slice(0, 10))}. Does not combine with other offers.</span></span><Switch checked={!!followupCode} onCheckedChange={(v) => patchDraft({ useFollowup: v })} data-testid="booking-followup-switch" /></label>}
                  <div className="p-5"><Breakdown q={shown} settlement={settlement} /></div>
                  {shown.welcomeOffer && <p className="px-5 pb-2 text-xs text-nb-mute" data-testid="booking-welcome-note">First-booking welcome offer. This preview is not a guarantee. Nabitouch confirms eligibility when you submit. It is not combined with other discounts, rewards, or referrals.</p>}
                  {quoteNote && <p className="px-5 pb-2 text-xs text-rose-700" data-testid="booking-quote-error">{quoteNote}</p>}
                  <div className="p-5 text-xs text-nb-mute" data-testid="review-payment-choice">Payment choice: <b className="text-nb-ink">{serverQuote && Number(serverQuote.total) === 0 ? "Nothing to pay online. The credit covers this visit" : paymentChoice(draft, idx.settings) === "cash" ? "Cash at the visit" : paymentChoice(draft, idx.settings) === "deposit" ? "Deposit online" : "Full amount online"}</b></div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        <div className="safe-bottom sticky bottom-[64px] z-20 -mx-5 mt-10 flex flex-col gap-2 border-t border-sky-100 bg-white/95 px-5 py-4 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
          <div className="flex gap-3">
            {step > 0 && <button onClick={() => go(trialFlow && step === reviewStep ? 3 : step - 1)} data-testid="booking-back-btn" className="nb-btn-ghost h-12"><ArrowLeft className="h-4 w-4" />Back</button>}
            {step < reviewStep ? <button disabled={!ok[Math.min(step, 4)]} onClick={advance} data-testid="booking-next-btn" className="nb-btn-primary flex-1">Continue <ArrowRight className="h-4 w-4" /></button>
              : <button disabled={submitting || !serverQuote} onClick={confirm} data-testid="booking-confirm-btn" className="nb-btn-primary flex-1">{submitting ? "Requesting…" : trialFlow ? "Confirm free trial" : (serverQuote ? "Request this visit" : "Confirming the price…")}</button>}
          </div>
          {whereBlockedReason && step === 0 && !ok[0] && <p className="text-sm text-amber-900" data-testid="booking-continue-hint">{whereBlockedReason} <Link to="/book" className="font-semibold text-nb-blue underline" onClick={() => patchDraft({ campaignId: undefined, serviceSlug: "swedish", duration: 60, locationType: undefined })}>Book a regular massage</Link></p>}
          {!ok[Math.min(step, 4)] && step > 0 && step < reviewStep && <p className="text-sm text-nb-mute" data-testid="booking-continue-hint">Complete this step to continue.</p>}
        </div>
      </div>
      <aside className="hidden lg:block">
        <div className="sticky top-32 space-y-4">
          <div className="nb-card p-5" data-testid="booking-summary-aside">
            <p className="text-sm font-semibold">Your booking</p>
            {draft.locationType !== "clinic" && draft.address?.line && (
              <div className="mt-3 border-b border-sky-100 pb-3" data-testid="booking-summary-address">
                <p className="text-xs text-nb-mute">Service address</p>
                <p className="text-sm font-medium text-nb-ink">{draft.address.line}</p>
                <button type="button" onClick={goChangeAddress} data-testid="booking-change-address" className="mt-1 text-xs font-semibold text-nb-blue underline-offset-2 hover:underline">Change address</button>
              </div>
            )}
            {service ? (
              <>
                <div className="mt-3 flex items-start justify-between gap-3">
                  <p className="text-sm" data-testid="booking-summary-service">{service.name} · {draft.duration} min</p>
                  <button type="button" onClick={changeTreatment} data-testid="booking-summary-change-treatment" className="shrink-0 text-xs font-semibold text-nb-blue underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nb-blue focus-visible:ring-offset-2">
                    Change treatment
                  </button>
                </div>
                {draft.time && <p className="text-xs text-nb-mute">{fmtDate(draft.date)} · {fmtTime(draft.time)}</p>}
                <div className="mt-4"><Breakdown q={step === reviewStep && serverQuote ? serverQuote : q} settlement={step === reviewStep ? settlement : null} compact /></div>
              </>
            ) : <p className="mt-2 text-xs text-nb-mute">Choose a treatment to see pricing.</p>}
          </div>
          {!useCredit && !winbackCode && !(me?.onlineBookings > 0) && <p className="mb-2 text-xs text-nb-mute" data-testid="welcome-offer-rule">Welcome offer: first treatment booked in the app, signed in with a complete profile (contact details, service address and an insurance answer). Your final price is confirmed by the server.</p>}
          {!useCredit && !winbackCode && !(me?.onlineBookings > 0) && <PromoBanner compact eligible={welcomeOfferListed(state.promotions.find((p) => p.id === "promo-welcome"), "booking")} promo={state.promotions.find((p) => p.id === "promo-welcome")} testid="booking-promo-banner" />}
        </div>
      </aside>
    </div>
  );
}

const fullNameOf = (c) => `${c.firstName} ${c.lastName}`;
