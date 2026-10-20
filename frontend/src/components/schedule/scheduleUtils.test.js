import { describe, expect, it } from "vitest";
import {
  conflictingAppointments,
  dayAvailabilityTone,
  dayKnown,
  isClinicVisit,
  rangeForView,
  validateTimeRange,
  visitPlaceLabel,
  workingWindow,
} from "./scheduleUtils";

describe("scheduleUtils", () => {
  it("classifies clinic vs mobile without relying on color", () => {
    expect(isClinicVisit({ locationType: "clinic" })).toBe(true);
    expect(isClinicVisit({ locationType: "home" })).toBe(false);
    expect(visitPlaceLabel({ locationType: "clinic" })).toBe("Clinic");
    expect(visitPlaceLabel({ locationType: "home" })).toBe("Mobile");
  });

  it("validates start and end times", () => {
    expect(validateTimeRange("", "10:00")).toMatch(/start and end/i);
    expect(validateTimeRange("10:00", "09:00")).toMatch(/after start/i);
    expect(validateTimeRange("09:00", "17:00")).toBe("");
  });

  it("builds day and week ranges", () => {
    expect(rangeForView("day", "2026-10-20")).toEqual(["2026-10-20", "2026-10-20"]);
    expect(rangeForView("week", "2026-10-20")[0]).toBe("2026-10-19");
  });

  it("derives working window and appointment conflicts", () => {
    expect(workingWindow([
      { state: "available", start: "09:00", end: "12:00" },
      { state: "available", start: "13:00", end: "17:00" },
    ])).toEqual({ start: "09:00", end: "17:00" });

    const conflicts = conflictingAppointments(
      [{ id: "1", date: "2026-10-20", time: "10:00", duration: 60, ref: "NT-1" }],
      "2026-10-20",
      "09:30",
      "10:30",
      false
    );
    expect(conflicts).toHaveLength(1);
  });

  it("marks unknown days as pending instead of Off", () => {
    expect(dayKnown([{ date: "2026-10-20", segments: [] }], "2026-10-20")).toBe(true);
    expect(dayKnown([{ date: "2026-10-20", segments: [] }], "2026-10-21")).toBe(false);
    expect(dayAvailabilityTone([], { known: false })).toBe("pending");
    expect(dayAvailabilityTone([], { known: true })).toBe("off");
  });
});
