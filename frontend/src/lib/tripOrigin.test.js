import { readTripOrigin, sampleTripNotice, tripOriginMessage } from "./tripOrigin";

const now = Date.parse("2026-10-17T02:00:00Z");

function geo(respond) {
  return { getCurrentPosition: (ok, err) => respond(ok, err) };
}

test("a current fix is the only origin sent to the server", async () => {
  const result = await readTripOrigin(geo((ok) => ok({ coords: { latitude: 53.48, longitude: -113.55, accuracy: 8 }, timestamp: now })), now);
  expect(result.status).toBe("ready");
  expect(result.location.lat).toBe(53.48);
  expect(result.location.lng).toBe(-113.55);
  expect(result.location.recordedAt).toBe("2026-10-17T02:00:00.000Z");
});

test("denied, timed out, invalid and stale fixes are not coordinates", async () => {
  await expect(readTripOrigin(geo((_ok, err) => err({ code: 1 })), now)).resolves.toEqual({ status: "denied" });
  await expect(readTripOrigin(geo((_ok, err) => err({ code: 3 })), now)).resolves.toEqual({ status: "timeout" });
  await expect(readTripOrigin(geo((ok) => ok({ coords: { latitude: 95, longitude: 0, accuracy: 5 }, timestamp: now })), now)).resolves.toEqual({ status: "invalid" });
  await expect(readTripOrigin(geo((ok) => ok({ coords: { latitude: 53.5461, longitude: -113.4938, accuracy: 5 }, timestamp: now - 120000 })), now)).resolves.toEqual({ status: "stale" });
  await expect(readTripOrigin(null, now)).resolves.toEqual({ status: "unavailable" });
});

test("a missing trip origin is named and a maps handoff is not treated as a recorded start", () => {
  expect(tripOriginMessage({ location: "unavailable", to: { lat: 53.52, lng: -113.62 } })).toBe("Current location is unavailable.");
  expect(tripOriginMessage({ location: "gps", from: { lat: 53.48, lng: -113.55 } })).toBe("");
  expect(sampleTripNotice({ simulated: true, sharing: true, from: { lat: 53.5, lng: -113.4 } })).toBe("Sample visit. This is not a live practitioner location.");
  expect(sampleTripNotice({ simulated: true, sharingSource: "practitioner" })).toBe("");
});
