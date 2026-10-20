import { describe, expect, test } from "vitest";
import {
  formatKm,
  hhmmFromMinutes,
  isMobileRouteStop,
  isRoadLeg,
  leaveByMinutes,
  minutesFromHhmm,
  navHrefForStop,
  providerLabel,
  roadRoutesFromStops,
  routePolyline,
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
    expect(providerLabel("unavailable")).toMatch(/unavailable/i);
    expect(formatKm(8.4)).toBe("8.4 km");
  });
});

describe("road geometry helpers", () => {
  const roadLeg = {
    available: true,
    provider: "mapbox",
    minutes: 24,
    km: 15.2,
    geometry: {
      type: "LineString",
      coordinates: [
        [-113.4938, 53.5461],
        [-113.4901, 53.5461],
        [-113.4901, 53.5498],
        [-113.4802, 53.5532],
      ],
    },
  };

  test("decodes GeoJSON LineString for LiveMap", () => {
    const line = routePolyline(roadLeg);
    expect(line).toHaveLength(4);
    expect(line[0]).toEqual({ lat: 53.5461, lng: -113.4938 });
    expect(isRoadLeg(roadLeg)).toBe(true);
  });

  test("rejects unavailable and geometry-less estimates", () => {
    expect(isRoadLeg({ available: false, provider: "unavailable", minutes: 40 })).toBe(false);
    expect(routePolyline({ available: true, provider: "mapbox", minutes: 10, geometry: null })).toBeNull();
    expect(roadRoutesFromStops([
      { leg: roadLeg },
      { leg: { available: false, provider: "unavailable" } },
    ])).toHaveLength(1);
  });
});
