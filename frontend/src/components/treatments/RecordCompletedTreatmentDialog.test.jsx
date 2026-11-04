import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, test, vi } from "vitest";

const api = {
  searchClients: vi.fn(async () => ({ clients: [], duplicates: [] })),
  recordCompletedTreatment: vi.fn(async (body) => ({
    appointment: { id: "a-1", source: body.source, serviceDate: body.serviceDate },
    client: { id: "c-1", firstName: body.newClient?.firstName },
    clientCreated: true,
    replayed: false,
  })),
};

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    state: {
      services: [{ slug: "swedish", name: "Swedish", prices: { 60: 95 } }],
      practitioners: [{
        id: "p-nabitu-kahindo",
        name: "Nabitu Kahindo",
        available: true,
        onboardingStatus: "approved",
        profileVisibility: "published",
      }],
      clients: [],
      appointments: [],
      settings: [{ clinic: { address: "Clinic St" } }],
    },
    idx: {
      services: { swedish: { slug: "swedish", name: "Swedish", prices: { 60: 95 } } },
      clients: {},
      practitioners: { "p-nabitu-kahindo": { id: "p-nabitu-kahindo", name: "Nabitu Kahindo" } },
      settings: { clinic: { address: "Clinic St" } },
    },
    api,
    run: async (fn) => fn(),
    refresh: async () => {},
    perm: () => true,
    user: { role: "owner", name: "Owner" },
  }),
}));

vi.mock("@/components/AddressPicker", () => ({
  AddressPicker: ({ onChange, testid }) => createElement(
    "button",
    {
      type: "button",
      "data-testid": testid || "addr",
      onClick: () => onChange({ line: "10150 104 St NW, Edmonton, AB", lat: 53.5, lng: -113.5 }),
    },
    "Pick address",
  ),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { RecordCompletedTreatmentDialog } from "./RecordCompletedTreatmentDialog";

function mount(props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  return {
    host,
    async render() {
      await act(async () => {
        root.render(createElement(RecordCompletedTreatmentDialog, { open: true, onClose: () => {}, ...props }));
      });
    },
    q(testId) {
      return host.querySelector(`[data-testid='${testId}']`) || document.body.querySelector(`[data-testid='${testId}']`);
    },
    async click(testId) {
      const node = this.q(testId);
      expect(node).toBeTruthy();
      await act(async () => { node.click(); });
    },
    async type(testId, value) {
      const node = this.q(testId);
      expect(node).toBeTruthy();
      await act(async () => {
        const proto = node.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        setter.call(node, value);
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
      });
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  api.searchClients.mockClear();
  api.recordCompletedTreatment.mockClear();
});

test("first screen asks existing vs new client", async () => {
  const view = mount();
  await view.render();
  expect(view.q("record-completed-treatment-dialog")).toBeTruthy();
  expect(document.body.textContent).toMatch(/Is this an existing client or a new client/);
  expect(view.q("rct-existing")).toBeTruthy();
  expect(view.q("rct-new")).toBeTruthy();
  view.unmount();
});

test("new client path records Nov 3 treatment without requiring email", async () => {
  const onClose = vi.fn();
  const view = mount({ onClose });
  await view.render();
  await view.click("rct-new");
  await view.type("rct-new-first", "Synth");
  await view.type("rct-new-last", "Client");
  await view.type("rct-new-phone", "7805550100");
  await view.click("rct-new-address");
  await view.click("rct-create-continue");
  expect(view.q("rct-step-details")).toBeTruthy();
  await view.type("rct-date", "2026-11-03");
  await view.type("rct-time", "14:00");
  await view.type("rct-charge", "95");
  await view.click("rct-to-review");
  expect(view.q("rct-step-review")).toBeTruthy();
  await view.click("rct-save");
  expect(api.recordCompletedTreatment).toHaveBeenCalled();
  const body = api.recordCompletedTreatment.mock.calls[0][0];
  expect(body.newClient.firstName).toBe("Synth");
  expect(body.newClient.email || "").toBe("");
  expect(body.serviceDate).toBe("2026-11-03");
  expect(body.source).toBe("historical_manual");
  expect(body.completed).toBe(true);
  expect(onClose).toHaveBeenCalled();
  view.unmount();
});
