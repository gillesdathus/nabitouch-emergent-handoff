import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, MapPin, Clock, User } from "lucide-react";
import { InstallCard } from "@/components/InstallCard";
import { toast } from "sonner";
import { apiError } from "@/lib/api";
import { PromoBanner } from "@/components/client";
import { SuccessMark, ClientTracker } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { StepWhere, StepService, StepWhen, StepYou, StepPay } from "./BookingSteps";
import { Stepper } from "@/components/tide";
import { quote, zoneFor, money, fmtDate, fmtTime, LOCATION_TYPES, welcomeOfferListed, paymentChoice, clinicBookable } from "@/lib/domain";
import { formatCents } from "@/lib/billing";

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
        <p className="text-xs text-nb-mute" data-testid="breakdown-settlement-note">{settlement.choice === "cash" ? "Cash is payable at the visit. This booking is not prepaid." : settlement.dueNowCents < settlement.totalCents ? "The deposit is due online. The remaining balance is collected later and is not paid yet." : "The full total is due online. It is paid only after Stripe verifies the payment."}</p>
      </>}
    </div>
  );
}

export default function Booking() {
  const { draft, patchDraft, state, idx, me, run, api, resetDraft, register } = useDemo();
  const [done, setDone] = useState(null);
  const [guestTrack, setGuestTrack] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverQuote, setServerQuote] = useState(null);
  const [settlement, setSettlement] = useState(null);
  const [quoteNote, setQuoteNote] = useState("");
  const g = draft.guest;
  const step = draft.step;
  const service = idx.services[draft.serviceSlug];
  const zr = draft.locationType !== "clinic" && draft.address ? zoneFor(draft.address, state.zones) : null;
  const q = quote({ service, duration: draft.duration, addons: draft.addons, zone: zr?.zone, km: zr?.km, serverTravel: draft.address?.quoted ? draft.address.travelFee : undefined, client: me || null, promotions: state.promotions, settings: idx.settings, locationType: draft.locationType });
  const shown = step === 5 && serverQuote ? serverQuote : q;
  const quotePayload = step === 5 ? {
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
  const ok = [
    (draft.locationType === "clinic" ? clinicBookable(idx.settings.clinic) : (!!zr?.zone && draft.address?.clientConfirmed === true)),
    !!service && !!service.prices[String(draft.duration)],
    !!draft.date && !!draft.time,
    !!me || (g.firstName && g.lastName && /\S+@\S+/.test(g.email) && g.phone && (!g.createProfile || (g.dob && (g.password || "").length >= 8))),
    !!paymentChoice(draft, idx.settings),
    true,
  ];
  const go = (n) => { patchDraft({ step: n }); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const confirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      let pid = draft.practitionerId || null;
      const payNow = paymentChoice(draft, idx.settings);
      const address = draft.locationType === "clinic" ? { line: idx.settings.clinic.address, lat: 53.5461, lng: -113.4938, zoneId: null } : { ...draft.address, zoneId: zr?.zone?.id, notes: draft.addressNotes };
      const client = me ? { id: me.id } : { firstName: g.firstName, lastName: g.lastName, preferredName: "", email: g.email, phone: g.phone, dob: g.dob, marketingConsent: g.marketingConsent, hasProfile: g.createProfile, language: "English", contactMethod: "Text", addresses: [{ ...address, id: "ad-1", label: LOCATION_TYPES.find((l) => l.id === draft.locationType).label.replace("My ", "") }], insurance: draft.pendingInsurance ? [draft.pendingInsurance] : [], favorites: [draft.serviceSlug], preferredPractitioners: [], emergencyContact: "", photo: null };
      if (!me && g.createProfile) {
        try { await register({ email: g.email, password: g.password, firstName: g.firstName, lastName: g.lastName, phone: g.phone, dob: g.dob, marketingConsent: g.marketingConsent, profile: { addresses: client.addresses, insurance: client.insurance, favorites: client.favorites } }); }
        catch (e) { toast.error(apiError(e)); return; }
      }
      const res = await run(() => api.book({
        client, practitionerId: pid, actor: me ? fullNameOf(me) : `${g.firstName} (guest)`,
        campaignId: draft.campaignId || undefined,
        recoveryCaseId: draft.recoveryCaseId || undefined,
        idempotencyKey: draft.idempotencyKey || undefined,
        appointment: { serviceSlug: draft.serviceSlug, duration: draft.duration, date: draft.date, time: draft.time, locationType: draft.locationType, address, addonIds: draft.addons, paymentMethod: "self", payNow, selfMethod: payNow === "cash" ? "cash" : "card", preferences: { goals: draft.goals, focus: draft.focus, notes: draft.notes }, checkedIn: false, feedback: null },
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
    return (
      <div className="mx-auto max-w-xl px-5 py-14 text-center" data-testid="booking-confirmation">
        <SuccessMark size={84} />
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">Request <span className="font-display font-normal italic nb-gradient-text">received</span></h1>
        <p className="mt-2 text-nb-mute">Reference <b data-testid="booking-ref">{live.ref}</b> · {idx.services[live.serviceSlug].name}, {live.duration} min · {fmtDate(live.date)} at {fmtTime(live.time)}</p>
        {(live.status === "requested" || !live.practitionerId) && <p className="mt-2 text-sm" data-testid="booking-unassigned">This is a booking request. A practitioner has not been assigned.</p>}
        <div className="nb-card mt-8 p-5 text-left"><ClientTracker appt={live} /><div className="mt-5"><Breakdown q={live.pricing} settlement={live.paymentDue} /></div>{live.pricing?.welcomeOffer && <p className="mt-3 text-xs text-nb-mute" data-testid="confirmation-welcome">First-booking welcome offer applied to the treatment price.</p>}<p className="mt-3 text-xs text-nb-mute" data-testid="booking-settlement-note">{live.payNow === "cash" ? "This confirms the appointment request, not a payment. Cash is due at the visit and this booking is not prepaid." : "This confirms the appointment request, not a payment. Online card payment is recorded only after Stripe verifies it."}</p></div>
        <p className="mt-4 text-xs text-nb-mute">This environment does not send a confirmation text or email.</p>
        {guestTrack?.token && <p className="mt-3 text-sm"><Link to={{ pathname: "/track", hash: guestTrack.token }} data-testid="guest-tracking-link">Follow this visit</Link> <span className="text-xs text-nb-mute">This link expires in two hours and only shows this appointment while location sharing is on.</span></p>}
        {firstBooking && <InstallCard />}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link to="/me" data-testid="confirmation-view-visit-btn" className="nb-btn-primary">View my visit</Link>
          <Link to="/" data-testid="confirmation-home-btn" className="nb-btn-ghost h-12">Back home</Link>
        </div>
      </div>
    );
  }

  const Body = [StepWhere, StepService, StepWhen, StepYou, StepPay][step];
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 lg:grid-cols-[1fr_340px]">
      <div>
        <div className="mb-8" data-testid="booking-progress">
          <div className="mb-3 flex items-center justify-between text-xs font-medium text-nb-mute"><span>Step {step + 1} of 6 · <b className="text-nb-ink">{STEPS[step]}</b></span><span>{shown.welcomeOffer && <span className="text-nb-teal">First-booking welcome offer — confirmed when you submit</span>}</span></div>
          <Stepper steps={STEPS} current={step} testid="booking-stepper" onStep={(index) => { if (!(index > step && !ok.slice(0, index).every(Boolean))) go(index); }} />
          <div className="sr-only">{STEPS.map((label, index) => (
            <button key={label} type="button" disabled={index > step && !ok.slice(0, index).every(Boolean)} onClick={() => go(index)} aria-label={`Step ${index + 1}: ${label}`} data-testid={`booking-step-indicator-${index}`}>{label}</button>
          ))}</div>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
            {step < 5 ? <Body /> : (
              <div data-testid="step-review">
                <h2 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">Review & confirm</h2>
                <div className="nb-card divide-y divide-sky-100">
                  {[[User, `${service.name} · ${draft.duration} min`, draft.addons.length ? q.addonList.join(", ") : "No enhancements", 1],
                    [Clock, `${fmtDate(draft.date)} at ${fmtTime(draft.time)}`, draft.practitionerId ? idx.practitioners[draft.practitionerId].name : "Request only — a practitioner is not assigned yet", 2],
                    [MapPin, draft.locationType === "clinic" ? "In clinic" : draft.address?.line, zr?.zone ? `${zr.zone.name}` : "", 0]].map(([I, t, s, st]) => (
                    <div key={st} className="flex items-center gap-4 p-5"><I className="h-5 w-5 text-nb-blue" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{t}</p><p className="text-xs text-nb-mute">{s}</p></div><button onClick={() => go(st)} data-testid={`review-edit-${st}`} className="text-xs font-semibold text-nb-blue">Edit</button></div>))}
                  <div className="p-5"><Breakdown q={shown} settlement={settlement} /></div>
                  {shown.welcomeOffer && <p className="px-5 pb-2 text-xs text-nb-mute" data-testid="booking-welcome-note">First-booking welcome offer. This preview is not a guarantee. Nabitouch confirms eligibility when you submit. It is not combined with other discounts, rewards, or referrals.</p>}
                  {quoteNote && <p className="px-5 pb-2 text-xs text-rose-700" data-testid="booking-quote-error">{quoteNote}</p>}
                  <div className="p-5 text-xs text-nb-mute" data-testid="review-payment-choice">Payment choice: <b className="text-nb-ink">{paymentChoice(draft, idx.settings) === "cash" ? "Cash at the visit" : paymentChoice(draft, idx.settings) === "deposit" ? "Deposit online" : "Full amount online"}</b></div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        <div className="safe-bottom sticky bottom-[64px] z-20 -mx-5 mt-10 flex gap-3 border-t border-sky-100 bg-white/95 px-5 py-4 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
          {step > 0 && <button onClick={() => go(step - 1)} data-testid="booking-back-btn" className="nb-btn-ghost h-12"><ArrowLeft className="h-4 w-4" />Back</button>}
          {step < 5 ? <button disabled={!ok[step]} onClick={() => go(step + 1)} data-testid="booking-next-btn" className="nb-btn-primary flex-1">Continue <ArrowRight className="h-4 w-4" /></button>
            : <button disabled={submitting || !serverQuote} onClick={confirm} data-testid="booking-confirm-btn" className="nb-btn-primary flex-1">{submitting ? "Requesting…" : serverQuote ? "Request this visit" : "Confirming the price…"}</button>}
        </div>
      </div>
      <aside className="hidden lg:block">
        <div className="sticky top-32 space-y-4">
          <div className="nb-card p-5" data-testid="booking-summary-aside">
            <p className="text-sm font-semibold">Your booking</p>
            {service ? <><p className="mt-3 text-sm">{service.name} · {draft.duration} min</p>{draft.time && <p className="text-xs text-nb-mute">{fmtDate(draft.date)} · {fmtTime(draft.time)}</p>}<div className="mt-4"><Breakdown q={step === 5 && serverQuote ? serverQuote : q} settlement={step === 5 ? settlement : null} compact /></div></> : <p className="mt-2 text-xs text-nb-mute">Choose a treatment to see pricing.</p>}
          </div>
          <p className="mb-2 text-xs text-nb-mute" data-testid="welcome-offer-rule">Welcome offer: first treatment booked in the app, signed in with a complete profile (contact details, service address and an insurance answer). Your final price is confirmed by the server.</p>
          <PromoBanner compact eligible={welcomeOfferListed(state.promotions.find((p) => p.id === "promo-welcome"))} testid="booking-promo-banner" />
        </div>
      </aside>
    </div>
  );
}

const fullNameOf = (c) => `${c.firstName} ${c.lastName}`;
