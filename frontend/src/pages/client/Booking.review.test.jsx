/**
 * Slice 5 completion — Booking Review mount must not hang under URL ↔ draft step sync.
 *
 * Root cause: sessionStorage / URL can leave draft.step as a string. The sync effect
 * compared with `===`, so `6 !== "6"`, then alternated patchDraft/setParams. With a
 * reactive DemoStore (real patchDraft → setState) that looked like an act()/waitFor hang.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { BOOKING_STEP } from "@/lib/booking-selection";
import { todayISO } from "@/lib/domain";
import Booking from "./Booking";

vi.mock("sonner", () => ({ toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() } }));

const h = vi.hoisted(() => {
  const listeners = new Set();
  const draft = {
    step: "6", // stringy REVIEW — the hang trigger
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
      unit: "4",
      access: "Buzz 12",
    },
    addressQuery: "10150 104 St NW, Edmonton",
    addressNotes: "Park visitor",
    forceWhere: false,
    serviceId: "svc-swedish",
    serviceSlug: "swedish",
    duration: 60,
    addons: [],
    date: "2099-01-15",
    time: "10:00",
    practitionerId: "",
    goals: [],
    focus: [],
    notes: "",
    paymentMethod: "self",
    selfMethod: "card",
    guest: {
      firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", phone: "7805550100",
      createProfile: false, dob: "", marketingConsent: false,
    },
  };
  return {
    renders: 0,
    patchCalls: 0,
    listeners,
    draft,
    notify() { listeners.forEach((fn) => fn()); },
    patchDraft: vi.fn((p) => {
      h.patchCalls += 1;
      Object.assign(h.draft, typeof p === "function" ? p(h.draft) : p);
      h.notify();
    }),
    api: {
      plansMine: vi.fn(async () => ({ wallet: [] })),
      winbackMine: vi.fn(async () => ({ invite: null })),
      followupMine: vi.fn(async () => ({ coupons: [] })),
      quoteBooking: vi.fn(async () => ({
        pricing: { base: 120, total: 126, tax: 6, travel: 0, discount: 0, addons: 0, addonList: [] },
        settlement: { dueNowCents: 12600, remainingCents: 0, totalCents: 12600, choice: "full" },
      })),
      recommend: vi.fn(async () => ({ slots: [], recommendations: [] })),
      geoConfirm: vi.fn(),
      book: vi.fn(async () => ({ appointment: { id: "ap-1", ref: "NT-1" } })),
    },
  };
});

vi.mock("@/store/DemoStore", () => {
  const React = require("react");
  return {
    useDemo: () => {
      h.renders += 1;
      const [, setTick] = React.useState(0);
      React.useEffect(() => {
        const bump = () => setTick((n) => n + 1);
        h.listeners.add(bump);
        return () => h.listeners.delete(bump);
      }, []);
      return {
        draft: h.draft,
        patchDraft: h.patchDraft,
        me: null,
        state: {
          zones: [{ id: "z-core", name: "Core", fee: 0, polygon: [] }],
          services: [{
            id: "svc-swedish", slug: "swedish", name: "Swedish", prices: { 60: 120 },
            mobile: true, clinic: true, publication: "published", img: "",
          }],
          promotions: [],
          appointments: [],
          practitioners: [],
          offerEligibility: { known: true, welcome: true },
        },
        idx: {
          services: {
            swedish: {
              id: "svc-swedish", slug: "swedish", name: "Swedish", prices: { 60: 120 },
              mobile: true, clinic: true, img: "",
            },
          },
          practitioners: {},
          clients: {},
          settings: {
            clinic: { enabled: true, address: "10060 Jasper Ave", lat: 53.54, lng: -113.5 },
            addons: [],
            depositPercent: 0,
            allowCash: true,
            allowCard: true,
            paymentPolicy: { mode: "full", cashAccepted: true },
          },
        },
        api: h.api,
        run: (fn) => fn(),
        resetDraft: vi.fn(),
        register: vi.fn(),
      };
    },
  };
});

vi.mock("@/components/AddressPicker", () => ({
  AddressPicker: () => createElement("div", { "data-testid": "step-where-address" }),
}));

function mount(entry = "/book?step=6&service=svc-swedish") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(MemoryRouter, { initialEntries: [entry] }, createElement(Booking)));
  });
  return {
    host,
    async flush(times = 6) {
      for (let i = 0; i < times; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
      }
    },
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  h.renders = 0;
  h.patchCalls = 0;
  h.patchDraft.mockClear();
  h.api.quoteBooking.mockClear();
  h.draft.step = "6";
  h.draft.date = todayISO();
  h.draft.time = "10:00";
  h.draft.serviceSlug = "swedish";
  h.draft.serviceId = "svc-swedish";
  h.draft.forceWhere = false;
  h.draft.locationType = "home";
});

describe("Booking Review mount", () => {
  test("stringy draft.step at Review settles without runaway sync", async () => {
    const view = mount("/book?step=6&service=svc-swedish");
    await view.flush(8);
    expect(h.renders).toBeLessThan(40);
    expect(h.patchCalls).toBeLessThan(12);
    expect(h.api.quoteBooking).toHaveBeenCalledTimes(1);
    expect(view.host.querySelector("[data-testid=step-review]")).toBeTruthy();
    expect(Number(h.draft.step)).toBe(BOOKING_STEP.REVIEW);
    const confirm = document.querySelector("[data-testid=booking-confirm-btn]");
    expect(confirm).toBeTruthy();
    expect(confirm.disabled).toBe(false);
    expect(view.host.contains(confirm)).toBe(true);
    view.cleanup();
  });

  test("Back from Review is in-flow (no sticky action bar)", async () => {
    const view = mount("/book?step=6&service=svc-swedish");
    await view.flush(8);
    expect(document.querySelector("[data-testid=booking-sticky-actions]")).toBeNull();
    const nav = document.querySelector("[data-testid=booking-step-nav]");
    expect(nav).toBeTruthy();
    expect(document.querySelector("[data-testid=booking-back-btn]")).toBeTruthy();
    expect(view.host.contains(nav)).toBe(true);
    view.cleanup();
  });
});
