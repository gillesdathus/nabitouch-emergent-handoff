/** Wizard indices after Duration was split from Service (bookingFlowVersion 2). */
export const BOOKING_STEP = {
  WHERE: 0,
  SERVICE: 1,
  DURATION: 2,
  WHEN: 3,
  YOU: 4,
  PAYMENT: 5,
  REVIEW: 6,
};

export const BOOKING_FLOW_VERSION = 2;

export function bookingFlowLabels(trialFlow) {
  return trialFlow
    ? ["Where", "Service", "Duration", "When", "You", "Review"]
    : ["Where", "Service", "Duration", "When", "You", "Payment", "Review"];
}

export function bookingReviewStep(trialFlow) {
  return trialFlow ? BOOKING_STEP.YOU + 1 : BOOKING_STEP.REVIEW;
}

/** True when every gate before `target` is satisfied (blocks skipping Payment / Review). */
export function canJumpBookingStep(currentStep, target, ok) {
  if (target <= currentStep) return true;
  if (target < 0) return false;
  for (let i = 0; i < target; i += 1) {
    if (!ok[i]) return false;
  }
  return true;
}

const LOCATION_TYPE_IDS = new Set(["home", "office", "hotel", "event", "clinic"]);

/** Never leave locationType undefined / unknown — defaults to home. */
export function normalizeLocationType(locationType, { trialFlow = false, clinicAllowed = true } = {}) {
  const id = LOCATION_TYPE_IDS.has(locationType) ? locationType : "home";
  if (id === "clinic" && (trialFlow || !clinicAllowed)) return "home";
  return id;
}

export function locationTypeBookingLabel(locationType) {
  const labels = {
    home: "Home",
    office: "Office",
    hotel: "Hotel",
    event: "Event Location",
    clinic: "In Clinic",
  };
  return labels[normalizeLocationType(locationType)] || "Home";
}

/** Remap pre-Duration-step drafts so session restores land on the right screen. */
export function migrateBookingDraft(draft) {
  if (!draft || typeof draft !== "object") return draft;
  const version = Number(draft.bookingFlowVersion) || 1;
  if (version >= BOOKING_FLOW_VERSION) {
    return { ...draft, bookingFlowVersion: BOOKING_FLOW_VERSION, locationType: normalizeLocationType(draft.locationType) };
  }
  // v1: Where0 Service1 When2 You3 Pay4 Review5 → insert Duration at 2
  let step = Number(draft.step) || 0;
  if (step >= 2) step += 1;
  return {
    ...draft,
    step,
    bookingFlowVersion: BOOKING_FLOW_VERSION,
    locationType: normalizeLocationType(draft.locationType),
  };
}

/** Resolve a catalogue service by stable id or slug. */
export function resolveCatalogueService(services, key) {
  const needle = String(key || "").trim();
  if (!needle || !Array.isArray(services)) return null;
  return services.find((service) => service.id === needle || service.slug === needle) || null;
}

export function defaultDurationMinutes(service) {
  const keys = Object.keys(service?.prices || {});
  if (keys.includes("60")) return 60;
  return keys.length ? Number(keys[0]) : 60;
}

/**
 * Patch fields when a treatment is selected or changed.
 * Clears slot, checkout, and amount side-effects so pricing is revalidated server-side.
 */
export function serviceSelectionPatch(service, draft = {}, { preserveDuration = false } = {}) {
  if (!service) return {};
  const keepDuration = preserveDuration && service.prices?.[String(draft.duration)];
  return {
    serviceId: service.id || null,
    serviceSlug: service.slug || null,
    duration: keepDuration ? Number(draft.duration) : defaultDurationMinutes(service),
    addons: [],
    time: null,
    practitionerId: "",
    useCredit: false,
    useWinback: false,
    idempotencyKey: undefined,
    checkoutSessionId: null,
    checkoutAmountCents: null,
    invoiceId: null,
    depositCents: null,
    payNow: undefined,
  };
}

export function bookingPathForService(service) {
  if (service?.id) return `/book?service=${encodeURIComponent(service.id)}`;
  if (service?.slug) return `/book?service=${encodeURIComponent(service.slug)}`;
  return "/book";
}

/** Completed visits must use reschedule/modify flows, not the initial book wizard. */
export function isLockedBookingAppointment(appointment) {
  if (!appointment) return false;
  const status = String(appointment.status || "").toLowerCase();
  if (["completed", "cancelled", "canceled", "no_show", "noshow", "voided"].includes(status)) return true;
  if (appointment.checkedOut || appointment.completedAt) return true;
  return false;
}

export const BOOKING_DRAFT_KEY = "nt_booking_draft_v1";

export function readStoredBookingDraft(empty) {
  if (typeof sessionStorage === "undefined") return empty();
  try {
    const raw = sessionStorage.getItem(BOOKING_DRAFT_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return empty();
    const merged = { ...empty(), ...parsed, guest: { ...empty().guest, ...(parsed.guest || {}) } };
    return migrateBookingDraft(merged);
  } catch {
    return empty();
  }
}

export function writeStoredBookingDraft(draft) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* quota / private mode — draft stays in memory */
  }
}

export function clearStoredBookingDraft() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(BOOKING_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** De-facto primary: first saved profile address (no separate primary flag). */
export function primaryAddress(me) {
  const list = me?.addresses;
  if (!Array.isArray(list) || !list.length) return null;
  return list[0];
}

/** Confirmed civic address ready for mobile booking / slot recommendations. */
export function addressReady(addr) {
  return !!(
    addr
    && addr.clientConfirmed === true
    && addr.confidence === "address"
    && String(addr.line || "").trim()
    && addr.lat != null
    && addr.lng != null
  );
}

/** Prefer a confirmed saved address; otherwise the primary (first) row. */
export function preferredBookingAddress(me) {
  const list = me?.addresses;
  if (!Array.isArray(list) || !list.length) return null;
  return list.find((row) => addressReady(row)) || list[0];
}

/**
 * Apply a draft address change and clear travel-dependent slot picks.
 * Does not PATCH the client profile — appointment address is draft-only until explicit save.
 */
export function addressSelectionPatch(address, { query, forceWhere, preserveQuery = false } = {}) {
  const patch = {
    address: address || null,
    date: null,
    time: null,
  };
  // When clearing a resolved pick during typing, keep the live search string (C1).
  if (!preserveQuery) {
    patch.addressQuery = query != null ? query : (address?.line || "");
  }
  if (forceWhere !== undefined) patch.forceWhere = forceWhere;
  return patch;
}

/** Rebook lands on When only when the address is already confirmed. */
export function rebookStepForAddress(address, { locationType } = {}) {
  if (locationType === "clinic") return BOOKING_STEP.WHEN;
  return addressReady(address) ? BOOKING_STEP.WHEN : BOOKING_STEP.WHERE;
}

/** Confirm a saved address via /geo/confirm without adding it to the profile. */
export async function confirmAddressForBooking(api, address) {
  if (!address?.line) return { ok: false, address: address || null };
  const checked = await api.geoConfirm({
    line: address.line,
    mapboxId: address.mapboxId,
    postal: address.postal || "",
    unit: address.unit || "",
    clientConfirmed: true,
  });
  const approximate = checked.confidence && checked.confidence !== "address";
  if (!checked.accepted || approximate) {
    return {
      ok: false,
      address: {
        ...address,
        clientConfirmed: false,
        confidence: checked.confidence,
        line: checked.line || address.line,
      },
    };
  }
  return {
    ok: true,
    address: {
      ...address,
      line: checked.line,
      unit: address.unit || "",
      lat: checked.lat,
      lng: checked.lng,
      mapboxId: checked.mapboxId || address.mapboxId,
      postal: checked.postalNormalized || address.postal,
      zoneId: checked.zone?.id || address.zoneId,
      clientConfirmed: true,
      confidence: checked.confidence,
      travelFee: checked.travel,
      quoted: true,
    },
  };
}
