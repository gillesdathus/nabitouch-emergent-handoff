import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { VisualCalendar } from "./VisualCalendar";

const visit = {
  id: "apt-1",
  date: "2026-10-14",
  time: "10:00",
  duration: 60,
  status: "confirmed",
  clientId: "c1",
  practitionerId: "p1",
  serviceSlug: "relax",
  pricing: { total: 120 },
};

beforeEach(() => { window.matchMedia = (q) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }); });
afterEach(() => { delete window.matchMedia; });

function render(props) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(createElement(VisualCalendar, props)); });
  return {
    host,
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

test("day view places a real appointment and an empty hour opens a slot", () => {
  const onOpen = vi.fn();
  const onSlot = vi.fn();
  const view = render({
    appointments: [visit],
    practitioners: [{ id: "p1", name: "Maya", color: "#1565F0" }],
    services: { relax: { name: "Relaxation" } },
    clients: { c1: { firstName: "Amina" } },
    cursor: "2026-10-14",
    onCursor: vi.fn(),
    onOpen,
    onSlot,
  });
  const card = view.host.querySelector("[data-testid='calendar-appointment-apt-1']");
  expect(card.textContent).toContain("Amina");
  expect(card.textContent).toContain("Relaxation");
  act(() => { card.click(); });
  expect(onOpen).toHaveBeenCalledWith("apt-1");
  const hour = [...view.host.querySelectorAll("button")].find((button) => button.getAttribute("aria-label")?.includes("Oct 14 9:00 AM"));
  expect(hour).toBeTruthy();
  act(() => { hour.click(); });
  expect(onSlot).toHaveBeenCalled();
  view.unmount();
});

test("month view lists the appointment on its date", () => {
  const view = render({
    appointments: [visit],
    practitioners: [],
    services: { relax: { name: "Relaxation" } },
    clients: { c1: { firstName: "Amina" } },
    cursor: "2026-10-14",
    onCursor: vi.fn(),
  });
  act(() => { view.host.querySelector("[data-testid='calendar-view-month']").click(); });
  expect(view.host.querySelector("[data-testid='calendar-month-2026-10-14']").textContent).toContain("Amina");
  view.unmount();
});
