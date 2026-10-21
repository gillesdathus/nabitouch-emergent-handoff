/**
 * Completion screens: primary actions must use the shared sticky dock so they
 * stay above the mobile bottom nav without scrolling past Install / tracking blocks.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test } from "vitest";
import { CompletionHero, CompletionScreen } from "./CompletionScreen";

function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(MemoryRouter, null, ui)));
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

describe("CompletionScreen", () => {
  test("keeps primary actions in StickyActionBar above footer extras", () => {
    const view = mount(createElement(
      CompletionScreen,
      {
        testid: "completion-screen",
        actions: createElement("button", { type: "button", "data-testid": "primary-cta" }, "View my visit"),
        footer: createElement("div", { "data-testid": "install-prompt-card" }, "Add to home screen"),
      },
      createElement(CompletionHero, {
        mark: createElement("span", null, "ok"),
        title: "Request received",
        subtitle: "NT-1 · Swedish · 60 min",
      }),
    ));
    const actions = document.querySelector("[data-testid=completion-sticky-actions]");
    const footer = view.host.querySelector("[data-testid=completion-screen-footer]");
    const body = view.host.querySelector("[data-testid=completion-screen-body]");
    expect(actions).toBeTruthy();
    expect(actions.className).toMatch(/nb-sticky-actions/);
    expect(actions.querySelector("[data-testid=primary-cta]")).toBeTruthy();
    expect(footer.querySelector("[data-testid=install-prompt-card]")).toBeTruthy();
    expect(body.contains(actions)).toBe(false);
    expect(view.host.contains(actions)).toBe(false);
    expect(body.contains(footer)).toBe(false);
    view.cleanup();
  });

  test("hero stays compact (no large py-14 wrapper)", () => {
    const view = mount(createElement(
      CompletionScreen,
      { actions: createElement("button", { type: "button" }, "Go") },
      createElement(CompletionHero, { mark: null, title: "Done", subtitle: "ref" }),
    ));
    expect(view.host.querySelector("[data-testid=completion-screen]").className).not.toMatch(/py-14/);
    expect(view.host.querySelector("[data-testid=completion-hero]")).toBeTruthy();
    view.cleanup();
  });
});
