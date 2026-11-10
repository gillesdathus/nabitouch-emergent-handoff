import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const api = {
  searchClients: vi.fn(async () => ({
    clients: [{ id: "c-amy", firstName: "Amy", lastName: "Nguyen", phone: "7805550101", email: "amy@example.com" }],
    duplicates: [],
  })),
  createClient: vi.fn(async (body) => ({ id: "c-new", ...body })),
  book: vi.fn(async () => ({ id: "a-1" })),
  clientWorkspace: vi.fn(async (id) => ({
    client: {
      id,
      firstName: "Amy",
      lastName: "Nguyen",
      phone: "7805550101",
      addresses: [{
        id: "ad-amy",
        line: "10150 104 St NW, Edmonton, AB",
        clientConfirmed: true,
        confidence: "address",
        lat: 53.54,
        lng: -113.49,
        mapboxId: "mbx-amy",
        isDefault: true,
      }],
    },
  })),
};

const preClient = {
  id: "c-pre",
  firstName: "Pat",
  lastName: "Lee",
  phone: "7805550199",
  email: "pat@example.com",
  addresses: [{
    id: "ad-pre",
    line: "10150 104 St NW",
    clientConfirmed: true,
    confidence: "address",
    lat: 53.54,
    lng: -113.49,
    mapboxId: "mbx-pre",
  }],
};

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    state: {
      services: [{ slug: "swedish", name: "Swedish", prices: { 60: 120, 90: 160 } }],
      practitioners: [{
        id: "p-nabitu-kahindo",
        name: "Nabitu Kahindo",
        available: true,
        bookable: true,
        onboardingStatus: "approved",
        profileVisibility: "published",
      }],
      clients: [preClient],
      appointments: [],
      zones: [],
      settings: [{ clinic: { address: "Clinic St" } }],
    },
    idx: {
      services: { swedish: { slug: "swedish", name: "Swedish", prices: { 60: 120, 90: 160 } } },
      clients: { "c-pre": preClient },
      practitioners: {},
      settings: { clinic: { address: "Clinic St" }, gst: 0.05 },
    },
    api,
    run: async (fn) => fn(),
    refresh: async () => {},
    user: { role: "owner", name: "Owner", id: "u-owner" },
  }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { NewBookingDialog } from "./NewBookingDialog";

let host;
let root;

function mount(props = {}) {
  act(() => {
    root.render(createElement(NewBookingDialog, { open: true, onClose: () => {}, ...props }));
  });
}

function q(id) {
  return host.querySelector(`[data-testid='${id}']`) || document.body.querySelector(`[data-testid='${id}']`);
}

async function click(id) {
  const node = q(id);
  expect(node).toBeTruthy();
  await act(async () => { node.click(); });
}

async function type(id, value) {
  const node = q(id);
  expect(node).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function select(id, value) {
  const node = q(id);
  expect(node).toBeTruthy();
  await act(async () => {
    node.value = value;
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  api.searchClients.mockClear();
  api.createClient.mockClear();
  api.book.mockClear();
  api.clientWorkspace.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

test("preselected client opens in compact State A without search/dropdown/create form", async () => {
  mount({ clientId: "c-pre" });
  expect(q("new-booking-dialog")).toBeTruthy();
  expect(q("nb-client-selected")).toBeTruthy();
  expect(q("nb-client-name")?.textContent).toContain("Pat Lee");
  expect(q("nb-client-input")).toBeFalsy();
  expect(q("nb-client-select")).toBeFalsy();
  expect(q("nb-client-create")).toBeFalsy();
  expect(q("nb-create-patient")).toBeFalsy();
});

test("search and select keeps service/date while changing clients", async () => {
  mount();
  await select("nb-service-select", "swedish");
  await select("nb-duration-select", "90");
  const date = q("nb-date-input")?.value;
  await type("nb-client-input", "Amy");
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  await click("nb-client-hit-c-amy");
  expect(q("nb-client-selected")).toBeTruthy();
  expect(q("nb-duration-select")?.value).toBe("90");
  expect(q("nb-date-input")?.value).toBe(date);
  await click("nb-client-change");
  expect(q("nb-client-search")).toBeTruthy();
  expect(q("nb-duration-select")?.value).toBe("90");
  expect(q("nb-date-input")?.value).toBe(date);
});

test("create new client from booking dialog selects it and hides create panel", async () => {
  mount();
  await click("nb-client-new");
  expect(q("nb-client-create")).toBeTruthy();
  await type("nb-client-new-first", "Sam");
  await type("nb-client-new-last", "Ortiz");
  await type("nb-client-new-phone", "7805550111");
  api.searchClients.mockResolvedValueOnce({ clients: [], duplicates: [] });
  await click("nb-client-create-save");
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(api.createClient).toHaveBeenCalled();
  expect(q("nb-client-selected")).toBeTruthy();
  expect(q("nb-client-create")).toBeFalsy();
});

test("cancel creation returns to search without a client record", async () => {
  mount();
  await click("nb-client-new");
  await type("nb-client-new-first", "Temp");
  await click("nb-client-create-cancel");
  expect(q("nb-client-search")).toBeTruthy();
  expect(api.createClient).not.toHaveBeenCalled();
});

test("mobile-friendly selected card stays compact and no permanent registration form is shown", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  mount({ clientId: "c-pre" });
  const card = q("nb-client-selected");
  expect(card).toBeTruthy();
  expect(q("nb-client-create")).toBeFalsy();
  expect(q("nb-client-input")).toBeFalsy();
  expect(host.textContent).not.toContain("Or create a patient");
});

test("search selection hydrates saved addresses for mobile booking", async () => {
  mount();
  await type("nb-client-input", "Amy");
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  await click("nb-client-hit-c-amy");
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(api.clientWorkspace).toHaveBeenCalledWith("c-amy");
  await select("nb-location-select", "home");
  expect(q("nb-address-line")?.textContent).toMatch(/10150 104 St NW/);
  expect(q("nb-address-unconfirmed")).toBeFalsy();
});

test("unconfirmed saved address blocks mobile booking", async () => {
  const unconfirmed = {
    ...preClient,
    id: "c-open",
    addresses: [{ id: "ad-open", line: "10150 104 St NW", clientConfirmed: false }],
  };
  // Remount store is fixed; override selected client by mounting with known id after patching idx via hydrate skip.
  api.clientWorkspace.mockResolvedValueOnce({ client: unconfirmed });
  mount({ clientId: "c-open" });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await select("nb-location-select", "home");
  expect(q("nb-address-unconfirmed")?.textContent).toMatch(/not been confirmed|cannot be used|no saved address/i);
  expect(q("nb-save-btn")?.disabled).toBe(true);
});

test("mobile booking posts confirmed address id and schema", async () => {
  mount({ clientId: "c-pre" });
  await select("nb-location-select", "home");
  const timeSelect = q("nb-time-select");
  // Inject a selectable open time into the empty fixture list.
  await act(async () => {
    const option = document.createElement("option");
    option.value = "10:00";
    option.textContent = "10:00 AM";
    timeSelect.appendChild(option);
    timeSelect.value = "10:00";
    timeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(q("nb-save-btn")?.disabled).toBe(false);
  await click("nb-save-btn");
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(api.book).toHaveBeenCalled();
  const payload = api.book.mock.calls[0][0];
  expect(payload.appointment.addressId).toBe("ad-pre");
  expect(payload.appointment.address).toEqual(expect.objectContaining({
    id: "ad-pre",
    line: "10150 104 St NW",
    clientConfirmed: true,
    mapboxId: "mbx-pre",
  }));
});
