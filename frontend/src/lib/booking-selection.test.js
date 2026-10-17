import {
  BOOKING_DRAFT_KEY,
  bookingPathForService,
  clearStoredBookingDraft,
  defaultDurationMinutes,
  isLockedBookingAppointment,
  readStoredBookingDraft,
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
  const empty = () => ({ step: 0, serviceSlug: null, guest: { firstName: "" } });
  writeStoredBookingDraft({ step: 2, serviceId: "svc-swedish", serviceSlug: "swedish", guest: { firstName: "Ada" } });
  expect(sessionStorage.getItem(BOOKING_DRAFT_KEY)).toBeTruthy();
  const restored = readStoredBookingDraft(empty);
  expect(restored.step).toBe(2);
  expect(restored.serviceId).toBe("svc-swedish");
  expect(restored.guest.firstName).toBe("Ada");
  clearStoredBookingDraft();
  expect(readStoredBookingDraft(empty).serviceSlug).toBeNull();
});
