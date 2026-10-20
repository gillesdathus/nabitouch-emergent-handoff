import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import Me, { rebookSlugs, serviceLabel } from "./Me";

const h = vi.hoisted(() => ({
  me: {
    id: "c-new",
    firstName: "Synth",
    preferredName: "Synth",
    lastName: "Client",
    email: "synth@example.com",
    phone: "7805550199",
    dob: "1990-01-15",
    language: "English",
    contactMethod: "Text",
    marketingConsent: false,
    smsConsent: false,
    favorites: [],
    preferredPractitioners: [],
    addresses: [],
    insurance: [],
    photo: null,
  },
  services: {
    "deep-tissue": { slug: "deep-tissue", name: "Deep Tissue Massage", prices: { 60: 140 }, img: "" },
  },
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    me: h.me,
    user: { role: "client", subject: "c-new" },
    state: { appointments: [], promotions: [], plans: [] },
    idx: { services: h.services, practitioners: {}, settings: {} },
    patchDraft: vi.fn(),
    logout: vi.fn(),
    api: {
      billingNotices: async () => [],
      followupMine: async () => ({ coupons: [] }),
      saveConsent: vi.fn(),
      unsubscribe: vi.fn(),
      watchOpening: vi.fn(),
    },
  }),
}));

vi.mock("@/components/reviews/Reviews", () => ({ FeedbackPrompt: () => null }));
vi.mock("@/components/PlanNudge", () => ({ PlanNudge: () => null }));
vi.mock("@/components/PaymentPanel", () => ({ PaymentPanel: () => null }));
vi.mock("@/components/BillingFacts", () => ({ BillingFacts: () => null }));
vi.mock("@/components/LiveTripCard", () => ({ LiveTripCard: () => null }));
vi.mock("@/components/ArrivalMoment", () => ({ ArrivalMoment: () => null }));
vi.mock("@/components/PrepareCard", () => ({ PrepareCard: () => null }));
vi.mock("@/components/session/SessionPrepLink", () => ({ SessionPrepLink: () => null }));

function renderMe() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(createElement(MemoryRouter, null, createElement(Me))); });
  return {
    host,
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

test("rebookSlugs falls back to the first published service when swedish is absent", () => {
  expect(rebookSlugs({ favorites: [] }, { "deep-tissue": { name: "Deep Tissue" } })).toEqual(["deep-tissue"]);
  expect(rebookSlugs({ favorites: ["swedish"] }, { "deep-tissue": { name: "Deep Tissue" } })).toEqual(["deep-tissue"]);
  expect(rebookSlugs({ favorites: ["deep-tissue"] }, { "deep-tissue": { name: "Deep Tissue" } })).toEqual(["deep-tissue"]);
  expect(rebookSlugs({ favorites: [] }, {})).toEqual([]);
  expect(serviceLabel({ "deep-tissue": { name: "Deep Tissue Massage" } }, "swedish")).toBe("Treatment");
});

test("empty new client dashboard renders when only deep-tissue is published", () => {
  const view = renderMe();
  expect(view.host.querySelector("[data-testid='client-dashboard']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='me-greeting']").textContent).toBe("Synth");
  expect(view.host.querySelector("[data-testid='no-upcoming-card']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='rebook-deep-tissue']")).toBeTruthy();
  expect(view.host.textContent).toContain("Deep Tissue Massage");
  expect(view.host.textContent).not.toContain("This screen could not be shown");
  view.unmount();
});

test("empty catalogue still shows the dashboard without crashing", () => {
  const previous = h.services;
  h.services = {};
  const view = renderMe();
  expect(view.host.querySelector("[data-testid='client-dashboard']")).toBeTruthy();
  expect(view.host.textContent).toContain("No published treatments are available to rebook yet.");
  view.unmount();
  h.services = previous;
});
