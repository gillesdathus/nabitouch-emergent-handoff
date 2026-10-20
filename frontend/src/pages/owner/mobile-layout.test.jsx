import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { VisualCalendar } from "@/components/ops/VisualCalendar";

const visit = {
  id: "apt-mobile-1",
  date: "2026-10-14",
  time: "10:00",
  duration: 60,
  status: "confirmed",
  clientId: "c1",
  practitionerId: "p1",
  serviceSlug: "relax",
  pricing: { total: 120 },
  paymentStatus: "pending",
  address: { line: "123 Very Long Avenue Northwest, Edmonton AB" },
};

function mount(node) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(createElement(MemoryRouter, null, node)); });
  return {
    host,
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

test("calendar day strip and mobile list stay readable for dense labels", () => {
  const view = mount(createElement(VisualCalendar, {
    appointments: [visit, { ...visit, id: "apt-mobile-2", time: "11:30", status: "en_route" }],
    practitioners: [{ id: "p1", name: "Nabitu Kahindo", color: "#1565F0" }],
    services: { relax: { name: "Swedish Massage Therapy Extended Session" } },
    clients: { c1: { firstName: "Alexandria-Marie", lastName: "Constantinopoulos" } },
    cursor: "2026-10-14",
    onCursor: vi.fn(),
    onOpen: vi.fn(),
    onPerson: vi.fn(),
    personId: "",
  }));
  expect(view.host.querySelector("[data-testid='calendar-day-strip']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='calendar-list']")).toBeTruthy();
  const card = view.host.querySelector("[data-testid='calendar-appointment-apt-mobile-1']");
  expect(card.textContent).toContain("Alexandria-Marie");
  expect(card.textContent).toContain("Swedish Massage");
  expect(card.textContent).toContain("Nabitu");
  expect(view.host.querySelector("[data-testid='calendar-practitioner']")).toBeTruthy();
  view.unmount();
});

test("week grid is contained in its own scroll area rather than page-wide", () => {
  window.matchMedia = (q) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} });
  const view = mount(createElement(VisualCalendar, {
    appointments: [visit],
    practitioners: [{ id: "p1", name: "Maya", color: "#1565F0" }],
    services: { relax: { name: "Relaxation" } },
    clients: { c1: { firstName: "Amina" } },
    cursor: "2026-10-14",
    onCursor: vi.fn(),
  }));
  act(() => { view.host.querySelector("[data-testid='calendar-view-week']").click(); });
  const wrap = view.host.querySelector("[data-testid='calendar-grid-wrap']");
  expect(wrap).toBeTruthy();
  expect(wrap.className).toContain("overflow-auto");
  view.unmount();
  delete window.matchMedia;
});
