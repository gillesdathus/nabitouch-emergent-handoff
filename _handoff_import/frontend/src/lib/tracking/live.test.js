import { shouldShowPosition, trackingPhaseCopy, trackingTransportAfterError, trackingTransportForPhase } from "./live";

test("tracking phases distinguish stale, expired, stopped, and completed trips", () => {
  expect(trackingPhaseCopy("live")).toBe("");
  expect(trackingPhaseCopy("stale")).toMatch(/out of date/i);
  expect(trackingPhaseCopy("expired")).toMatch(/expired/i);
  expect(trackingPhaseCopy("stopped")).toMatch(/stopped/i);
  expect(trackingPhaseCopy("completed")).toMatch(/complete/i);
  expect(trackingPhaseCopy("arrived")).toMatch(/arrived/i);
  expect(trackingPhaseCopy("paused")).toMatch(/paused/i);
  expect(trackingPhaseCopy("unavailable")).toMatch(/not available/i);
});

test("a position is shown only while the signal is live or stale", () => {
  expect(shouldShowPosition({ phase: "live", position: { lat: 53.5, lng: -113.5 } })).toBe(true);
  expect(shouldShowPosition({ phase: "stale", position: { lat: 53.5, lng: -113.5 } })).toBe(true);
  expect(shouldShowPosition({ phase: "expired", position: { lat: 53.5, lng: -113.5 } })).toBe(false);
  expect(shouldShowPosition({ phase: "stopped" })).toBe(false);
  expect(shouldShowPosition({ phase: "completed" })).toBe(false);
  expect(shouldShowPosition(null)).toBe(false);
});

test("a dropped stream falls back to polling, and a finished trip stops", () => {
  expect(trackingTransportAfterError()).toBe("poll");
  expect(trackingTransportForPhase("live")).toBe("stream");
  expect(trackingTransportForPhase("stale")).toBe("stream");
  expect(trackingTransportForPhase("expired")).toBe("stop");
  expect(trackingTransportForPhase("stopped")).toBe("stop");
  expect(trackingTransportForPhase("arrived")).toBe("stop");
  expect(trackingTransportForPhase("completed")).toBe("stop");
  expect(trackingTransportForPhase("ended")).toBe("stop");
});
