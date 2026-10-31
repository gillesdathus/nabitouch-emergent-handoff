import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { ENGAGE_SCREENING, getEngageEvent } from "@/fixtures/engage";

vi.mock("@/lib/engageApi", () => ({
  loadEngageEvent: async (eventId) => ({ event: getEngageEvent(eventId), source: "fixture", error: null }),
  submitEngageCheckIn: async () => ({
    ok: true,
    result: {
      checkIn: { checkInCode: "NT-AUR-AR1100", writeMode: "prototype", privateFollowUp: false },
      writesEnabled: false,
      privateFollowUp: false,
      message: "Checked in (prototype).",
    },
    error: null,
  }),
  buildEngageCheckInPayload: (answers) => answers,
  normalizeEngageEvent: (raw) => raw,
}));

import EngageApp from "./EngageApp";

function mount(entry = "/engage/aurora-chair-day?mode=phone") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  return {
    host,
    async render() {
      await act(async () => {
        root.render(
          createElement(
            MemoryRouter,
            { initialEntries: [entry] },
            createElement(
              Routes,
              null,
              createElement(Route, { path: "/engage", element: createElement(EngageApp) }),
              createElement(Route, { path: "/engage/:eventId", element: createElement(EngageApp) }),
            ),
          ),
        );
      });
    },
    async click(testId) {
      const node = host.querySelector(`[data-testid='${testId}']`);
      expect(node).toBeTruthy();
      await act(async () => {
        node.click();
      });
    },
    async type(testId, value) {
      const node = host.querySelector(`[data-testid='${testId}']`);
      expect(node).toBeTruthy();
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        setter?.call(node, value);
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
  sessionStorage.clear();
  vi.stubGlobal("matchMedia", (query) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

test("phone mode opens welcome for synthetic event", async () => {
  const view = mount();
  await view.render();
  expect(view.host.querySelector("[data-testid='engage-shell']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='engage-demo-banner']").textContent).toMatch(/Synthetic demo/);
  expect(view.host.querySelector("[data-testid='engage-event-chip']").textContent).toMatch(/Aurora/);
  expect(view.host.querySelector("[data-testid='engage-step-welcome']")).toBeTruthy();
  view.unmount();
});

test("tablet mode shows idle Start before flow", async () => {
  const view = mount("/engage/aurora-chair-day?mode=tablet");
  await view.render();
  expect(view.host.querySelector("[data-testid='engage-idle']")).toBeTruthy();
  await view.click("engage-start");
  expect(view.host.querySelector("[data-testid='engage-step-welcome']")).toBeTruthy();
  view.unmount();
});

test("contact validation blocks continue until fields are valid", async () => {
  const view = mount();
  await view.render();
  await view.click("engage-welcome-continue");
  expect(view.host.querySelector("[data-testid='engage-step-contact']")).toBeTruthy();
  await view.click("engage-continue");
  expect(view.host.querySelector("[data-testid='engage-hint']").textContent).toMatch(/name/i);
  await view.type("engage-first-name", "Alex");
  await view.type("engage-last-name", "Rivera");
  await view.type("engage-email", "alex@aurora.test");
  await view.type("engage-phone", "7805550100");
  await view.click("engage-continue");
  expect(view.host.querySelector("[data-testid='engage-step-slot']")).toBeTruthy();
  view.unmount();
});

test("hard screening routes to private follow-up without employer disclosure copy", async () => {
  const view = mount();
  await view.render();
  await view.click("engage-welcome-continue");
  await view.type("engage-first-name", "Alex");
  await view.type("engage-last-name", "Rivera");
  await view.type("engage-email", "alex@aurora.test");
  await view.type("engage-phone", "7805550100");
  await view.click("engage-continue");
  await view.click("engage-slot-s-1100");
  await view.click("engage-continue");

  // First screening question: unwell → Yes (hard stop after all answered)
  await view.click("engage-screen-unwell-yes");
  await view.click("engage-continue");
  for (let i = 1; i < ENGAGE_SCREENING.length; i += 1) {
    const q = ENGAGE_SCREENING[i];
    await view.click(`engage-screen-${q.id}-no`);
    await view.click("engage-continue");
  }
  // Last continue submits check-in then opens private path.
  await act(async () => {
    await Promise.resolve();
  });
  expect(view.host.querySelector("[data-testid='engage-step-private']")).toBeTruthy();
  expect(view.host.textContent).toMatch(/shared with your employer/i);
  expect(view.host.textContent).toMatch(/not why/i);
  view.unmount();
});
