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
    return { ...empty(), ...parsed, guest: { ...empty().guest, ...(parsed.guest || {}) } };
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
export function addressSelectionPatch(address, { query, forceWhere } = {}) {
  const patch = {
    address: address || null,
    addressQuery: query != null ? query : (address?.line || ""),
    date: null,
    time: null,
  };
  if (forceWhere !== undefined) patch.forceWhere = forceWhere;
  return patch;
}

/** Rebook lands on When only when the address is already confirmed. */
export function rebookStepForAddress(address, { locationType } = {}) {
  if (locationType === "clinic") return 2;
  return addressReady(address) ? 2 : 0;
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
