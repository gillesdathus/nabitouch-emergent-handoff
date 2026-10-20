import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { navigationHref, visitNavigationPoint } from "@/lib/domain";

const store = { patch: async () => ({}) };

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    idx: { practitioners: { "p-1": { id: "p-1", preferredNavApp: "google" } } },
    practitionerId: "p-1",
    api: store,
  }),
}));

import { NavHandoff } from "./Visit";

const CENTER = "53.5461,-113.4938";

function render(appt) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(createElement(NavHandoff, { appt })); });
  return { host, root };
}

test("a verified clinic visit navigates to its own coordinates", () => {
  const appt = { locationType: "clinic", status: "assigned", address: { line: "8882 170 St NW, Edmonton, AB", lat: 53.5225, lng: -113.6235, navigation: "ready" } };
  expect(visitNavigationPoint(appt)).toEqual({ lat: 53.5225, lng: -113.6235 });
  const { host, root } = render(appt);
  const link = host.querySelector("[data-testid='lifecycle-open-navigation-btn']");
  expect(link.getAttribute("href")).toContain("53.5225,-113.6235");
  expect(link.getAttribute("href")).not.toContain(CENTER);
  expect(link.getAttribute("href")).not.toMatch(/origin=|saddr=/);
  expect(host.querySelector("[data-testid='visit-navigation-handoff-note']").textContent).toContain("does not record a trip start");
  expect(host.querySelector(".flex-wrap")).toBeTruthy();
  act(() => root.unmount());
  host.remove();
});

test("an unverified clinic address stays visible to the caller and hides maps", () => {
  const appt = { locationType: "clinic", address: { line: "8882 170 St NW, Edmonton, AB", lat: 53.5461, lng: -113.4938, navigation: "unavailable" } };
  expect(visitNavigationPoint(appt)).toBeNull();
  const { host, root } = render(appt);
  expect(host.querySelector("[data-testid='visit-navigation-unavailable']").textContent).toBe("Navigation unavailable — clinic address needs verification.");
  expect(host.querySelector("a")).toBeNull();
  act(() => root.unmount());
  host.remove();
});

test("a changed clinic street does not keep a stale pin", () => {
  const appt = { locationType: "clinic", address: { line: "8882 170 St NW, Edmonton, AB", lat: 53.5461, lng: -113.4938 } };
  expect(visitNavigationPoint(appt)).toBeNull();
  expect(navigationHref("google", visitNavigationPoint(appt))).toBe("");
});

test("a mobile visit still navigates to the client arrival pin", () => {
  const appt = { locationType: "home", address: { line: "123 Client St", lat: 53.54, lng: -113.5, arrival: { lat: 53.55, lng: -113.51 } } };
  expect(visitNavigationPoint(appt)).toEqual({ lat: 53.55, lng: -113.51 });
  const { host, root } = render(appt);
  expect(host.querySelector("[data-testid='lifecycle-open-navigation-btn']").getAttribute("href")).toContain("53.55,-113.51");
  expect(host.textContent).not.toContain("clinic address needs verification");
  act(() => root.unmount());
  host.remove();
});

test("missing or malformed coordinates do not build a maps handoff", () => {
  expect(visitNavigationPoint({ locationType: "home", address: { line: "123 Client St" } })).toBeNull();
  expect(visitNavigationPoint({ locationType: "home", address: { line: "123 Client St", lat: "north", lng: -113 } })).toBeNull();
  expect(visitNavigationPoint({ locationType: "clinic", address: { line: "Clinic", navigation: "ready", lat: "north", lng: -113 } })).toBeNull();
  const { host, root } = render({ locationType: "home", address: { line: "123 Client St", lat: "north", lng: -113 } });
  expect(host.querySelector("a")).toBeNull();
  expect(host.textContent).not.toContain("maps");
  act(() => root.unmount());
  host.remove();
});
