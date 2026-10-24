import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, test, vi } from "vitest";

const { geoMunicipalities } = vi.hoisted(() => ({
  geoMunicipalities: vi.fn(async () => ({
    municipalities: [
      { id: "4811061", csdUid: "4811061", name: "Edmonton", type: "City", aliases: [], communities: [] },
      { id: "4811049", csdUid: "4811049", name: "Spruce Grove", type: "City", aliases: [], communities: [] },
      {
        id: "4811052", csdUid: "4811052", name: "Strathcona County", type: "Specialized municipality",
        aliases: ["Sherwood Park"], communities: ["Sherwood Park"],
        note: "Sherwood Park is a community within Strathcona County, not a separate municipality.",
      },
    ],
  })),
}));

vi.mock("@/lib/api", () => ({
  api: { geoMunicipalities, geoMunicipalitySearch: vi.fn() },
  apiError: (e) => String(e?.message || e),
}));

import { MunicipalityCoverage } from "./MunicipalityCoverage";

beforeEach(() => {
  geoMunicipalities.mockClear();
});

test("owner can search, select municipalities, and save coverage", async () => {
  const onSave = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(MunicipalityCoverage, {
      coverage: { mode: "zones", municipalityIds: [], customMunicipalities: [], travelFeesEnabled: false, radiusKm: 25 },
      appointments: [],
      onSave,
    }));
  });
  await act(async () => { await Promise.resolve(); });
  expect(host.querySelector("[data-testid='settings-coverage-locations']")).toBeTruthy();
  await act(async () => {
    host.querySelector("[data-testid='settings-coverage-muni-check-4811061']").click();
    host.querySelector("[data-testid='settings-coverage-muni-check-4811049']").click();
  });
  await act(async () => {
    const search = host.querySelector("[data-testid='settings-coverage-muni-search']");
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setValue.call(search, "Sherwood");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelector("[data-testid='settings-coverage-muni-4811052']").textContent).toMatch(/Sherwood Park/);
  await act(async () => {
    host.querySelector("[data-testid='settings-coverage-muni-check-4811052']").click();
  });
  expect(host.querySelector("[data-testid='settings-coverage-selected-summary']").textContent).toMatch(/3 selected/);
  await act(async () => {
    host.querySelector("[data-testid='settings-coverage-locations-save']").click();
  });
  const confirm = document.querySelector("[data-testid='settings-coverage-confirm-confirm']");
  expect(confirm).toBeTruthy();
  await act(async () => { confirm.click(); });
  expect(onSave).toHaveBeenCalled();
  const payload = onSave.mock.calls.at(-1)[0];
  expect(payload.mode).toBe("zones");
  expect(payload.municipalityIds).toEqual(expect.arrayContaining(["4811061", "4811049", "4811052"]));
  expect(payload.travelFeesEnabled).toBe(false);
  act(() => root.unmount());
  host.remove();
}, 20000);
