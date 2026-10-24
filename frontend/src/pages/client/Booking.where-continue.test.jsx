/**
 * Where → Continue must not require a legacy ring match from zoneFor.
 * Open Coverage confirms via /geo/confirm; rings may all be disabled.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { bookingAddressComplete } from "@/lib/booking-selection";
import { zoneFor } from "@/lib/domain";
import Booking from "./Booking";

const spruceGrove = {
  line: "20 Main Blvd, Spruce Grove, AB",
  lat: 53.545,
  lng: -113.918,
  postal: "T7X 0A1",
  mapboxId: "mb-spruce",
  clientConfirmed: true,
  confidence: "address",
  zoneId: "z-open",
  travelFee: 0,
  quoted: true,
  detailsSettled: true,
};

const disabledRings = [
  { id: "z-central", name: "Central", fee: 0, radiusKm: 8, enabled: false },
  { id: "z-inner", name: "Inner", fee: 10, radiusKm: 15, enabled: false },
  { id: "z-outer", name: "Outer", fee: 20, radiusKm: 25, enabled: false },
];

const h = vi.hoisted(() => ({
  draft: {
    step: 0,
    bookingFlowVersion: 3,
    locationType: "home",
    address: null,
    addressQuery: "",
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
    guest: { firstName: "", lastName: "", email: "", phone: "", createProfile: false, dob: "", marketingConsent: false },
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
      zones: disabledRings,
      services: [{ id: "svc-swedish", slug: "swedish", name: "Swedish", prices: { 60: 120 }, mobile: true, clinic: false, publication: "published", img: "" }],
      promotions: [],
      appointments: [],
      practitioners: [],
    },
    idx: {
      services: { swedish: { id: "svc-swedish", slug: "swedish", name: "Swedish", prices: { 60: 120 }, mobile: true, img: "" } },
      practitioners: {},
      clients: {},
      settings: {
        clinic: { enabled: false, address: "" },
        addons: [],
        depositPercent: 0,
        allowCash: true,
        allowCard: true,
        paymentPolicy: { mode: "full", cashAccepted: true },
        serviceCoverage: { mode: "open", travelFeesEnabled: false },
      },
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

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function mount(step = 0) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(MemoryRouter, { initialEntries: [`/book?step=${step}`] }, createElement(Booking))));
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.target?.remove?.();
      host.remove();
    },
  };
}

beforeEach(() => {
  h.patchDraft.mockClear();
  h.draft.step = 0;
  h.draft.address = { ...spruceGrove };
  h.draft.addressQuery = spruceGrove.line;
  h.draft.forceWhere = false;
  h.draft.serviceSlug = "swedish";
});

test("zoneFor finds no ring under Open Coverage, but bookingAddressComplete still passes", () => {
  const zr = zoneFor(spruceGrove, disabledRings);
  expect(zr.zone).toBeNull();
  expect(bookingAddressComplete(spruceGrove)).toBe(true);
});

test("Where Continue enables after details settle without a legacy ring match", async () => {
  const view = mount(0);
  await act(async () => { await Promise.resolve(); });
  expect(document.querySelector("[data-testid=booking-continue-hint]")).toBeNull();
  const next = document.querySelector("[data-testid=booking-next-btn]");
  expect(next).toBeTruthy();
  expect(next.disabled).toBe(false);
  expect(document.querySelector("[data-testid=booking-sticky-actions]")).toBeNull();
  await act(async () => { next.click(); });
  expect(h.patchDraft).toHaveBeenCalledWith(expect.objectContaining({ step: 1 }));
  view.cleanup();
});

test("Where Continue stays hidden until detailsSettled (in-flow AddressPicker owns the phase)", async () => {
  h.draft.address = { ...spruceGrove, detailsSettled: false };
  const view = mount(0);
  await act(async () => { await Promise.resolve(); });
  expect(document.querySelector("[data-testid=booking-step-nav]")).toBeNull();
  expect(document.querySelector("[data-testid=booking-next-btn]")).toBeNull();
  view.cleanup();
});
