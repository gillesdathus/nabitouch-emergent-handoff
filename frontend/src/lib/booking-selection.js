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
