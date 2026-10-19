import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, vi } from "vitest";
import Booking from "./Booking";
import { StepWhere } from "./BookingSteps";

const h = vi.hoisted(() => {
  const home = {
    id: "ad-home",
    label: "Home",
    line: "10150 104 St NW, Edmonton",
    lat: 53.54,
    lng: -113.49,
    clientConfirmed: true,
    confidence: "address",
    zoneId: "z-core",
    travelFee: 0,
    quoted: true,
  };
  const office = {
    id: "ad-office",
    label: "Office",
    line: "10060 Jasper Ave, Edmonton",
    lat: 53.54,
    lng: -113.5,
    clientConfirmed: true,
    confidence: "address",
  };
  return {
    home,
    office,
    draft: {
      step: 0,
      locationType: "home",
      address: null,
      addressQuery: "",
      addressNotes: "",
      forceWhere: false,
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
      paymentMethod: "self",
      selfMethod: "card",
      guest: { firstName: "", lastName: "", email: "", phone: "", createProfile: true, dob: "", marketingConsent: false },
    },
    me: {
      id: "c-returning",
      firstName: "Riley",
      lastName: "Client",
      addresses: [],
      onlineBookings: 2,
    },
    patchDraft: vi.fn((p) => { Object.assign(h.draft, typeof p === "function" ? p(h.draft) : p); }),
    api: {
      plansMine: vi.fn(async () => ({ wallet: [] })),
      winbackMine: vi.fn(async () => ({ invite: null })),
      followupMine: vi.fn(async () => ({ coupons: [] })),
      quoteBooking: vi.fn(async () => ({ pricing: { base: 120, total: 126, tax: 6, travel: 0, discount: 0, addons: 0, addonList: [] }, settlement: null })),
      geoConfirm: vi.fn(),
      book: vi.fn(),
    },
  };
});

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    draft: h.draft,
    patchDraft: h.patchDraft,
    me: h.me,
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
      settings: { clinic: { enabled: false, address: "" }, addons: [], depositPercent: 0, allowCash: true, allowCard: true },
    },
    api: h.api,
    run: (fn) => fn(),
    resetDraft: vi.fn(),
    register: vi.fn(),
  }),
}));

vi.mock("@/components/AddressPicker", () => ({
  AddressPicker: (props) => createElement("div", { "data-testid": `${props.testid}-input`, "data-query": props.query || "" }),
}));

vi.mock("@/lib/domain", async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    zoneFor: (addr) => (addr?.lat != null ? { zone: { id: "z-core", name: "Core", fee: 0 }, km: 2 } : null),
    quote: () => ({ base: 120, total: 126, tax: 6, travel: 0, discount: 0, addons: 0, addonList: [], treatmentAfterDiscount: 120 }),
    paymentChoice: () => "card",
    clinicBookable: () => false,
    welcomeOfferListed: () => false,
  };
});

function renderBooking() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(MemoryRouter, { initialEntries: ["/book"] }, createElement(Booking)));
  });
  return {
    host,
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

function renderWhere() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(createElement(StepWhere)); });
  return {
    host,
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

beforeEach(() => {
  h.patchDraft.mockClear();
  h.api.geoConfirm.mockReset();
  Object.assign(h.draft, {
    step: 0,
    locationType: "home",
    address: null,
    addressQuery: "",
    forceWhere: false,
    serviceSlug: null,
    date: null,
    time: null,
  });
  h.me.addresses = [];
  h.me.id = "c-returning";
});

afterEach(() => {
  document.body.innerHTML = "";
});

test("returning client with confirmed primary skips Where to Service", async () => {
  h.me.addresses = [h.home];
  const view = renderBooking();
  await act(async () => { await Promise.resolve(); });
  const patches = h.patchDraft.mock.calls.map((c) => c[0]);
  expect(patches.some((p) => p.step === 1 && p.address?.id === "ad-home")).toBe(true);
  view.unmount();
});

test("guest with no profile stays on Where (no auto address patch)", async () => {
  const prev = h.me;
  h.me = null;
  const view = renderBooking();
  await act(async () => { await Promise.resolve(); });
  const addressPatches = h.patchDraft.mock.calls.map((c) => c[0]).filter((p) => p && p.address);
  expect(addressPatches.length).toBe(0);
  view.unmount();
  h.me = prev;
});

test("new client without saved addresses does not auto-skip Where", async () => {
  h.me.addresses = [];
  const view = renderBooking();
  await act(async () => { await Promise.resolve(); });
  expect(h.patchDraft.mock.calls.every((c) => c[0]?.step !== 1)).toBe(true);
  view.unmount();
});

test("Different address clears draft address without a profile PATCH", () => {
  h.me.addresses = [h.home, h.office];
  h.draft.address = h.home;
  h.draft.addressQuery = h.home.line;
  h.draft.date = "2026-10-20";
  h.draft.time = "10:00";
  const view = renderWhere();
  const btn = view.host.querySelector("[data-testid='step-where-different-address']");
  expect(btn).toBeTruthy();
  act(() => { btn.click(); });
  expect(h.patchDraft).toHaveBeenCalledWith(expect.objectContaining({
    address: null,
    addressQuery: "",
    date: null,
    time: null,
    forceWhere: true,
  }));
  view.unmount();
});

test("switching saved address chips clears date and time", () => {
  h.me.addresses = [h.home, h.office];
  h.draft.address = h.home;
  h.draft.date = "2026-10-20";
  h.draft.time = "10:00";
  const view = renderWhere();
  act(() => { view.host.querySelector("[data-testid='saved-address-ad-office']").click(); });
  expect(h.patchDraft).toHaveBeenCalledWith(expect.objectContaining({
    address: expect.objectContaining({ id: "ad-office" }),
    date: null,
    time: null,
  }));
  view.unmount();
});
