/**
 * Slice 2 — service/duration transitions, date sync, practitioner label, draft preservation.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, vi } from "vitest";
import { StepDuration, StepPay, StepService, StepWhen } from "./BookingSteps";
import { BOOKING_STEP } from "@/lib/booking-selection";
import { todayISO } from "@/lib/domain";

const h = vi.hoisted(() => ({
  draft: {
    step: 1,
    locationType: "home",
    address: {
      line: "10150 104 St NW, Edmonton",
      clientConfirmed: true,
      confidence: "address",
      lat: 53.54,
      lng: -113.49,
    },
    addressQuery: "",
    campaignId: undefined,
    serviceId: "svc-swedish",
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
  api: {
    recommend: vi.fn(async () => ({ slots: [{ time: "10:00", label: "Open" }], recommendations: [{ time: "10:00", label: "Open" }] })),
  },
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    draft: h.draft,
    patchDraft: h.patchDraft,
    me: null,
    state: {
      services: [
        { id: "svc-swedish", slug: "swedish", name: "Swedish", short: "Classic", prices: { 60: 120, 90: 160 }, mobile: true, clinic: true, publication: "published", img: "" },
        { id: "svc-prenatal", slug: "prenatal", name: "Prenatal", short: "Care", prices: { 60: 130 }, mobile: true, clinic: false, publication: "published", img: "" },
      ],
      practitioners: [{ id: "p-maya", name: "Maya", specialties: ["swedish"], publication: "published", bookableOnline: true }],
      zones: [],
    },
    idx: {
      services: {
        swedish: { id: "svc-swedish", slug: "swedish", name: "Swedish", short: "Classic", prices: { 60: 120, 90: 160 }, img: "" },
        prenatal: { id: "svc-prenatal", slug: "prenatal", name: "Prenatal", short: "Care", prices: { 60: 130 }, img: "" },
      },
      settings: {
        addons: [{ id: "hot-stones", name: "Hot stones", price: 15 }],
        clinic: { enabled: false },
        paymentPolicy: { cashAccepted: true, mode: "choice", depositPercent: 20 },
        cardCheckoutEnabled: true,
      },
    },
    api: h.api,
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

beforeEach(() => {
  h.patchDraft.mockClear();
  h.api.recommend.mockClear();
  Object.assign(h.draft, {
    step: BOOKING_STEP.SERVICE,
    serviceSlug: null,
    serviceId: null,
    duration: 60,
    addons: [],
    date: null,
    time: null,
    practitionerId: "",
    campaignId: undefined,
  });
});

test("selecting a service updates the draft without auto-advancing", () => {
  const view = mount(createElement(StepService));
  expect(view.host.querySelector("[data-testid='step-duration-60']")).toBeNull();
  act(() => { view.host.querySelector("[data-testid='step-service-swedish']").click(); });
  expect(h.patchDraft).toHaveBeenCalled();
  const patch = h.patchDraft.mock.calls.at(-1)[0];
  expect(patch.serviceSlug).toBe("swedish");
  expect(patch.step).toBeUndefined();
  view.cleanup();
});

test("selecting a duration updates the draft without auto-advancing", () => {
  h.draft.serviceSlug = "swedish";
  h.draft.step = BOOKING_STEP.DURATION;
  const view = mount(createElement(StepDuration));
  expect(view.host.querySelector("[data-testid='step-duration']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='step-addon-hot-stones']")).toBeTruthy();
  act(() => { view.host.querySelector("[data-testid='step-addon-hot-stones']").click(); });
  expect(h.draft.addons).toContain("hot-stones");
  act(() => { view.host.querySelector("[data-testid='step-duration-90']").click(); });
  const patch = h.patchDraft.mock.calls.at(-1)[0];
  expect(patch.duration).toBe(90);
  expect(patch.step).toBeUndefined();
  expect(h.draft.serviceSlug).toBe("swedish");
  expect(h.draft.addons).toContain("hot-stones");
  view.cleanup();
});

test("selecting a time updates the draft without auto-advancing", async () => {
  h.draft.serviceSlug = "swedish";
  h.draft.step = BOOKING_STEP.WHEN;
  h.draft.date = todayISO();
  h.draft.address = {
    line: "10150 104 St NW, Edmonton",
    clientConfirmed: true,
    confidence: "address",
    lat: 53.54,
    lng: -113.49,
    detailsSettled: true,
  };
  const view = mount(createElement(StepWhen));
  await act(async () => { await Promise.resolve(); });
  const timeBtn = await (async () => {
    const started = Date.now();
    while (Date.now() - started < 2000) {
      const el = view.host.querySelector("[data-testid='step-time-10:00']");
      if (el) return el;
      await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    }
    throw new Error("missing time slot");
  })();
  act(() => { timeBtn.click(); });
  expect(h.patchDraft.mock.calls.at(-1)[0]).toEqual(expect.objectContaining({
    time: "10:00",
  }));
  expect(h.patchDraft.mock.calls.at(-1)[0].step).toBeUndefined();
  view.cleanup();
});

test("When seeds draft.date so the highlighted day matches Continue eligibility", async () => {
  h.draft.serviceSlug = "swedish";
  h.draft.date = null;
  const view = mount(createElement(StepWhen));
  await act(async () => { await Promise.resolve(); });
  expect(h.patchDraft.mock.calls.some((c) => c[0]?.date === todayISO())).toBe(true);
  expect(view.host.querySelector("[data-testid='step-pract-any']")?.textContent).toMatch(/Any Available Practitioner/);
  view.cleanup();
});

test("Back from Duration keeps the previously selected service in the draft", () => {
  h.draft.serviceSlug = "prenatal";
  h.draft.serviceId = "svc-prenatal";
  h.draft.step = BOOKING_STEP.DURATION;
  h.draft.duration = 60;
  const view = mount(createElement(StepDuration));
  expect(h.draft.serviceSlug).toBe("prenatal");
  expect(view.host.textContent).toMatch(/Prenatal/);
  view.cleanup();
});

test("selecting a payment choice updates payNow without leaving the step", () => {
  h.draft.serviceSlug = "swedish";
  h.draft.step = BOOKING_STEP.REVIEW;
  const view = mount(createElement(StepPay));
  act(() => { view.host.querySelector("[data-testid='step-pay-cash']").click(); });
  expect(h.patchDraft.mock.calls.at(-1)[0]).toEqual(expect.objectContaining({
    payNow: "cash",
  }));
  expect(h.patchDraft.mock.calls.at(-1)[0].step).toBeUndefined();
  view.cleanup();
});
