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
  useDemo: () => ({ run: (fn) => fn(), api: { patch: async () => ({}) } }),
}));
vi.mock("@/components/practitioner/ProfileReminder", () => ({ ProfileReminder: () => null }));

import Today from "./Today";

async function renderToday(appts) {
  globalThis.__TODAY_APPTS = appts;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(Today)));
  });
  return { host, root };
}

test("shows upcoming when today is empty", async () => {
  const today = todayISO();
  const { host, root } = await renderToday([
    { id: "a-f", ref: "NT-1", practitionerId: "p-nabitu-kahindo", clientId: "c-1", serviceSlug: "swedish", duration: 60, date: addDays(today, 2), time: "10:00", status: "assigned", locationType: "home", address: { line: "123 St" } },
  ]);
  expect(host.querySelector("[data-testid='pro-no-appointments-today']")?.textContent).toContain("No appointments today");
  expect(host.querySelector("[data-testid='pro-upcoming-row-a-f']")).toBeTruthy();
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
