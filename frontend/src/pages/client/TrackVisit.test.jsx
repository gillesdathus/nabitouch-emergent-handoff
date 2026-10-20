import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import TrackVisit from "./TrackVisit";
import { isClinicVisit, isMobileTrackable, trackVisitView } from "@/lib/domain";

const h = vi.hoisted(() => ({
  appt: {
    id: "a-track-1",
    clientId: "c-1",
    ref: "NT-100",
    status: "confirmed",
    locationType: "home",
    serviceSlug: "swedish",
    duration: 60,
    date: "2026-10-20",
    time: "10:00",
    practitionerId: "p-1",
    address: { line: "123 Calm St", lat: 53.54, lng: -113.49 },
    trip: { sharing: false, to: { lat: 53.54, lng: -113.49 } },
    pricing: { base: 120, discount: 0, addons: 0, travel: 10, tax: 6.5, total: 136.5 },
    paymentStatus: "unpaid",
  },
  liveSess: null,
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    me: { id: "c-1", firstName: "Alex", preferredPractitioners: [], addresses: [] },
    user: { role: "client", subject: "c-1" },
    state: { appointments: [h.appt] },
    idx: {
      services: { swedish: { slug: "swedish", name: "Swedish Massage", prices: { 60: 120 } } },
      practitioners: { "p-1": { id: "p-1", name: "Nabitu Kahindo", initials: "NK", photo: null } },
    },
    patchDraft: vi.fn(),
  }),
}));

vi.mock("@/lib/tracking/live", async () => {
  const actual = await vi.importActual("@/lib/tracking/live");
  return {
    ...actual,
    useLiveSession: () => h.liveSess,
  };
});

vi.mock("@/components/LiveTripCard", () => ({ LiveTripCard: () => createElement("div", { "data-testid": "live-trip-card" }) }));
vi.mock("@/components/LiveMap", () => ({ LiveMap: (props) => createElement("div", { "data-testid": props.testid || "live-map" }) }));
vi.mock("@/components/ArrivalMoment", () => ({ ArrivalMoment: () => createElement("div", { "data-testid": "arrival-moment" }) }));
vi.mock("@/components/session/SessionPrepLink", () => ({ SessionPrepLink: () => createElement("div", { "data-testid": "session-prep-link" }) }));
vi.mock("@/components/BillingFacts", () => ({ BillingFacts: () => null }));
vi.mock("@/components/PaymentPanel", () => ({ PaymentPanel: () => null }));

function renderTrack(path = "/me/visit/a-track-1/track") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(Routes, null, createElement(Route, { path: "/me/visit/:id/track", element: createElement(TrackVisit) })),
      ),
    );
  });
  return {
    host,
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

test("trackVisitView maps appointment statuses to Track Visit states", () => {
  expect(trackVisitView({ status: "confirmed" })).toBe("confirmed");
  expect(trackVisitView({ status: "en_route" })).toBe("en_route");
  expect(trackVisitView({ status: "arrived" })).toBe("arrived");
  expect(trackVisitView({ status: "in_session" })).toBe("in_session");
  expect(trackVisitView({ status: "completed" })).toBe("completed");
  expect(trackVisitView({ status: "cancelled" })).toBe("cancelled");
  expect(isClinicVisit({ locationType: "clinic" })).toBe(true);
  expect(isMobileTrackable({ locationType: "home" })).toBe(true);
  expect(isMobileTrackable({ locationType: "clinic" })).toBe(false);
});

test("confirmed mobile visit shows destination map and no live ETA", () => {
  h.appt.status = "confirmed";
  h.appt.locationType = "home";
  h.appt.trip = { sharing: false, to: { lat: 53.54, lng: -113.49 } };
  h.liveSess = null;
  const view = renderTrack();
  expect(view.host.querySelector("[data-testid='track-visit-page']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='track-confirmed-message']")?.textContent).toMatch(/appointment is confirmed/i);
  expect(view.host.querySelector("[data-testid='track-dest-map']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='live-trip-card']")).toBeNull();
  expect(view.host.querySelector("[data-testid='track-live-eta']")).toBeNull();
  view.unmount();
});

test("en route without live GPS shows map without live ETA", () => {
  h.appt.status = "en_route";
  h.appt.trip = { sharing: true, to: { lat: 53.54, lng: -113.49 } };
  h.liveSess = { phase: "unavailable", sharing: true };
  const view = renderTrack();
  expect(view.host.querySelector("[data-testid='track-dest-map']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='track-en-route-waiting']") || view.host.querySelector("[data-testid='track-eta-unavailable']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='track-live-eta']")).toBeNull();
  view.unmount();
});

test("en route with live GPS shows live trip and ETA panel", () => {
  h.appt.status = "en_route";
  h.appt.trip = { sharing: true, to: { lat: 53.54, lng: -113.49 } };
  h.liveSess = {
    phase: "live",
    sharing: true,
    position: { lat: 53.55, lng: -113.5 },
    eta: { etaMin: 12, remainingKm: 4.2, provider: "mapbox", updatedAt: "2026-10-20T16:30:00Z" },
    stale: false,
  };
  const view = renderTrack();
  expect(view.host.querySelector("[data-testid='live-trip-card']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='track-live-eta']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='track-eta-refresh']")).toBeTruthy();
  view.unmount();
});

test("clinic visit never shows live tracking map", () => {
  h.appt.status = "en_route";
  h.appt.locationType = "clinic";
  h.appt.trip = { sharing: true, to: { lat: 53.54, lng: -113.49 } };
  h.liveSess = null;
  const view = renderTrack();
  expect(view.host.querySelector("[data-testid='track-clinic-note']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='live-trip-card']")).toBeNull();
  expect(view.host.querySelector("[data-testid='track-dest-map']")).toBeNull();
  view.unmount();
});

test("completed visit shows summary actions", () => {
  h.appt.status = "completed";
  h.appt.locationType = "home";
  h.liveSess = null;
  const view = renderTrack();
  expect(view.host.querySelector("[data-testid='track-visit-completed']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='track-visit-rebook']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='track-visit-review']")).toBeTruthy();
  view.unmount();
});
