import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { StickyActionBar } from "./StickyActionBar";

function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

test("StickyActionBar uses shared nb-sticky-actions token classes (no hardcoded bottom offsets)", () => {
  const view = mount(createElement(StickyActionBar, { testid: "booking-actions" }, "Continue"));
  // Portaled to document.body so shell overflow cannot trap fixed positioning.
  const el = document.querySelector("[data-testid=booking-actions]");
  const spacer = view.host.querySelector("[data-testid=booking-actions-spacer]");
  expect(el).toBeTruthy();
  expect(el.className).toMatch(/nb-sticky-actions/);
  expect(el.className).toMatch(/nb-sticky-actions--md/);
  expect(el.className).not.toMatch(/bottom-\[64px\]/);
  expect(el.className).not.toMatch(/bottom-\[72px\]/);
  expect(view.host.contains(el)).toBe(false);
  expect(spacer).toBeTruthy();
  expect(spacer.className).toMatch(/nb-sticky-actions-spacer/);
  view.cleanup();
});

test("staff variant lifts at the lg breakpoint", () => {
  const view = mount(createElement(StickyActionBar, { liftAt: "lg", testid: "visit-actions" }, "Save"));
  const el = document.querySelector("[data-testid=visit-actions]");
  expect(el.className).toMatch(/nb-sticky-actions--lg/);
  view.cleanup();
});
