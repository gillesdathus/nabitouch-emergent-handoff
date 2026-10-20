import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach } from "vitest";
import { ClientTracker } from "./ui-kit";

function renderTracker(appt) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(createElement(ClientTracker, { appt })); });
  return {
    host,
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

afterEach(() => { document.body.innerHTML = ""; });

test("confirmed visit does not show Step 1 of 7", () => {
  const view = renderTracker({ id: "a-1", status: "confirmed" });
  expect(view.host.querySelector("[data-testid='client-tracker-label']").textContent).toBe("Confirmed");
  expect(view.host.textContent).not.toMatch(/Step \d+ of \d+/);
  expect(view.host.querySelector("[data-testid='client-tracker-detail']").textContent).toMatch(/practitioner/i);
  expect(view.host.querySelector("[data-testid='client-tracker-phase']").textContent).toMatch(/1\/7/);
  view.unmount();
});

test("prepared confirmed visit softens headline without advancing phase", () => {
  const view = renderTracker({ id: "a-1", status: "confirmed", readiness: { allReady: true } });
  expect(view.host.querySelector("[data-testid='client-tracker-label']").textContent).toBe("Ready for your visit");
  expect(view.host.querySelector("[data-testid='client-tracker-phase']").textContent).toMatch(/1\/7/);
  view.unmount();
});

test("en_route uses practitioner-on-the-way copy", () => {
  const view = renderTracker({ id: "a-1", status: "en_route" });
  expect(view.host.querySelector("[data-testid='client-tracker-label']").textContent).toBe("Practitioner on the way");
  expect(view.host.querySelector("[data-testid='client-tracker-phase']").textContent).toMatch(/3\/7/);
  view.unmount();
});

test("cancelled hides the phase bar", () => {
  const view = renderTracker({ id: "a-1", status: "cancelled" });
  expect(view.host.querySelector("[data-testid='client-tracker-label']").textContent).toBe("Cancelled");
  expect(view.host.querySelector("[data-testid='client-tracker-bar']")).toBeNull();
  expect(view.host.querySelector("[data-testid='client-tracker-phase']")).toBeNull();
  view.unmount();
});
