import { vi } from "vitest";
import {
  BOOKING_DRAFT_KEY,
  BOOKING_STEP,
  addressReady,
  addressSelectionPatch,
  bookingAddressComplete,
  bookingPathForService,
  canJumpBookingStep,
  clearStoredBookingDraft,
  confirmAddressForBooking,
  defaultDurationMinutes,
  isLockedBookingAppointment,
  migrateBookingDraft,
  normalizeLocationType,
  preferredBookingAddress,
  primaryAddress,
  readStoredBookingDraft,
  rebookStepForAddress,
  resolveCatalogueService,
  serviceSelectionPatch,
  writeStoredBookingDraft,
} from "./booking-selection";

const swedish = {
  id: "svc-swedish",
  slug: "swedish",
  prices: { 30: 70, 60: 120, 90: 160 },
};

const prenatal = {
  id: "svc-prenatal",
  slug: "prenatal",
  prices: { 60: 130, 90: 170 },
};

test("resolves catalogue services by stable id or slug", () => {
  const list = [swedish, prenatal];
  expect(resolveCatalogueService(list, "svc-swedish")).toBe(swedish);
  expect(resolveCatalogueService(list, "prenatal")).toBe(prenatal);
  expect(resolveCatalogueService(list, "missing")).toBeNull();
});

test("booking path uses the stable service id", () => {
  expect(bookingPathForService(swedish)).toBe("/book?service=svc-swedish");
  expect(bookingPathForService(null)).toBe("/book");
});

test("default duration prefers 60 minutes when available", () => {
  expect(defaultDurationMinutes(swedish)).toBe(60);
  expect(defaultDurationMinutes({ prices: { 45: 95 } })).toBe(45);
});

test("changing treatment clears slot and stale checkout amounts", () => {
  const patch = serviceSelectionPatch(prenatal, {
    serviceSlug: "swedish",
    duration: 90,
    time: "14:00",
    practitionerId: "p-maya",
    addons: ["hot-stones"],
    checkoutSessionId: "cs_test_old",
    checkoutAmountCents: 3150,
    depositCents: 3150,
    invoiceId: "inv-old",
    idempotencyKey: "old-key",
    useCredit: true,
  });
  expect(patch.serviceId).toBe("svc-prenatal");
  expect(patch.serviceSlug).toBe("prenatal");
  expect(patch.duration).toBe(60);
  expect(patch.time).toBeNull();
  expect(patch.practitionerId).toBe("");
  expect(patch.addons).toEqual([]);
  expect(patch.checkoutSessionId).toBeNull();
  expect(patch.checkoutAmountCents).toBeNull();
  expect(patch.depositCents).toBeNull();
  expect(patch.invoiceId).toBeNull();
  expect(patch.idempotencyKey).toBeUndefined();
  expect(patch.useCredit).toBe(false);
});

test("preserveDuration keeps a price point that exists on the new service", () => {
  const patch = serviceSelectionPatch(prenatal, { duration: 90 }, { preserveDuration: true });
  expect(patch.duration).toBe(90);
});

test("completed appointments are locked out of the initial booking flow", () => {
  expect(isLockedBookingAppointment({ status: "completed" })).toBe(true);
  expect(isLockedBookingAppointment({ status: "cancelled" })).toBe(true);
  expect(isLockedBookingAppointment({ status: "assigned" })).toBe(false);
  expect(isLockedBookingAppointment({ status: "requested" })).toBe(false);
});

test("booking draft persists in sessionStorage across refresh", () => {
  sessionStorage.clear();
  const empty = () => ({ step: 0, bookingFlowVersion: 2, serviceSlug: null, guest: { firstName: "" } });
  writeStoredBookingDraft({ step: BOOKING_STEP.DURATION, bookingFlowVersion: 2, serviceId: "svc-swedish", serviceSlug: "swedish", guest: { firstName: "Ada" } });
  expect(sessionStorage.getItem(BOOKING_DRAFT_KEY)).toBeTruthy();
  const restored = readStoredBookingDraft(empty);
  expect(restored.step).toBe(BOOKING_STEP.DURATION);
  expect(restored.serviceId).toBe("svc-swedish");
  expect(restored.guest.firstName).toBe("Ada");
  clearStoredBookingDraft();
  expect(readStoredBookingDraft(empty).serviceSlug).toBeNull();
});

const homeReady = {
  id: "ad-home",
  label: "Home",
  line: "10150 104 St NW, Edmonton",
  lat: 53.54,
  lng: -113.49,
  clientConfirmed: true,
  confidence: "address",
};
const officeStale = {
  id: "ad-office",
  label: "Office",
  line: "10060 Jasper Ave, Edmonton",
  lat: 53.54,
  lng: -113.5,
  clientConfirmed: false,
};

test("primaryAddress is the first saved row", () => {
  expect(primaryAddress(null)).toBeNull();
  expect(primaryAddress({ addresses: [] })).toBeNull();
  expect(primaryAddress({ addresses: [homeReady, officeStale] })).toBe(homeReady);
});

test("addressReady requires confirmed civic coordinates", () => {
  expect(addressReady(homeReady)).toBe(true);
  expect(addressReady(officeStale)).toBe(false);
  expect(addressReady({ ...homeReady, confidence: "place" })).toBe(false);
  expect(addressReady({ ...homeReady, lat: null })).toBe(false);
  expect(addressReady(null)).toBe(false);
});

test("bookingAddressComplete requires detailsSettled for this booking", () => {
  expect(bookingAddressComplete(homeReady)).toBe(false);
  expect(bookingAddressComplete({ ...homeReady, detailsSettled: true })).toBe(true);
  expect(bookingAddressComplete({ ...homeReady, detailsSettled: false })).toBe(false);
  expect(bookingAddressComplete(officeStale)).toBe(false);
});

test("preferredBookingAddress prefers a confirmed row over an unconfirmed primary", () => {
  expect(preferredBookingAddress({ addresses: [officeStale, homeReady] })).toBe(homeReady);
  expect(preferredBookingAddress({ addresses: [officeStale] })).toBe(officeStale);
  expect(preferredBookingAddress({ addresses: [] })).toBeNull();
  expect(preferredBookingAddress(null)).toBeNull();
});

test("addressSelectionPatch clears travel-dependent slot picks without touching profile", () => {
  const patch = addressSelectionPatch(homeReady, { forceWhere: true });
  expect(patch.address).toBe(homeReady);
  expect(patch.addressQuery).toBe(homeReady.line);
  expect(patch.date).toBeNull();
  expect(patch.time).toBeNull();
  expect(patch.forceWhere).toBe(true);
  expect(addressSelectionPatch(null, { query: "" }).address).toBeNull();
  const keepQuery = addressSelectionPatch(null, { forceWhere: true, preserveQuery: true });
  expect(keepQuery.address).toBeNull();
  expect(keepQuery.addressQuery).toBeUndefined();
});

test("rebookStepForAddress lands on When only when civic + details are complete", () => {
  expect(rebookStepForAddress(homeReady)).toBe(BOOKING_STEP.WHERE);
  expect(rebookStepForAddress({ ...homeReady, detailsSettled: true })).toBe(BOOKING_STEP.WHEN);
  expect(rebookStepForAddress(officeStale)).toBe(BOOKING_STEP.WHERE);
  expect(rebookStepForAddress(null)).toBe(BOOKING_STEP.WHERE);
  expect(rebookStepForAddress(null, { locationType: "clinic" })).toBe(BOOKING_STEP.WHEN);
});

test("migrateBookingDraft inserts Duration step for v1 session drafts", () => {
  const migrated = migrateBookingDraft({ step: 2, bookingFlowVersion: 1, locationType: "home" });
  expect(migrated.step).toBe(BOOKING_STEP.WHEN);
  expect(migrated.bookingFlowVersion).toBe(2);
  expect(migrateBookingDraft({ step: 1, bookingFlowVersion: 1 }).step).toBe(BOOKING_STEP.SERVICE);
});

test("normalizeLocationType never returns undefined", () => {
  expect(normalizeLocationType(undefined)).toBe("home");
  expect(normalizeLocationType("clinic", { trialFlow: true })).toBe("home");
  expect(normalizeLocationType("clinic", { clinicAllowed: false })).toBe("home");
  expect(normalizeLocationType("hotel")).toBe("hotel");
});

test("canJumpBookingStep blocks Review when Payment gate fails", () => {
  const ok = [true, true, true, true, true, false];
  expect(canJumpBookingStep(4, BOOKING_STEP.REVIEW, ok)).toBe(false);
  expect(canJumpBookingStep(4, BOOKING_STEP.PAYMENT, ok)).toBe(true);
  expect(canJumpBookingStep(5, BOOKING_STEP.REVIEW, [...ok.slice(0, 5), true])).toBe(true);
});

test("confirmAddressForBooking maps a successful geo confirm onto the draft address", async () => {
  const api = {
    geoConfirm: vi.fn().mockResolvedValue({
      accepted: true,
      confidence: "address",
      line: "10150 104 Street NW, Edmonton, AB",
      lat: 53.541,
      lng: -113.491,
      mapboxId: "mapbox.1",
      travel: 15,
      zone: { id: "z-core" },
      postalNormalized: "T5J0Z2",
    }),
  };
  const result = await confirmAddressForBooking(api, officeStale);
  expect(result.ok).toBe(true);
  expect(result.address.clientConfirmed).toBe(true);
  expect(result.address.confidence).toBe("address");
  expect(result.address.travelFee).toBe(15);
  expect(result.address.quoted).toBe(true);
  expect(result.address.id).toBe("ad-office");
  expect(api.geoConfirm).toHaveBeenCalledOnce();
});

test("confirmAddressForBooking rejects approximate results without marking confirmed", async () => {
  const api = {
    geoConfirm: vi.fn().mockResolvedValue({
      accepted: false,
      confidence: "place",
      line: "Edmonton",
    }),
  };
  const result = await confirmAddressForBooking(api, officeStale);
  expect(result.ok).toBe(false);
  expect(result.address.clientConfirmed).toBe(false);
});

test("clearing the stored draft removes prior client address from session (logout path)", () => {
  sessionStorage.clear();
  writeStoredBookingDraft({
    step: 1,
    address: homeReady,
    addressQuery: homeReady.line,
    guest: { firstName: "" },
  });
  clearStoredBookingDraft();
  const empty = () => ({ step: 0, address: null, addressQuery: "", guest: { firstName: "" } });
  const restored = readStoredBookingDraft(empty);
  expect(restored.address).toBeNull();
  expect(restored.step).toBe(0);
});
