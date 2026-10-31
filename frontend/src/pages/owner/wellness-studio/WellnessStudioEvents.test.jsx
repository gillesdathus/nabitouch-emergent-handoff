import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";

const engageStatus = vi.fn();
const engageEvents = vi.fn();
const engageAttendance = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    engageStatus: (...args) => engageStatus(...args),
    engageEvents: (...args) => engageEvents(...args),
    engageAttendance: (...args) => engageAttendance(...args),
  },
  apiError: () => "Engage API unavailable",
}));

import WellnessStudioEvents from "./WellnessStudioEvents";

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  return {
    host,
    async render() {
      await act(async () => {
        root.render(createElement(MemoryRouter, { initialEntries: ["/owner/wellness-studio/events"] }, createElement(WellnessStudioEvents)));
      });
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  engageStatus.mockReset();
  engageEvents.mockReset();
  engageAttendance.mockReset();
});

test("events page loads live Engage attendance without clinical fields", async () => {
  engageStatus.mockResolvedValue({
    publicEnabled: true,
    writesEnabled: false,
    serviceReady: true,
    serviceSlug: "workplace-chair",
    blockers: [],
  });
  engageEvents.mockResolvedValue({
    events: [{
      id: "aurora-chair-day",
      name: "Aurora · Chair massage day",
      date: "2026-11-06",
      timeWindow: "11:00–15:00",
      seatsRemaining: 10,
    }],
  });
  engageAttendance.mockResolvedValue({
    attendance: [{
      id: "eg-1",
      firstName: "Alex",
      lastName: "Rivera",
      slotLabel: "11:00",
      checkInCode: "NT-AUR-AR1100",
      status: "checked_in",
      privateFollowUp: false,
    }],
  });

  const view = mount();
  await view.render();
  await act(async () => { await Promise.resolve(); });
  expect(view.host.querySelector("[data-testid='wellness-studio-events']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='ws-events-engage-status']").textContent).toMatch(/Public on/);
  expect(view.host.querySelector("[data-testid='ws-att-eg-1']").textContent).toMatch(/Alex/);
  expect(view.host.querySelector("[data-testid='ws-att-eg-1']").textContent).not.toMatch(/unwell|fever|allergy/i);
  expect(view.host.querySelector("[data-testid='ws-events-open-engage']").getAttribute("href")).toBe("/engage/aurora-chair-day?mode=phone");
  view.unmount();
});

test("events page falls back when Engage API is offline", async () => {
  engageStatus.mockRejectedValue(new Error("down"));
  engageEvents.mockRejectedValue(new Error("down"));
  const view = mount();
  await view.render();
  await act(async () => { await Promise.resolve(); });
  expect(view.host.querySelector("[data-testid='ws-events-engage-offline']")).toBeTruthy();
  expect(view.host.textContent).toMatch(/Aurora/);
  view.unmount();
});
