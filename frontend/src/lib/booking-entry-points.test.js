/**
 * Slice 5 — booking entry points must land on the shared /book wizard.
 */
import { describe, expect, test } from "vitest";
import {
  BOOKING_STEP,
  bookingPathForService,
  rebookStepForAddress,
  serviceSelectionPatch,
} from "./booking-selection";

const swedish = { id: "svc-swedish", slug: "swedish", prices: { 60: 120, 90: 160 } };

describe("shared booking entry paths", () => {
  test("catalogue / homepage service deep-link uses stable /book?service=", () => {
    expect(bookingPathForService(swedish)).toBe("/book?service=svc-swedish");
    expect(bookingPathForService({ slug: "prenatal" })).toBe("/book?service=prenatal");
  });

  test("service selection patch clears dependent slot/pricing state", () => {
    const patch = serviceSelectionPatch(swedish, {
      time: "14:00",
      practitionerId: "p-maya",
      checkoutSessionId: "cs_old",
      useCredit: true,
    });
    expect(patch.serviceSlug).toBe("swedish");
    expect(patch.time).toBeNull();
    expect(patch.practitionerId).toBe("");
    expect(patch.checkoutSessionId).toBeNull();
    expect(patch.useCredit).toBe(false);
  });

  test("rebook lands on When when address is ready, otherwise Where", () => {
    const ready = {
      line: "10150 104 St NW",
      clientConfirmed: true,
      confidence: "address",
      lat: 53.5,
      lng: -113.5,
    };
    expect(rebookStepForAddress(ready)).toBe(BOOKING_STEP.WHEN);
    expect(rebookStepForAddress(null)).toBe(BOOKING_STEP.WHERE);
    expect(rebookStepForAddress(null, { locationType: "clinic" })).toBe(BOOKING_STEP.WHEN);
  });
});
