import { clinicBookable, clinicSavePayload, paymentChoice, paymentQueues } from "./domain";

test("an edited clinic address does not keep the old coordinates", () => {
  const clinic = { enabled: true, address: "10150 104 St NW, Edmonton, AB", lat: 53.5461, lng: -113.4938, coordinatesVerified: true, mobileEnabled: true };
  const changed = clinicSavePayload(clinic, "8882 170 St NW, Edmonton, AB", null);
  expect(changed.address).toBe("8882 170 St NW, Edmonton, AB");
  expect(changed.lat).toBeUndefined();
  expect(changed.lng).toBeUndefined();
  expect(changed.confirmation).toBeUndefined();
  expect(changed.enabled).toBe(false);
  const confirmed = clinicSavePayload(clinic, "typed", { clientConfirmed: true, mapboxId: "local-west", line: "8882 170 St NW, Edmonton, AB", postal: "T5T 4J2" });
  expect(confirmed.confirmation).toEqual({ mapboxId: "local-west", line: "8882 170 St NW, Edmonton, AB", postal: "T5T 4J2", clientConfirmed: true });
  expect(confirmed.lat).toBeUndefined();
});

test("a placeholder clinic address is not offered", () => {
  expect(clinicBookable({ enabled: true, address: "[Clinic address — to be supplied]" })).toBe(false);
  expect(clinicBookable({ enabled: false, address: "10150 104 St NW, Edmonton, AB" })).toBe(false);
  expect(clinicBookable({ enabled: true, address: "10150 104 St NW, Edmonton, AB" })).toBe(true);
});

test("mode none books without a required online payment", () => {
  const settings = { cardCheckoutEnabled: false, paymentPolicy: { mode: "none", cashAccepted: true } };
  expect(paymentChoice({}, settings)).toBe("none");
  expect(paymentChoice({ payNow: "cash" }, settings)).toBe("cash");
  expect(paymentChoice({ payNow: "deposit" }, settings)).toBe("none");
});

test("mode none keeps optional full payment when Stripe is on", () => {
  const settings = { cardCheckoutEnabled: true, paymentPolicy: { mode: "none", cashAccepted: false } };
  expect(paymentChoice({}, settings)).toBe("none");
  expect(paymentChoice({ payNow: "full" }, settings)).toBe("full");
});

test("cash is not treated as an online prepayment when card checkout is off", () => {
  const settings = { cardCheckoutEnabled: false, paymentPolicy: { mode: "choice", cashAccepted: true } };
  expect(paymentChoice({ payNow: "deposit" }, settings)).toBe("cash");
  expect(paymentChoice({ payNow: "cash" }, settings)).toBe("cash");
});

test("deposit and full modes require a card choice when Stripe is on", () => {
  expect(paymentChoice({}, { cardCheckoutEnabled: true, paymentPolicy: { mode: "deposit", cashAccepted: false } })).toBe("deposit");
  expect(paymentChoice({}, { cardCheckoutEnabled: true, paymentPolicy: { mode: "full", cashAccepted: false } })).toBe("full");
  expect(paymentChoice({ payNow: "full" }, { cardCheckoutEnabled: true, paymentPolicy: { mode: "deposit", cashAccepted: false } })).toBe("deposit");
});

test("the owner queue separates cash, deposits, and expired card checkouts", () => {
  const queues = paymentQueues([
    { id: "cash", status: "requested", payNow: "cash", paymentStatus: "method_selected", paymentDue: { remainingCents: 10080, status: "unpaid" }, settle: { balance: 100.8 } },
    { id: "deposit", status: "confirmed", paymentStatus: "partially_paid", paymentDue: { remainingCents: 7560, status: "partially_paid" }, settle: { balance: 75.6 } },
    { id: "expired", status: "requested", paymentStatus: "method_selected", paymentDue: { remainingCents: 2520, status: "payment_failed" }, settle: { balance: 100.8 } },
    { id: "paid", status: "completed", paymentStatus: "fully_paid", paymentDue: { remainingCents: 0, status: "paid" }, settle: { balance: 0 } },
    { id: "cancelled", status: "cancelled", paymentDue: { remainingCents: 10080, status: "unpaid" }, settle: { balance: 100.8 } },
  ]);
  expect(queues.pending.map((row) => row.id)).toEqual(["cash"]);
  expect(queues.deposits.map((row) => row.id)).toEqual(["deposit"]);
  expect(queues.review.map((row) => row.id)).toEqual(["expired"]);
});

test("legacy customer choice keeps full payment and the deposit when card checkout is on", () => {
  const settings = { cardCheckoutEnabled: true, paymentPolicy: { mode: "choice", cashAccepted: true } };
  expect(paymentChoice({}, settings)).toBe("deposit");
  expect(paymentChoice({ payNow: "full" }, settings)).toBe("full");
  expect(paymentChoice({ payNow: "cash" }, settings)).toBe("cash");
});
