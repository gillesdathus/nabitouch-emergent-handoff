import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, test, vi } from "vitest";

const { geoTravelFeeEstimates } = vi.hoisted(() => ({
  geoTravelFeeEstimates: vi.fn(async () => ({
    travelFeesEnabled: true,
    estimates: [
      {
        municipalityId: "4811061",
        name: "Edmonton",
        covered: true,
        status: "ok",
        estimate: 18.5,
        drivingKm: 12.3,
        disclaimer: "Estimate only — not a guaranteed charge for a specific address.",
      },
      {
        municipalityId: "4811049",
        name: "Spruce Grove",
        covered: true,
        status: "unavailable",
        disclaimer: "Estimate only — not a guaranteed charge for a specific address.",
      },
    ],
  })),
}));

vi.mock("@/lib/api", () => ({
  api: { geoTravelFeeEstimates },
  apiError: (e) => String(e?.message || e),
}));

import { TravelFeesConfig } from "./TravelFeesConfig";

beforeEach(() => {
  geoTravelFeeEstimates.mockClear();
});

async function mount(props) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(TravelFeesConfig, props));
  });
  await act(async () => { await Promise.resolve(); });
  return {
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test("travel fees stay collapsed until enabled and save sends policy", async () => {
  const onSave = vi.fn(async () => {});
  const { host, unmount } = await mount({
    coverage: {
      mode: "zones",
      travelFeesEnabled: false,
      municipalityIds: ["4811061", "4811049"],
      travelFees: { baseFee: 0, perKm: 0, freeKm: 0, municipalityOverrides: {} },
    },
    onSave,
  });
  expect(host.querySelector("[data-testid='settings-travel-fees-form']")).toBeNull();
  await act(async () => {
    host.querySelector("[data-testid='settings-travel-fees-switch']").click();
  });
  expect(host.querySelector("[data-testid='settings-travel-fees-form']")).toBeTruthy();
  const setNative = (el, value) => {
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    proto.set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  await act(async () => {
    setNative(host.querySelector("[data-testid='settings-travel-base']"), "10");
    setNative(host.querySelector("[data-testid='settings-travel-per-km']"), "1.5");
    setNative(host.querySelector("[data-testid='settings-travel-free-km']"), "5");
  });
  await act(async () => {
    host.querySelector("[data-testid='settings-travel-fees-save']").click();
  });
  expect(onSave).toHaveBeenCalled();
  const payload = onSave.mock.calls[0][0];
  expect(payload.travelFeesEnabled).toBe(true);
  expect(payload.travelFees.baseFee).toBe(10);
  expect(payload.travelFees.perKm).toBe(1.5);
  expect(payload.travelFees.freeKm).toBe(5);
  await unmount();
});

test("municipality estimates mark unavailable without fabricating values", async () => {
  const { host, unmount } = await mount({
    coverage: {
      mode: "zones",
      travelFeesEnabled: true,
      municipalityIds: ["4811061", "4811049"],
      travelFees: { baseFee: 10, perKm: 1, municipalityOverrides: {} },
    },
    onSave: async () => {},
  });
  await act(async () => { await Promise.resolve(); });
  const edmonton = host.querySelector("[data-testid='settings-travel-estimate-4811061']");
  const spruce = host.querySelector("[data-testid='settings-travel-estimate-4811049']");
  expect(edmonton).toBeTruthy();
  expect(edmonton.textContent).toMatch(/Est\./);
  expect(edmonton.textContent).toMatch(/Estimate only/);
  expect(spruce.textContent).toMatch(/unavailable/i);
  await unmount();
});
