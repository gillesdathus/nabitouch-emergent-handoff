// Domain model + pure business logic (no UI). Replaceable by production services later.

/** Sole designated massage therapist for NabiTouch launch operations. */
export const CANONICAL_PRACTITIONER_ID = "p-nabitu-kahindo";
export const CANONICAL_PRACTITIONER_NAME = "Nabitu Kahindo";

export function soleTherapistMode(practitioners) {
  const list = practitioners || [];
  const bookable = list.filter(publiclyBookable);
  if (bookable.length === 1) return true;
  if (bookable.length === 0 && list.some((p) => p?.id === CANONICAL_PRACTITIONER_ID)) return true;
  return list.length <= 1;
}

export function designatedTherapist(practitioners) {
  const list = practitioners || [];
  return list.find((p) => p?.id === CANONICAL_PRACTITIONER_ID) || list.find(publiclyBookable) || list[0] || null;
}

export function profileVisibility(person) {
  if (!person) return "draft";
  if (["draft", "published", "hidden"].includes(person.profileVisibility)) return person.profileVisibility;
  if (person.onboardingStatus === "draft" || person.onboardingStatus === "pending") return "draft";
  return "published";
}

export function practitionerSlug(person) {
  if (person?.slug) return person.slug;
  return String(person?.name || "practitioner").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "practitioner";
}

export function publiclyBookable(person) {
  if (!person || person.available !== true || person.bookable === false) return false;
  if (profileVisibility(person) !== "published") return false;
  const status = person.onboardingStatus;
  return status == null || status === "approved";
}

export function servicePublication(service) {
  if (!service) return "draft";
  if (service.archived === true) return "archived";
  if (["draft", "preview", "published"].includes(service.publication)) return service.publication;
  if (service.enabled === false) return "draft";
  return "published";
}

export function bookableCatalogueService(service) {
  if (!service || service.kind === "trial" || service.slug === "ten-minutes-on-us") return false;
  return servicePublication(service) === "published";
}

export function isTrialService(service) {
  return Boolean(service && (service.kind === "trial" || service.slug === "ten-minutes-on-us"));
}

export function managedMediaPath(src, size) {
  const value = String(src || "");
  if (!value.startsWith("/api/media/")) return "";
  const path = value.slice(4);
  if (!size || path.includes("?")) return path;
  return `${path}?size=${size}`;
}

export const STATUS = {
  requested: { label: 'Booking requested', tone: 'slate', client: 'Requested' },
  confirmed: { label: 'Booking confirmed', tone: 'blue', client: 'Confirmed' },
  assigned: { label: 'Practitioner assigned', tone: 'blue', client: 'Confirmed' },
  preparing: { label: 'Preparing for visit', tone: 'cyan', client: 'Practitioner preparing' },
  en_route: { label: 'En route', tone: 'cyan', client: 'Practitioner on the way' },
  arrived: { label: 'Arrived at location', tone: 'turq', client: 'Arrived' },
  in_session: { label: 'Session in progress', tone: 'green', client: 'Session in progress' },
  session_ended: { label: 'Session ended', tone: 'teal', client: 'Session completed' },
  soap_pending: { label: 'SOAP notes pending', tone: 'amber', client: 'Session completed' },
  soap_completed: { label: 'SOAP notes completed', tone: 'teal', client: 'Session completed' },
  leaving: { label: 'Leaving location', tone: 'teal', client: 'Visit completed' },
  completed: { label: 'Visit completed', tone: 'teal', client: 'Visit completed' },
  processing: { label: 'Payment / insurance processing', tone: 'amber', client: 'Visit completed' },
  closed: { label: 'Closed', tone: 'slate', client: 'Visit completed' },
  cancelled: { label: 'Cancelled', tone: 'red', client: 'Cancelled' },
  no_show: { label: 'No-show', tone: 'red', client: 'Missed' },
  interrupted: { label: 'Interrupted', tone: 'amber', client: 'Paused' },
  safety_hold: { label: 'Safety hold', tone: 'red', client: 'On hold' },
  delayed: { label: 'Running late', tone: 'amber', client: 'Running a little late' },
  rescheduled: { label: 'Rescheduled', tone: 'blue', client: 'Rescheduled' },
  reassigned: { label: 'Practitioner reassigned', tone: 'blue', client: 'Confirmed' },
};

export const LIFECYCLE = ['requested', 'assigned', 'preparing', 'en_route', 'arrived', 'in_session', 'session_ended',
  'soap_pending', 'soap_completed', 'leaving', 'completed', 'processing', 'closed'];
/** Operational phases shown to clients. Advanced only by real appointment status transitions — never by intake, consent, or space prep. */
export const CLIENT_VISIT_PHASES = [
  { id: 'confirmed', label: 'Confirmed', statuses: ['requested', 'confirmed', 'assigned', 'reassigned'] },
  { id: 'preparing', label: 'Practitioner preparing', statuses: ['preparing'] },
  { id: 'en_route', label: 'Practitioner on the way', statuses: ['en_route', 'delayed'] },
  { id: 'arrived', label: 'Arrived', statuses: ['arrived'] },
  { id: 'in_session', label: 'Session in progress', statuses: ['in_session'] },
  { id: 'session_done', label: 'Session completed', statuses: ['session_ended', 'soap_pending', 'soap_completed'] },
  { id: 'completed', label: 'Visit completed', statuses: ['leaving', 'completed', 'processing', 'closed'] },
];
/** @deprecated Prefer clientVisitProgress(); kept for older imports. */
export const CLIENT_STAGES = CLIENT_VISIT_PHASES.map((phase) => phase.label);
export const ACTIVE = ['preparing', 'en_route', 'arrived', 'in_session', 'session_ended', 'soap_pending', 'soap_completed', 'leaving', 'interrupted', 'safety_hold'];
export const OPEN = ['requested', 'confirmed', 'assigned', ...ACTIVE];
export const DONE = ['completed', 'processing', 'closed'];

const CLIENT_VISIT_DETAIL = {
  confirmed: 'This updates when your practitioner starts preparing or begins travel — not when health check, consent, or space prep are done.',
  preparing: 'Your practitioner is getting ready. Travel status appears when they start the trip.',
  en_route: 'Your practitioner is travelling to you. Arrival is confirmed only when they mark it in the app.',
  arrived: 'Your practitioner is at your location and will start the session when you are both ready.',
  in_session: 'Your massage is underway.',
  session_done: 'Treatment has ended. Your practitioner is finishing notes and wrapping up.',
  completed: 'This visit is complete.',
  cancelled: 'This appointment was cancelled.',
  no_show: 'This visit was marked as missed.',
  interrupted: 'Treatment is paused. Your practitioner will resume or end the visit from their app.',
  safety_hold: 'This visit is on hold for safety. Nabitouch or your practitioner will follow up.',
  rescheduled: 'This visit was rescheduled.',
};

/**
 * Client visit progress from appointment.status only.
 * Intake, consent, and preparation checklist never advance the operational phase.
 * Space readiness may soften the confirmed headline to "Ready for your visit" without changing phase.
 */
export function clientVisitProgress(appt) {
  const status = appt?.status || 'requested';
  if (['cancelled', 'no_show', 'interrupted', 'safety_hold', 'rescheduled'].includes(status)) {
    return {
      headline: STATUS[status]?.client || status,
      detail: CLIENT_VISIT_DETAIL[status] || '',
      phaseId: status,
      stageIndex: -1,
      stageCount: CLIENT_VISIT_PHASES.length,
      showBar: false,
      operational: true,
    };
  }
  const stageIndex = CLIENT_VISIT_PHASES.findIndex((phase) => phase.statuses.includes(status));
  const phase = CLIENT_VISIT_PHASES[Math.max(0, stageIndex)];
  const spaceReady = Boolean(appt?.readiness?.allReady);
  const headline = phase.id === 'confirmed' && spaceReady ? 'Ready for your visit' : phase.label;
  return {
    headline,
    detail: phase.id === 'confirmed' && spaceReady
      ? 'Your space checklist is saved. Visit progress still waits for your practitioner to prepare or start travel.'
      : CLIENT_VISIT_DETAIL[phase.id],
    phaseId: phase.id,
    stageIndex: Math.max(0, stageIndex),
    stageCount: CLIENT_VISIT_PHASES.length,
    showBar: true,
    operational: true,
  };
}

// Practitioner big-button flow. `nav` = opens SOAP editor instead of transitioning.
export const ACTIONS = [
  { to: 'preparing', label: 'Prepare for Visit', from: ['assigned', 'confirmed'], secondary: true },
  { to: 'en_route', label: 'On My Way', from: ['assigned', 'confirmed', 'preparing'] },
  { to: 'arrived', label: 'Mark Arrived', from: ['en_route'] },
  { to: 'in_session', label: 'Start Treatment', from: ['arrived'] },
  { to: 'in_session', label: 'Resume Session', from: ['interrupted'] },
  { to: 'leaving', label: 'End Visit & Leave', from: ['interrupted'], confirm: 'End this visit without further treatment? Treatment time so far is recorded and cleanup starts.' },
  { to: 'session_ended', label: 'End Treatment', from: ['in_session'], confirm: 'End treatment now? The treatment time is recorded and the cleanup countdown starts.' },
  { to: 'soap', label: 'Complete SOAP Notes', from: ['soap_pending'], nav: true },
  { to: 'leaving', label: 'Leaving Client Location', from: ['soap_pending', 'soap_completed'], confirm: 'Confirm you are leaving the client location.' },
  { to: 'completed', label: 'Finish Visit', from: ['leaving'], confirm: 'Finish this visit? It will move to payment / insurance processing.' },
];

export const PAYMENT_STATUS = {
  unpaid: { label: 'Payment due at visit', tone: 'slate' },
  method_selected: { label: 'Payment method selected', tone: 'slate' },
  insurance_info_pending: { label: 'Insurance information pending', tone: 'amber' },
  claim_submitted: { label: 'Claim not sent — insurer not connected', tone: 'slate' },
  insurer_payment_pending: { label: 'Insurer payment pending', tone: 'cyan' },
  stripe_pending: { label: 'Stripe payment pending', tone: 'cyan' },
  stripe_failed: { label: 'Card payment failed', tone: 'red' },
  payment_failed: { label: 'Card checkout expired — needs review', tone: 'red' },
  deposit_pending: { label: 'Deposit due', tone: 'amber' },
  payment_required: { label: 'Full payment due', tone: 'amber' },
  partially_refunded: { label: 'Partially refunded', tone: 'amber' },
  partially_paid: { label: 'Partially paid', tone: 'amber' },
  fully_paid: { label: 'Fully paid', tone: 'green' },
  refund_pending: { label: 'Refund pending', tone: 'amber' },
  refunded: { label: 'Refunded', tone: 'slate' },
  paid: { label: 'Paid', tone: 'green' },
  info_required: { label: 'Insurance info required', tone: 'amber' },
  ready_for_verification: { label: 'Ready for verification', tone: 'blue' },
  verification_pending: { label: 'Verification pending', tone: 'cyan' },
  direct_billing_available: { label: 'Direct billing available', tone: 'turq' },
  claim_submitted: { label: 'Claim not sent — insurer not connected', tone: 'slate' },
  claim_accepted: { label: 'Insurer connection unavailable', tone: 'slate' },
  partially_covered: { label: 'Partially covered', tone: 'amber' },
  claim_declined: { label: 'Claim declined', tone: 'red' },
  balance_due: { label: 'Client balance due', tone: 'amber' },
};
export const INSURANCE_STATUSES = ['info_required', 'ready_for_verification', 'verification_pending', 'direct_billing_available'];

export const CLAIM_STATUS = {
  none: { label: 'No claim', tone: 'slate' }, info_pending: { label: 'Insurance info pending', tone: 'amber' },
  verification_pending: { label: 'Verification pending', tone: 'cyan' }, submitted: { label: 'Claim submitted', tone: 'cyan' },
  approved: { label: 'Claim approved', tone: 'green' }, partially_approved: { label: 'Claim partially approved', tone: 'amber' },
  declined: { label: 'Claim declined', tone: 'red' },
};

export const fmtClockTime = (d) => d.toLocaleTimeString('en-CA', { timeZone: "America/Edmonton", hour: 'numeric', minute: '2-digit' });

export const RECEPTION_PERMS = [
  ['viewLocations', 'View live practitioner locations'], ['viewEta', 'View ETAs'], ['viewAddresses', 'View appointment addresses'],
  ['assign', 'Assign / reassign practitioners'], ['createBooking', 'Create or reschedule bookings'], ['viewInsuranceStatus', 'View insurance verification status'],
  ['viewInsuranceDocs', 'View insurance documents'], ['managePayments', 'Manage payment statuses'], ['viewHistory', 'Access operational history'],
  ['clinical', 'Access clinical information (restricted by default)'],
];

export const LOCATION_TYPES = [
  { id: 'home', label: 'My Home' }, { id: 'office', label: 'My Office' }, { id: 'hotel', label: 'Hotel' },
  { id: 'event', label: 'Event Location' }, { id: 'clinic', label: 'In Clinic' },
];

export function clinicBookable(clinic) {
  if (clinic?.enabled !== true) return false;
  const address = String(clinic.address || '').trim();
  if (!address || address.includes('[') || /to be supplied/i.test(address)) return false;
  return true;
}

export function paymentQueues(appointments) {
  const pending = [];
  const deposits = [];
  const review = [];
  for (const appt of appointments || []) {
    if (appt.status === 'cancelled' || appt.status === 'no_show') continue;
    const due = appt.paymentDue || {};
    const balance = Number(appt.settle?.balance || 0);
    const remaining = Number(due.remainingCents || 0);
    if (due.status === 'payment_failed' || appt.paymentStatus === 'stripe_failed') review.push(appt);
    else if (due.status === 'partially_paid' || due.status === 'partially_refunded' || appt.paymentStatus === 'partially_paid') deposits.push(appt);
    else if (remaining > 0 || balance > 0) pending.push(appt);
  }
  return { pending, deposits, review };
}

export function paymentChoice(draft, settings) {
  const policy = settings?.paymentPolicy || {};
  const cardsOn = settings?.cardCheckoutEnabled === true;
  const cashOn = policy.cashAccepted === true;
  const mode = policy.mode || 'full';
  const allowed = [];
  if (cardsOn && mode === 'choice') allowed.push('deposit', 'full');
  else {
    if (cardsOn && mode !== 'deposit') allowed.push('full');
    if (cardsOn && mode !== 'full') allowed.push('deposit');
  }
  if (cashOn) allowed.push('cash');
  if (draft?.payNow && allowed.includes(draft.payNow)) return draft.payNow;
  if (!cardsOn && cashOn) return 'cash';
  return allowed[0] || '';
}

export const INSURERS = ['Alberta Blue Cross', 'Canada Life', 'Sun Life', 'Manulife', 'Green Shield Canada', 'Desjardins', 'Other'];

export const CLINIC_POINT = { lat: 53.5461, lng: -113.4938 };

export const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
export const pad = (n) => String(n).padStart(2, '0');
// Business day in Edmonton, regardless of the device timezone.
const edmontonMinutes = (d) => { const [h, mi] = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Edmonton', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).split(':').map(Number); return h * 60 + mi; };
export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const fmtDate = (iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', opts);
export const fmtTime = (hhmm) => { if (!hhmm) return ''; const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`; };
export const fmtStamp = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { timeZone: "America/Edmonton", hour: 'numeric', minute: '2-digit', timeZone: 'America/Edmonton' }) : '—');
export const endTime = (hhmm, dur) => { const [h, m] = hhmm.split(':').map(Number); const t = h * 60 + m + Number(dur); return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`; };
export const fullName = (c) => (c ? `${c.preferredName || c.firstName} ${c.lastName}` : 'Guest');

export function distanceKm(a, b) {
  const R = 6371, r = (x) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function zoneFor(point, zones, center = CLINIC_POINT) {
  if (!point) return null;
  const km = distanceKm(center, point);
  const z = [...zones].filter((x) => x.enabled).sort((a, b) => a.radiusKm - b.radiusKm).find((x) => km <= x.radiusKm);
  return { zone: z || null, km };
}

/** Travel fees stay off unless the owner enables them under Booking → Service Coverage. */
export function travelFeesEnabled(settings) {
  const cov = settings?.serviceCoverage;
  if (cov && Object.prototype.hasOwnProperty.call(cov, "travelFeesEnabled")) {
    return !!cov.travelFeesEnabled;
  }
  return false;
}

export const travelMinutes = (km) => Math.round(8 + km * 2.2);

export function staffActor(user) {
  return user?.name || user?.email || "Staff";
}

function finitePoint(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { lat: latitude, lng: longitude };
}

export function isClinicVisit(appt) {
  return appt?.locationType === "clinic" || appt?.location === "clinic";
}

/** Mobile visits are eligible for Track Visit live travel; clinic visits are summary-only. */
export function isMobileTrackable(appt) {
  return !!appt && !isClinicVisit(appt);
}

/**
 * Client Track Visit view states (A–E) plus terminal overlays.
 * Live map/ETA belong only to en_route when trip.sharing is on — enforced by the Track Visit page.
 */
export function trackVisitView(appt) {
  const status = appt?.status || "requested";
  if (["cancelled", "no_show"].includes(status)) return "cancelled";
  if (status === "rescheduled") return "rescheduled";
  if (["interrupted", "safety_hold"].includes(status)) return status;
  if (["requested", "confirmed", "assigned", "preparing", "reassigned"].includes(status)) return "confirmed";
  if (status === "en_route" || status === "delayed") return "en_route";
  if (status === "arrived") return "arrived";
  if (status === "in_session") return "in_session";
  if (["session_ended", "soap_pending", "soap_completed", "leaving", "completed", "processing", "closed"].includes(status)) return "completed";
  return "confirmed";
}

export function visitNavigationPoint(appt) {
  const address = appt?.address || {};
  if (appt?.locationType === "clinic") {
    if (address.navigation !== "ready") return null;
    return finitePoint(address.lat, address.lng);
  }
  const arrival = address.arrival && typeof address.arrival === "object" ? finitePoint(address.arrival.lat, address.arrival.lng) : null;
  return arrival || finitePoint(address.lat, address.lng);
}

export function navigationHref(app, point) {
  if (!point) return "";
  const { lat, lng } = point;
  if (app === "apple") return `https://maps.apple.com/?daddr=${lat},${lng}`;
  if (app === "waze") return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function clinicSavePayload(clinic, query, pick) {
  const confirmed = pick?.clientConfirmed && pick.mapboxId ? pick : null;
  const line = String(confirmed?.line || query || "").trim();
  const next = { ...(clinic || {}), address: line, enabled: false };
  delete next.lat;
  delete next.lng;
  delete next.mapboxId;
  delete next.coordinatesVerified;
  delete next.navigation;
  delete next.confirmation;
  if (confirmed) {
    next.confirmation = { mapboxId: confirmed.mapboxId, line: confirmed.line, postal: confirmed.postal || "", clientConfirmed: true };
  }
  return next;
}

const birthdayMonth = (c) => c?.dob && Number(c.dob.split('-')[1]) === new Date().getMonth() + 1;

export function welcomeOfferListed(promo, placement) {
  if (!(promo && promo.enabled && promo.approval === "approved" && promo.eligibility === "first_online")) return false;
  if (!placement) return true;
  const places = Array.isArray(promo.placements) && promo.placements.length ? promo.placements : ["home", "account"];
  return places.includes(placement);
}

/** Placement + owner controls, then server eligibility when the client is identified. */
export function welcomeOfferVisible(promo, placement, eligibility) {
  if (!welcomeOfferListed(promo, placement)) return false;
  if (eligibility?.known === true && eligibility.welcome === false) return false;
  return true;
}

export function promoBannerCopy(promo) {
  if (!promo) return { headline: "Your First Massage, 20% Off.", body: "", cta: "Book my first massage" };
  const value = Number(promo.value) || 0;
  const cap = promo.maxDiscount != null ? Number(promo.maxDiscount) : null;
  const defaultBody = promo.type === "percent"
    ? `Book your first eligible regular massage through the Nabitouch app and enjoy ${value}% off${cap != null ? ` (up to $${cap})` : ""}. Travel and GST are calculated separately.`
    : `${money(value)} off the treatment price of a qualifying first booking. Travel and GST are calculated separately.`;
  return {
    headline: promo.bannerHeadline || promo.name || "Your First Massage, 20% Off.",
    body: promo.bannerBody || defaultBody,
    cta: promo.ctaLabel || "Book my first massage",
  };
}

export function trialCampaignListed(campaign, placement) {
  if (!campaign || campaign.offerKind !== "trial") return false;
  if (campaign.soldOut) return false;
  if (placement === "home" && campaign.showHome === false) return false;
  if (placement === "offers" && campaign.showOffers === false) return false;
  return true;
}

/** Placement + owner controls, then server eligibility when the client is identified. */
export function trialCampaignVisible(campaign, placement, eligibility) {
  if (!trialCampaignListed(campaign, placement)) return false;
  if (campaign.clientEligible === false) return false;
  if (eligibility?.known === true && eligibility.trial === false) return false;
  return true;
}

export function promoEligibility(promo, client, slug) {
  if (!promo.enabled || promo.approval === "pending") return false;
  if (promo.eligibility === "first_online") return false;
  const t = todayISO();
  if (promo.start > t || promo.end < t) return false;
  if (promo.services !== 'all' && !promo.services.includes(slug)) return false;
  if (promo.redemptionLimit && promo.redemptions >= promo.redemptionLimit) return false;
  if (promo.eligibility === 'birthday_month') return !!client && birthdayMonth(client) && (!promo.requiresMarketingConsent || client.marketingConsent);
  return false;
}

// Best single non-stackable promotion wins; stackable ones add on.
export function quote({ service, duration, addons = [], zone, client, promotions = [], settings, locationType, km = 0, serverTravel }) {
  const base = service?.prices?.[String(duration)] || 0;
  const addonList = (settings?.addons || []).filter((a) => addons.includes(a.id));
  const addonsTotal = addonList.reduce((s, a) => s + a.price, 0);
  const calc = (p) => Math.min(p.type === 'percent' ? (base * p.value) / 100 : p.value, p.maxDiscount ?? Infinity, base);
  const eligible = promotions.filter((p) => service && promoEligibility(p, client, service.slug) && p.eligibility !== "first_online");
  const best = eligible.filter((p) => !p.stackable).sort((a, b) => calc(b) - calc(a))[0];
  const applied = [...(best ? [best] : []), ...eligible.filter((p) => p.stackable && p.eligibility !== "first_online")];
  const discount = Math.min(applied.reduce((s, p) => s + calc(p), 0), base);
  const trialVisit = isTrialService(service);
  const feesOn = travelFeesEnabled(settings);
  const localTravel = (locationType === 'clinic' || trialVisit || !feesOn) ? 0 : (zone?.fee || 0) + (Number(zone?.perKm) || 0) * (Number(km) || 0);
  const travel = (locationType === 'clinic' || trialVisit) ? 0 : (typeof serverTravel === 'number' ? (feesOn ? serverTravel : 0) : localTravel);
  const subtotal = base - discount + addonsTotal + travel;
  const tax = Math.round(subtotal * (settings?.gst ?? 0.05) * 100) / 100;
  return {
    base, addons: addonsTotal, addonList: addonList.map((a) => a.name), discount: Math.round(discount * 100) / 100,
    promoId: best?.id || null, promoName: best?.name || null, promoCode: best?.code || null,
    travel, tax, total: Math.round((subtotal + tax) * 100) / 100, treatmentAfterDiscount: base - discount,
  };
}

export function slotsFor(date, practitionerId, appointments, duration) {
  const out = [];
  const now = new Date();
  const busy = appointments.filter((a) => a.date === date && OPEN.concat(DONE).includes(a.status) && (!practitionerId || a.practitionerId === practitionerId));
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  for (let m = 9 * 60; m + Number(duration) <= 20 * 60; m += 30) {
    const t = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    if (date === todayISO() && m < edmontonMinutes(now) + 90) continue;
    const clash = practitionerId && busy.some((a) => m < toMin(a.time) + a.duration + 30 && toMin(a.time) < m + Number(duration) + 30);
    out.push({ time: t, available: !clash });
  }
  return out;
}

export function sessionElapsed(appt, now = Date.now()) {
  const start = appt?.timestamps?.in_session;
  if (!start) return 0;
  const end = appt.timestamps.session_ended ? new Date(appt.timestamps.session_ended).getTime() : appt.timer?.pausedAt ? new Date(appt.timer.pausedAt).getTime() : now;
  return Math.max(0, end - new Date(start).getTime() - (appt.timer?.pausedMs || 0));
}

export const fmtClock = (ms) => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

export const SOAP_LIBRARY = {
  S: ['Low back tightness', 'Neck stiffness', 'Shoulder tension', 'Headaches (tension-type)', 'Desk work 8h+', 'Post-run soreness', 'Poor sleep', 'General stress', 'No changes since last visit', 'New injury reported'],
  O: ['Hypertonic upper trapezius', 'Reduced cervical ROM', 'Reduced lumbar flexion', 'Trigger point — levator scapulae', 'Tender on palpation', 'Guarding observed', 'Postural: forward head', 'No contraindications observed'],
  A: ['Responded well to treatment', 'Tension reduced post-treatment', 'ROM improved post-treatment', 'Progressing toward goals', 'No adverse response', 'Referral may be considered'],
  P: ['Rebook in 1 week', 'Rebook in 2 weeks', 'Rebook in 3 weeks', 'Heat at home', 'Gentle stretching', 'Hydrate', 'Posture breaks hourly', 'Re-assess next visit'],
};
export const SOAP_TEMPLATES = [
  { id: 'relax', name: 'Relaxation visit', S: ['General stress'], O: ['No contraindications observed'], A: ['No adverse response'], P: ['Hydrate', 'Rebook in 3 weeks'] },
  { id: 'desk', name: 'Desk-posture tension', S: ['Neck stiffness', 'Desk work 8h+'], O: ['Hypertonic upper trapezius', 'Postural: forward head'], A: ['Tension reduced post-treatment'], P: ['Posture breaks hourly', 'Heat at home'] },
  { id: 'sport', name: 'Sports recovery', S: ['Post-run soreness'], O: ['Tender on palpation'], A: ['ROM improved post-treatment'], P: ['Gentle stretching', 'Rebook in 2 weeks'] },
];
export const BODY_AREAS = [
  { id: 'head', label: 'Head', x: 50, y: 7 }, { id: 'neck', label: 'Neck', x: 50, y: 15 },
  { id: 'l-shoulder', label: 'L shoulder', x: 33, y: 21 }, { id: 'r-shoulder', label: 'R shoulder', x: 67, y: 21 },
  { id: 'upper-back', label: 'Upper back', x: 50, y: 27 }, { id: 'lower-back', label: 'Lower back', x: 50, y: 42 },
  { id: 'l-arm', label: 'L arm', x: 26, y: 36 }, { id: 'r-arm', label: 'R arm', x: 74, y: 36 },
  { id: 'hips', label: 'Hips / glutes', x: 50, y: 52 }, { id: 'l-leg', label: 'L leg', x: 42, y: 70 },
  { id: 'r-leg', label: 'R leg', x: 58, y: 70 }, { id: 'feet', label: 'Feet', x: 50, y: 93 },
];
export const GOALS = ['Relaxation', 'Stress relief', 'Chronic tension', 'Training recovery', 'Mobility', 'Pregnancy comfort', 'Better sleep', 'Gentle comfort'];
export const FOCUS = ['Neck', 'Shoulders', 'Upper back', 'Lower back', 'Arms & hands', 'Legs', 'Feet', 'Scalp'];

export function publicBio(bio) {
  return String(bio || "").replace(/\s*\(demo persona\)\s*/gi, " ").replace(/\s+([.,])/g, "$1").replace(/\s+/g, " ").trim();
}

export function bookedByWeek(appointments) {
  const buckets = new Map();
  for (const visit of appointments || []) {
    if (!visit?.date || ["cancelled", "no_show"].includes(visit.status)) continue;
    const [year, month, day] = visit.date.split("-").map(Number);
    if (!year || !month || !day) continue;
    const date = new Date(Date.UTC(year, month - 1, day));
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) || 0) + Number(visit.pricing?.total || 0));
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-8)
    .map(([week, revenue]) => ({ week: week.slice(5), revenue: Math.round(revenue) }));
}
