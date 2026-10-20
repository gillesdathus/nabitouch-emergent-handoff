import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { StepWhere } from "./BookingSteps";

const h = vi.hoisted(() => ({
  draft: {
    campaignId: "cmp-ten-minutes-on-us",
    serviceSlug: "ten-minutes-on-us",
    locationType: "home",
    address: null,
    addressQuery: "",
    addressNotes: "",
    forceWhere: true,
  },
  clinic: { enabled: false, address: "" },
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    draft: h.draft,
    patchDraft: (patch) => { Object.assign(h.draft, patch); },
    me: { addresses: [{ id: "ad-1", label: "Home", line: "123 Calm St, Edmonton", confidence: "address", clientConfirmed: true }] },
    state: { services: [{ slug: "ten-minutes-on-us", kind: "trial", name: "10 Minutes. On Us.", prices: { 10: 0 } }] },
    idx: { settings: { clinic: h.clinic } },
  }),
}));

vi.mock("@/components/AddressPicker", () => ({
  AddressPicker: () => createElement("div", { "data-testid": "step-where-address" }),
}));

function renderWhere() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(StepWhere)));
  });
  return {
    host,
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

test("trial Where step never offers In Clinic and never shows clinic-only copy", () => {
  h.clinic = { enabled: true, address: "10150 104 St NW, Edmonton, AB" };
  h.draft.locationType = "home";
  const view = renderWhere();
  expect(view.host.textContent).toMatch(/mobile visit/i);
  expect(view.host.textContent).not.toMatch(/free trial is in clinic/i);
  expect(view.host.textContent).not.toMatch(/Free trial · in clinic/i);
  expect(view.host.querySelector("[data-testid='step-where-clinic']")).toBeNull();
  expect(view.host.querySelector("[data-testid='step-where-home']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='step-where-office']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='step-where-hotel']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='step-where-event']")).toBeTruthy();
  view.unmount();
});

test("regular Where step hides clinic when clinic booking is disabled", () => {
  h.draft.campaignId = undefined;
  h.draft.serviceSlug = "swedish";
  h.clinic = { enabled: false, address: "" };
  const view = renderWhere();
  expect(view.host.querySelector("[data-testid='step-where-clinic']")).toBeNull();
  expect(view.host.querySelector("[data-testid='step-where-home']")).toBeTruthy();
  view.unmount();
});
