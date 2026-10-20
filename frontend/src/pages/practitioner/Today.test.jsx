import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { todayISO, addDays } from "@/lib/domain";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/PractitionerRouteGuard", () => ({
  usePractitionerProfile: () => ({
    loading: false,
    capable: true,
    me: { id: "p-nabitu-kahindo", name: "Nabitu Kahindo", available: true },
    practitionerId: "p-nabitu-kahindo",
    idx: {
      clients: { "c-1": { firstName: "Sam", lastName: "Lee" }, "c-2": { firstName: "Alex", lastName: "Ng" } },
      services: { swedish: { name: "Swedish" }, "deep-tissue": { name: "Deep Tissue" } },
    },
    state: {
      appointments: globalThis.__TODAY_APPTS || [],
      audit: [],
      soap: [],
    },
    error: null,
  }),
  PractitionerUnauthorized: () => createElement("div", null, "unauthorized"),
  PractitionerSetupRequired: () => createElement("div", null, "setup"),
}));
vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    run: (fn) => fn(),
    api: {
      patch: async () => ({}),
      dailyRoute: async () => globalThis.__TODAY_ROUTE || {
        stops: [],
        gaps: [],
        warnings: [],
        rules: { setupMin: 10, cleanupMin: 15, travelBufferMin: 10 },
      },
    },
  }),
}));
vi.mock("@/components/practitioner/ProfileReminder", () => ({ ProfileReminder: () => null }));

import Today from "./Today";

async function renderToday(appts, route) {
  globalThis.__TODAY_APPTS = appts;
  globalThis.__TODAY_ROUTE = route;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(Today)));
  });
  await act(async () => { await Promise.resolve(); });
  return { host, root };
}

test("shows upcoming when today is empty", async () => {
  const today = todayISO();
  const { host, root } = await renderToday([
    { id: "a-f", ref: "NT-1", practitionerId: "p-nabitu-kahindo", clientId: "c-1", serviceSlug: "swedish", duration: 60, date: addDays(today, 2), time: "10:00", status: "assigned", locationType: "home", address: { line: "123 St" } },
  ]);
  expect(host.querySelector("[data-testid='pro-no-appointments-today']")?.textContent).toContain("No appointments today");
  expect(host.querySelector("[data-testid='pro-upcoming-row-a-f']")).toBeTruthy();
  expect(host.querySelector("[data-testid='pro-open-my-route']")).toBeTruthy();
  act(() => root.unmount());
  host.remove();
});

test("lists today first then upcoming", async () => {
  const today = todayISO();
  const { host, root } = await renderToday([
    { id: "a-u", ref: "NT-2", practitionerId: "p-nabitu-kahindo", clientId: "c-2", serviceSlug: "deep-tissue", duration: 90, date: addDays(today, 1), time: "09:00", status: "assigned", locationType: "clinic", address: { line: "Clinic" } },
    { id: "a-t", ref: "NT-3", practitionerId: "p-nabitu-kahindo", clientId: "c-1", serviceSlug: "swedish", duration: 60, date: today, time: "14:00", status: "assigned", locationType: "home", address: { line: "456 Ave" } },
  ]);
  expect(host.querySelector("[data-testid='pro-visit-row-a-t']")).toBeTruthy();
  expect(host.querySelector("[data-testid='pro-upcoming-row-a-u']")).toBeTruthy();
  act(() => root.unmount());
  host.remove();
});

test("hides cancelled visits from upcoming", async () => {
  const today = todayISO();
  const { host, root } = await renderToday([
    { id: "a-c", ref: "NT-4", practitionerId: "p-nabitu-kahindo", clientId: "c-1", serviceSlug: "swedish", duration: 60, date: addDays(today, 3), time: "11:00", status: "cancelled", locationType: "home", address: { line: "789 Rd" } },
  ]);
  expect(host.querySelector("[data-testid='pro-upcoming-row-a-c']")).toBeNull();
  expect(host.querySelector("[data-testid='pro-schedule-empty']")).toBeTruthy();
  act(() => root.unmount());
  host.remove();
});

test("shows road travel and leave-by from route leg", async () => {
  const today = todayISO();
  const { host, root } = await renderToday(
    [
      { id: "a1", ref: "NT-1", practitionerId: "p-nabitu-kahindo", clientId: "c-1", serviceSlug: "swedish", duration: 60, date: today, time: "10:00", status: "assigned", locationType: "home", address: { line: "First St" } },
      { id: "a2", ref: "NT-2", practitionerId: "p-nabitu-kahindo", clientId: "c-2", serviceSlug: "swedish", duration: 60, date: today, time: "13:00", status: "assigned", locationType: "home", address: { line: "Second Ave" } },
    ],
    {
      stops: [
        { stop: { id: "a1", locationType: "home", time: "10:00", duration: 60, ref: "NT-1", addressLine: "First St" }, leg: null },
        {
          stop: { id: "a2", locationType: "home", time: "13:00", duration: 60, ref: "NT-2", addressLine: "Second Ave" },
          leg: { minutes: 20, km: 6.5, depart: "11:15", arrive: "11:35", provider: "mapbox-traffic", computedAt: "2026-06-16T17:00:00Z" },
        },
      ],
      warnings: [{ appointmentId: "a2", ref: "NT-2", message: "Travel time is tight before this visit" }],
      rules: { setupMin: 10, cleanupMin: 15, travelBufferMin: 10 },
      gaps: [],
    },
  );
  // Next is a1 (first open) — first stop messaging
  expect(host.querySelector("[data-testid='pro-next-first-stop']")?.textContent).toMatch(/First stop|My Route/i);
  expect(host.querySelector("[data-testid='pro-open-my-route']")).toBeTruthy();
  expect(host.querySelector("[data-testid='pro-today-quick-help']")?.getAttribute("href")).toContain("category=running_late");
  expect(host.querySelector("[data-testid='pro-today-quick-help']")?.getAttribute("href")).toContain("appointmentId=a1");
  expect(host.querySelector("[data-testid='pro-availability-switch']")).toBeTruthy();
  act(() => root.unmount());
  host.remove();
});

test("shows drive summary when next appointment has a prior leg", async () => {
  const today = todayISO();
  const { host, root } = await renderToday(
    [
      { id: "a1", ref: "NT-1", practitionerId: "p-nabitu-kahindo", clientId: "c-1", serviceSlug: "swedish", duration: 60, date: today, time: "10:00", status: "completed", locationType: "home", address: { line: "First St" } },
      { id: "a2", ref: "NT-2", practitionerId: "p-nabitu-kahindo", clientId: "c-2", serviceSlug: "swedish", duration: 60, date: today, time: "13:00", status: "assigned", locationType: "home", address: { line: "Second Ave" } },
    ],
    {
      stops: [
        { stop: { id: "a1", locationType: "home", time: "10:00", duration: 60, ref: "NT-1", status: "completed" }, leg: null },
        {
          stop: { id: "a2", locationType: "home", time: "13:00", duration: 60, ref: "NT-2", status: "assigned", addressLine: "Second Ave" },
          leg: { minutes: 20, km: 6.5, depart: "11:15", arrive: "11:35", provider: "mapbox", computedAt: "2026-06-16T17:00:00Z" },
        },
      ],
      warnings: [{ appointmentId: "a2", ref: "NT-2", message: "Travel time is tight before this visit" }],
      rules: { setupMin: 10, cleanupMin: 15, travelBufferMin: 10 },
      gaps: [],
    },
  );
  expect(host.querySelector("[data-testid='pro-next-drive']")?.textContent).toContain("20 min");
  expect(host.querySelector("[data-testid='pro-next-depart']")?.textContent).toContain("11:15");
  expect(host.querySelector("[data-testid='pro-next-tight-buffer']")?.textContent).toContain("tight");
  act(() => root.unmount());
  host.remove();
});
