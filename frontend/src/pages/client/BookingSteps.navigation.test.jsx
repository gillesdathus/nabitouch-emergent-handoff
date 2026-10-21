/**
 * Slice 2 — service/duration transitions, date sync, practitioner label, draft preservation.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, vi } from "vitest";
import { StepDuration, StepService, StepWhen } from "./BookingSteps";
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
      settings: { addons: [{ id: "hot-stones", name: "Hot stones", price: 15 }], clinic: { enabled: false } },
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

test("selecting a service advances to the Duration step without showing durations inline", () => {
  const view = mount(createElement(StepService));
  expect(view.host.querySelector("[data-testid='step-duration-60']")).toBeNull();
  act(() => { view.host.querySelector("[data-testid='step-service-swedish']").click(); });
  expect(h.patchDraft).toHaveBeenCalled();
  const patch = h.patchDraft.mock.calls.at(-1)[0];
  expect(patch.serviceSlug).toBe("swedish");
  expect(patch.step).toBe(BOOKING_STEP.DURATION);
  view.cleanup();
});

test("selecting a duration advances to When and preserves the selected service", () => {
  h.draft.serviceSlug = "swedish";
  h.draft.step = BOOKING_STEP.DURATION;
  const view = mount(createElement(StepDuration));
  expect(view.host.querySelector("[data-testid='step-duration']")).toBeTruthy();
  act(() => { view.host.querySelector("[data-testid='step-duration-90']").click(); });
  const patch = h.patchDraft.mock.calls.at(-1)[0];
  expect(patch.duration).toBe(90);
  expect(patch.step).toBe(BOOKING_STEP.WHEN);
  expect(h.draft.serviceSlug).toBe("swedish");
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
