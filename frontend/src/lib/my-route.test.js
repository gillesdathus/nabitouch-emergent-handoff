import { describe, expect, test } from "vitest";
import {
  formatKm,
  hhmmFromMinutes,
  isMobileRouteStop,
  leaveByMinutes,
  minutesFromHhmm,
  navHrefForStop,
  providerLabel,
} from "./my-route";

describe("isMobileRouteStop", () => {
  test("treats missing locationType as mobile", () => {
    expect(isMobileRouteStop({ stop: { id: "a1", position: { lat: 1, lng: 2 } } })).toBe(true);
  });
  test("hides clinic stops", () => {
    expect(isMobileRouteStop({ stop: { id: "c1", locationType: "clinic", position: { lat: 1, lng: 2 } } })).toBe(false);
  });
  test("keeps home hotel office", () => {
    expect(isMobileRouteStop({ stop: { locationType: "home" } })).toBe(true);
    expect(isMobileRouteStop({ stop: { locationType: "hotel" } })).toBe(true);
    expect(isMobileRouteStop({ locationType: "office" })).toBe(true);
  });
});

describe("leave-by math", () => {
  test("subtracts drive setup and travel buffer only", () => {
    const start = minutesFromHhmm("14:00");
    expect(hhmmFromMinutes(leaveByMinutes(start, 25, { setupMin: 10, cleanupMin: 15, travelBufferMin: 10 }))).toBe("13:15");
  });
});

describe("nav and labels", () => {
  test("builds google apple waze hrefs", () => {
    const row = { stop: { id: "a1", position: { lat: 53.54, lng: -113.5 } } };
    expect(navHrefForStop("google", row)).toContain("google.com/maps");
    expect(navHrefForStop("apple", row)).toContain("maps.apple.com");
    expect(navHrefForStop("waze", row)).toContain("waze.com");
  });
  test("formats provider and km", () => {
    expect(providerLabel("mapbox-traffic")).toMatch(/traffic/i);
    expect(formatKm(8.4)).toBe("8.4 km");
  });
});
