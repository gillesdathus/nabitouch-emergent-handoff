import { describe, expect, test } from "vitest";
import {
  CANONICAL_PRACTITIONER_ID,
  CANONICAL_PRACTITIONER_NAME,
  designatedTherapist,
  soleTherapistMode,
} from "./domain";

describe("sole therapist booking helpers", () => {
  test("launch roster with only Nabitu uses sole-therapist mode", () => {
    const people = [{ id: CANONICAL_PRACTITIONER_ID, name: CANONICAL_PRACTITIONER_NAME, available: false, bookable: false, onboardingStatus: "draft" }];
    expect(soleTherapistMode(people)).toBe(true);
    expect(designatedTherapist(people).id).toBe(CANONICAL_PRACTITIONER_ID);
  });

  test("multiple bookable therapists disables sole mode", () => {
    const people = [
      { id: CANONICAL_PRACTITIONER_ID, name: CANONICAL_PRACTITIONER_NAME, available: true, bookable: true, onboardingStatus: "approved", profileVisibility: "published" },
      { id: "p-maya", name: "Maya Chen", available: true, bookable: true, onboardingStatus: "approved", profileVisibility: "published" },
    ];
    expect(soleTherapistMode(people)).toBe(false);
  });
});
