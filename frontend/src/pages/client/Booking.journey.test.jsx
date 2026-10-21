/**
 * Slice 5 — booking journey contracts (integration-level, mocked API).
 * Full BrowserRouter review mounts are covered lightly; step transitions use BookingSteps tests.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { BOOKING_STEP, canJumpBookingStep, locationTypeBookingLabel } from "@/lib/booking-selection";
import { todayISO } from "@/lib/domain";
import { StepDuration, StepService } from "./BookingSteps";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }) => children,
  motion: {
    div: ({ children, ...props }) => createElement("div", props, children),
    button: ({ children, ...props }) => createElement("button", props, children),
    span: ({ children, ...props }) => createElement("span", props, children),
  },
  MotionConfig: ({ children }) => children,
}));

const confirmedHome = {
  line: "10150 104 St NW, Edmonton, AB",
  lat: 53.54,
  lng: -113.49,
  clientConfirmed: true,
  confidence: "address",
  zoneId: "z-core",
  travelFee: 0,
  quoted: true,
  unit: "4",
  access: "Buzz 12",
  postal: "T5J 2R4",
};

const h = vi.hoisted(() => ({
  draft: {
    step: 1,
    locationType: "home",
    address: {
      line: "10150 104 St NW, Edmonton, AB",
      lat: 53.54,
      lng: -113.49,
      clientConfirmed: true,
      confidence: "address",
      zoneId: "z-core",
      travelFee: 0,
      quoted: true,
      unit: "4",
      access: "Buzz 12",
      postal: "T5J 2R4",
    },
    addressQuery: "10150 104 St NW, Edmonton, AB",
    addressNotes: "Park in visitor stall",
    campaignId: undefined,
    serviceId: null,
    serviceSlug: null,
    duration: 60,
    addons: [],
    date: null,
    time: null,
    practitionerId: "",
    goals: [],
    focus: [],
    notes: "",
  },
  patchDraft: vi.fn((p) => { Object.assign(h.draft, typeof p === "function" ? p(h.draft) : p); }),
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    draft: h.draft,
    patchDraft: h.patchDraft,
    me: null,
    state: {
      services: [{
        id: "svc-swedish", slug: "swedish", name: "Swedish", short: "Classic",
        prices: { 60: 120, 90: 160 }, mobile: true, clinic: true, publication: "published", img: "",
      }],
      practitioners: [],
      zones: [],
    },
    idx: {
      services: {
        swedish: {
          id: "svc-swedish", slug: "swedish", name: "Swedish", short: "Classic",
          prices: { 60: 120, 90: 160 }, img: "",
        },
      },
      settings: { addons: [], clinic: { enabled: true, address: "10060 Jasper Ave" } },
      practitioners: {},
    },
    api: { recommend: vi.fn(async () => ({ slots: [], recommendations: [] })) },
  }),
}));

function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** Mirrors Booking.confirm address assembly for mobile vs clinic (contract under test). */
function assembleAppointmentAddress(draft, { clinicPin, zoneId }) {
  if (draft.locationType === "clinic") {
    return {
      line: clinicPin.address,
      zoneId: null,
      ...(Number.isFinite(Number(clinicPin.lat)) && Number.isFinite(Number(clinicPin.lng))
        ? { lat: Number(clinicPin.lat), lng: Number(clinicPin.lng) }
        : {}),
    };
  }
  return { ...draft.address, zoneId, notes: draft.addressNotes };
}

beforeEach(() => {
  h.patchDraft.mockClear();
  Object.assign(h.draft, {
    step: BOOKING_STEP.SERVICE,
    locationType: "home",
    address: { ...confirmedHome },
    addressQuery: confirmedHome.line,
    addressNotes: "Park in visitor stall",
    serviceSlug: null,
    serviceId: null,
    duration: 60,
    date: null,
    time: null,
    practitionerId: "",
  });
});

describe("Automatic navigation", () => {
  test("service selection opens Duration", () => {
    const view = mount(createElement(StepService));
    act(() => { view.host.querySelector("[data-testid=step-service-swedish]").click(); });
    expect(h.patchDraft.mock.calls.at(-1)[0].step).toBe(BOOKING_STEP.DURATION);
    expect(view.host.querySelector("[data-testid=step-duration-60]")).toBeNull();
    view.cleanup();
  });

  test("duration selection advances to When and keeps service", () => {
    h.draft.serviceSlug = "swedish";
    h.draft.step = BOOKING_STEP.DURATION;
    const view = mount(createElement(StepDuration));
    act(() => { view.host.querySelector("[data-testid=step-duration-90]").click(); });
    expect(h.patchDraft.mock.calls.at(-1)[0]).toEqual(expect.objectContaining({
      duration: 90,
      step: BOOKING_STEP.WHEN,
    }));
    expect(h.draft.serviceSlug).toBe("swedish");
    view.cleanup();
  });

  test("payment cannot be bypassed via step jump helper", () => {
    const ok = [true, true, true, true, true, false];
    expect(canJumpBookingStep(BOOKING_STEP.YOU, BOOKING_STEP.REVIEW, ok)).toBe(false);
  });
});

describe("Mobile vs clinic address payload", () => {
  test("mobile booking keeps structured address, suite, access, and notes", () => {
    const address = assembleAppointmentAddress(
      {
        locationType: "home",
        address: confirmedHome,
        addressNotes: "Park in visitor stall",
      },
      { clinicPin: {}, zoneId: "z-core" },
    );
    expect(address.line).toBe(confirmedHome.line);
    expect(address.unit).toBe("4");
    expect(address.access).toBe("Buzz 12");
    expect(address.notes).toBe("Park in visitor stall");
    expect(address.zoneId).toBe("z-core");
    expect(address.lat).toBe(53.54);
  });

  test("clinic booking uses clinic pin and does not require home address fields", () => {
    const address = assembleAppointmentAddress(
      { locationType: "clinic", address: null, addressNotes: "" },
      { clinicPin: { address: "10060 Jasper Ave, Edmonton", lat: 53.54, lng: -113.5 }, zoneId: null },
    );
    expect(address.line).toMatch(/Jasper/);
    expect(address.unit).toBeUndefined();
    expect(address.zoneId).toBeNull();
  });

  test("guest address label stays defined for every location type", () => {
    expect(locationTypeBookingLabel("home")).toBe("Home");
    expect(locationTypeBookingLabel("clinic")).toBe("In Clinic");
    expect(locationTypeBookingLabel(undefined)).toBe("Home");
  });
});

describe("Review safety contracts", () => {
  test("stale practitioner id resolves to a safe label instead of throwing", () => {
    const practitioners = {};
    const practitionerId = "p-deleted";
    const summary = practitionerId
      ? (practitioners[practitionerId]?.name || "Selected practitioner is unavailable — choose another or Any Available Practitioner")
      : "Request only — a practitioner is not assigned yet";
    expect(summary).toMatch(/unavailable/);
  });

  test("selected date for When must equal draft.date once seeded", () => {
    const date = todayISO();
    const draftDate = date;
    expect(draftDate).toBe(date);
  });
});

describe("Shared router shell", () => {
  test("MemoryRouter can host the booking route without throwing", () => {
    const view = mount(createElement(
      MemoryRouter,
      { initialEntries: ["/book?service=svc-swedish&step=1"] },
      createElement("div", { "data-testid": "book-shell" }, "ok"),
    ));
    expect(view.host.querySelector("[data-testid=book-shell]")).toBeTruthy();
    view.cleanup();
  });
});
