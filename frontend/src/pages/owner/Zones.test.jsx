import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";

const { patch, storeApi } = vi.hoisted(() => {
  const patchFn = vi.fn(async () => ({}));
  return {
    patch: patchFn,
    storeApi: {
      insurers: async () => ({ providers: [] }),
      patch: patchFn,
      geoMunicipalities: async () => ({
        municipalities: [
          { id: "4811061", csdUid: "4811061", name: "Edmonton", type: "City", aliases: [], communities: [] },
          { id: "4811049", csdUid: "4811049", name: "Spruce Grove", type: "City", aliases: [], communities: [] },
          { id: "4811052", csdUid: "4811052", name: "Strathcona County", type: "Specialized municipality", aliases: ["Sherwood Park"], communities: ["Sherwood Park"], note: "Sherwood Park is a community within Strathcona County." },
        ],
      }),
      geoMunicipalitySearch: async () => ({ match: "catalogue", municipality: { id: "4811052", name: "Strathcona County" } }),
    },
  };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  api: {
    etransferSettings: async () => ({ recipientEmail: "", recipientName: "", instructions: "", referenceFormat: "" }),
    geoSuggest: async () => ({ suggestions: [] }),
    geoClinicConfirm: async () => ({ accepted: false, navigation: "unavailable" }),
    geoMunicipalities: storeApi.geoMunicipalities,
    geoMunicipalitySearch: storeApi.geoMunicipalitySearch,
    teamDirectory: async () => ({ people: [] }),
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
        serviceCoverage: { mode: "open", radiusKm: 25, travelFeesEnabled: false, municipalityIds: [], customMunicipalities: [] },
      },
    },
    api: storeApi,
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

test("owner can set open service coverage and keep travel fees off by default", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Zones)); });
  const mode = host.querySelector("[data-testid='settings-coverage-mode']");
  expect(mode).toBeTruthy();
  expect(mode.value).toBe("open");
  expect(host.querySelector("[data-testid='settings-travel-fees-switch']")).toBeTruthy();
  await act(async () => {
    mode.value = "radius";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const confirm = document.querySelector("[data-testid='settings-coverage-mode-confirm-confirm']");
  expect(confirm).toBeTruthy();
  await act(async () => { confirm.click(); });
  expect(patch.mock.calls.at(-1)[2].serviceCoverage.mode).toBe("radius");
  act(() => root.unmount());
  host.remove();
}, 20000);
