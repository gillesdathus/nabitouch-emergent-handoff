/**
 * Slice 4 — Booking sticky actions use shared tokens, not hardcoded dock offsets.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, vi } from "vitest";
import Booking from "./Booking";

const h = vi.hoisted(() => ({
  draft: {
    step: 1,
    bookingFlowVersion: 2,
    locationType: "home",
    address: {
      id: "ad-home",
      line: "10150 104 St NW, Edmonton",
      lat: 53.54,
      lng: -113.49,
      clientConfirmed: true,
      confidence: "address",
      zoneId: "z-core",
      travelFee: 0,
      quoted: true,
    },
    addressQuery: "10150 104 St NW, Edmonton",
    addressNotes: "",
    forceWhere: false,
    serviceId: "svc-swedish",
    serviceSlug: "swedish",
    duration: 60,
    addons: [],
    date: null,
    time: null,
    practitionerId: "",
    goals: [],
    focus: [],
    notes: "",
    paymentMethod: "self",
    selfMethod: "card",
    guest: { firstName: "", lastName: "", email: "", phone: "", createProfile: true, dob: "", marketingConsent: false },
  },
  patchDraft: vi.fn((p) => { Object.assign(h.draft, typeof p === "function" ? p(h.draft) : p); }),
  api: {
    plansMine: vi.fn(async () => ({ wallet: [] })),
    winbackMine: vi.fn(async () => ({ invite: null })),
    followupMine: vi.fn(async () => ({ coupons: [] })),
    quoteBooking: vi.fn(async () => ({ pricing: { base: 120, total: 126, tax: 6, travel: 0, discount: 0, addons: 0, addonList: [] }, settlement: null })),
    recommend: vi.fn(async () => ({ slots: [], recommendations: [] })),
    geoConfirm: vi.fn(),
    book: vi.fn(),
  },
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    draft: h.draft,
    patchDraft: h.patchDraft,
    me: null,
    state: {
      zones: [{ id: "z-core", name: "Core", fee: 0, polygon: [] }],
      services: [{ id: "svc-swedish", slug: "swedish", name: "Swedish", prices: { 60: 120 }, mobile: true, clinic: false, publication: "published", img: "" }],
      promotions: [],
      appointments: [],
      practitioners: [],
    },
    idx: {
      services: { swedish: { id: "svc-swedish", slug: "swedish", name: "Swedish", prices: { 60: 120 }, mobile: true, img: "" } },
      practitioners: {},
      clients: {},
      settings: { clinic: { enabled: false, address: "" }, addons: [], depositPercent: 0, allowCash: true, allowCard: true, paymentPolicy: { mode: "full", cashAccepted: true } },
    },
    api: h.api,
    run: (fn) => fn(),
    resetDraft: vi.fn(),
    register: vi.fn(),
  }),
}));

vi.mock("@/components/AddressPicker", () => ({
  AddressPicker: () => createElement("div", { "data-testid": "step-where-address" }),
}));

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(MemoryRouter, { initialEntries: ["/book?step=1"] }, createElement(Booking))));
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  h.patchDraft.mockClear();
  h.draft.step = 1;
});

test("booking primary actions use StickyActionBar / nb-sticky-actions tokens", async () => {
  const view = mount();
  await act(async () => { await Promise.resolve(); });
  const bar = view.host.querySelector("[data-testid=booking-sticky-actions]");
  expect(bar).toBeTruthy();
  expect(bar.className).toMatch(/nb-sticky-actions/);
  expect(bar.className).not.toMatch(/bottom-\[64px\]/);
  expect(view.host.querySelector("[data-testid=booking-next-btn]")).toBeTruthy();
  view.cleanup();
});
