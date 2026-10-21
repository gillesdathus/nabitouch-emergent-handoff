import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "vitest";
import { bookingAddressOwnsActions, FlowStepShell } from "./FlowStepShell";

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

describe("FlowStepShell", () => {
  test("renders sticky actions portaled with scroll body", () => {
    const view = mount(createElement(
      FlowStepShell,
      {
        testid: "shell",
        actionsTestid: "shell-actions",
        actions: createElement("button", { type: "button", "data-testid": "shell-cta" }, "Continue"),
        hint: createElement("p", null, "Complete this step"),
      },
      createElement("p", { "data-testid": "shell-content" }, "Body"),
    ));
    expect(view.host.querySelector("[data-testid=shell-body]")).toBeTruthy();
    expect(view.host.querySelector("[data-testid=shell-content]")).toBeTruthy();
    const actions = document.querySelector("[data-testid=shell-actions]");
    expect(actions).toBeTruthy();
    expect(actions.className).toMatch(/nb-sticky-actions/);
    expect(view.host.contains(actions)).toBe(false);
    expect(actions.querySelector("[data-testid=shell-cta]")).toBeTruthy();
    expect(document.querySelector("[data-testid=shell-actions-hint]").textContent).toMatch(/Complete/);
    view.cleanup();
  });

  test("hideActions suppresses the sticky dock", () => {
    const view = mount(createElement(
      FlowStepShell,
      {
        hideActions: true,
        actions: createElement("button", { type: "button", "data-testid": "hidden-cta" }, "Continue"),
      },
      "Body",
    ));
    expect(document.querySelector("[data-testid=hidden-cta]")).toBeNull();
    view.cleanup();
  });
});

describe("bookingAddressOwnsActions", () => {
  test("hides shell Continue during address confirm/details", () => {
    expect(bookingAddressOwnsActions({
      locationType: "home",
      address: { line: "10150 104 St NW", detailsSettled: false },
    }, 0)).toBe(true);
    expect(bookingAddressOwnsActions({
      locationType: "home",
      address: { line: "10150 104 St NW", detailsSettled: true },
    }, 0)).toBe(false);
    expect(bookingAddressOwnsActions({
      locationType: "clinic",
      address: { line: "Clinic" },
    }, 0)).toBe(false);
    expect(bookingAddressOwnsActions({
      locationType: "home",
      address: { line: "10150 104 St NW", detailsSettled: false },
    }, 1)).toBe(false);
  });
});
