import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";

const patch = vi.fn(async () => ({}));
const api = { insurers: async () => ({ providers: [] }), patch };

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  api: {
    etransferSettings: async () => ({ recipientEmail: "", recipientName: "", instructions: "", referenceFormat: "" }),
    geoSuggest: async () => ({ suggestions: [] }),
    geoClinicConfirm: async () => ({ accepted: false, navigation: "unavailable" }),
  },
  apiError: () => "unavailable",
}));
vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    state: { zones: [{ id: "z-central", name: "Central", radiusKm: 6, fee: 0, color: "#1565F0", enabled: true }], appointments: [{ id: "a-partial" }] },
    idx: {
      settings: {
        gst: 0.05,
        addons: [],
        scheduling: {},
        clinic: { enabled: true, address: "10150 104 St NW, Edmonton, AB", lat: 53.5461, lng: -113.4938, coordinatesVerified: false, mobileEnabled: true, name: "Nabitouch" },
        paymentPolicy: { mode: "choice", depositType: "percent", depositPercent: 25, depositCents: 0, cashAccepted: true },
      },
    },
    api,
    user: { name: "Owner" },
    run: (work) => work(),
  }),
}));

import Zones from "./Zones";

test("an unconfirmed clinic edit drops coordinates instead of keeping downtown", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Zones)); });
  expect(host.querySelector("[data-testid='settings-clinic-navigation']").textContent).toContain("Navigation is unavailable");
  await act(async () => { host.querySelector("[data-testid='settings-clinic-address-edit']").click(); });
  await act(async () => { host.querySelector("[data-testid='settings-clinic-address-save']").click(); });
  const body = patch.mock.calls.at(-1)[2].clinic;
  expect(body.address).toBe("10150 104 St NW, Edmonton, AB");
  expect(body.confirmation).toBeUndefined();
  expect(body.lat).toBeUndefined();
  expect(body.lng).toBeUndefined();
  expect(body.enabled).toBe(false);
  act(() => root.unmount());
  host.remove();
}, 20000);
