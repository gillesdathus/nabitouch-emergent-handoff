import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { addDays, todayISO } from "@/lib/domain";

vi.mock("@/components/LiveMap", () => ({ LiveMap: () => createElement("div", { "data-testid": "route-map-live" }) }));
vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    practitionerId: "p-nabitu-kahindo",
    idx: { services: { swedish: { name: "Swedish" } }, clients: { "c-1": { firstName: "Sam" } } },
    state: {
      practitioners: [{ id: "p-nabitu-kahindo", name: "Nabitu" }],
      appointments: globalThis.__ROUTE_APPTS || [],
    },
    api: {
      dailyRoute: async () => globalThis.__ROUTE_PAYLOAD || { stops: [], gaps: [], rules: { setupMin: 10, cleanupMin: 15, travelBufferMin: 10 }, warnings: [] },
      scheduleOverview: async () => null,
    },
  }),
}));

import DailyRoute from "./DailyRoute";

async function renderRoute(appts, payload) {
  globalThis.__ROUTE_APPTS = appts;
  globalThis.__ROUTE_PAYLOAD = payload;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(DailyRoute, { mode: "pro" })));
  });
  await act(async () => { await Promise.resolve(); });
  return { host, root };
}

test("shows no destinations today and next mobile visit", async () => {
  const today = todayISO();
  const { host, root } = await renderRoute(
    [
      { id: "a-clinic", practitionerId: "p-nabitu-kahindo", date: today, time: "09:00", status: "assigned", locationType: "clinic", serviceSlug: "swedish", duration: 60, address: { line: "Clinic" } },
      { id: "a-future", practitionerId: "p-nabitu-kahindo", date: addDays(today, 2), time: "11:00", status: "assigned", locationType: "home", serviceSlug: "swedish", duration: 60, address: { line: "777 Home St" } },
    ],
    {
      stops: [{ stop: { id: "clinic-1", time: "09:00", duration: 60, ref: "NT-1", locationType: "clinic", position: { lat: 1, lng: 2 }, maps: "https://maps.example" } }],
      gaps: [],
      rules: { setupMin: 10, cleanupMin: 15, travelBufferMin: 10 },
      warnings: [],
    },
  );
  expect(host.querySelector("[data-testid='route-no-destinations-today']")?.textContent).toContain("No destinations today");
  expect(host.querySelector("[data-testid='route-next-destination']")?.textContent).toContain("777 Home St");
  expect(host.querySelector("[data-testid='route-stop-clinic-1']")).toBeNull();
  act(() => root.unmount());
  host.remove();
});

test("cycles multiple future mobile destinations", async () => {
  const today = todayISO();
  const { host, root } = await renderRoute(
    [
      { id: "a1", practitionerId: "p-nabitu-kahindo", date: addDays(today, 1), time: "10:00", status: "assigned", locationType: "home", serviceSlug: "swedish", duration: 60, address: { line: "A St" } },
      { id: "a2", practitionerId: "p-nabitu-kahindo", date: addDays(today, 3), time: "12:00", status: "assigned", locationType: "home", serviceSlug: "swedish", duration: 60, address: { line: "B Ave" } },
    ],
    { stops: [], gaps: [], rules: { setupMin: 10, cleanupMin: 15, travelBufferMin: 10 }, warnings: [] },
  );
  expect(host.textContent).toContain("A St");
  await act(async () => { host.querySelector("[data-testid='route-next-destination-cycle']").click(); });
  expect(host.textContent).toContain("B Ave");
  act(() => root.unmount());
  host.remove();
});
