import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Welcome from "./Welcome";

const h = vi.hoisted(() => ({
  legacyVerify: vi.fn(),
  legacyOnboarding: vi.fn(),
  legacySaveOnboarding: vi.fn(),
  run: vi.fn((fn) => fn()),
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    api: {
      legacyVerify: (...args) => h.legacyVerify(...args),
      legacyOnboarding: (...args) => h.legacyOnboarding(...args),
      legacySaveOnboarding: (...args) => h.legacySaveOnboarding(...args),
    },
    run: h.run,
  }),
}));

function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function renderWelcome() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Welcome)));
  return {
    host,
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  h.legacyVerify.mockReset();
  h.legacyOnboarding.mockReset();
  h.legacySaveOnboarding.mockReset();
  h.run.mockImplementation((fn) => fn());
});

afterEach(() => {
  document.body.innerHTML = "";
});

test("account step starts on identity and continues to credentials", () => {
  const view = renderWelcome();
  expect(view.host.querySelector("[data-testid='welcome-identity-title']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='welcome-step-caption']")?.textContent).toMatch(/identity/i);
  expect(view.host.querySelector("[data-testid='welcome-email']")).toBeNull();
  const bar = document.querySelector("[data-testid='welcome-sticky-actions']");
  expect(bar).toBeTruthy();
  expect(bar.className).toMatch(/nb-sticky-actions/);
  expect(view.host.contains(bar)).toBe(false);
  const continueBtn = document.querySelector("[data-testid='welcome-identity-continue']");
  expect(continueBtn).toBeTruthy();
  expect(continueBtn.disabled).toBe(true);

  act(() => {
    type(view.host.querySelector("[data-testid='welcome-last-name']"), "Client");
    type(view.host.querySelector("[data-testid='welcome-dob']"), "1990-01-01");
  });
  expect(document.querySelector("[data-testid='welcome-identity-continue']").disabled).toBe(false);

  act(() => {
    document.querySelector("[data-testid='welcome-identity-continue']").click();
  });
  expect(view.host.querySelector("[data-testid='welcome-credentials-title']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='welcome-email']")).toBeTruthy();
  expect(document.querySelector("[data-testid='welcome-verify']")).toBeTruthy();
  view.unmount();
});

test("verify uses sticky CTA after credentials are filled", async () => {
  h.legacyVerify.mockResolvedValue({});
  h.legacyOnboarding.mockResolvedValue({
    step: 2,
    draft: { personal: { firstName: "Ada" } },
  });
  const view = renderWelcome();
  act(() => {
    type(view.host.querySelector("[data-testid='welcome-last-name']"), "Client");
    type(view.host.querySelector("[data-testid='welcome-dob']"), "1990-01-01");
  });
  act(() => document.querySelector("[data-testid='welcome-identity-continue']").click());
  act(() => {
    type(view.host.querySelector("[data-testid='welcome-email']"), "ada@example.com");
    type(view.host.querySelector("[data-testid='welcome-password']"), "password1");
  });
  await act(async () => {
    document.querySelector("[data-testid='welcome-verify']").click();
  });
  expect(h.legacyVerify).toHaveBeenCalled();
  expect(view.host.querySelector("[data-testid='welcome-draft']")?.textContent).toContain("Ada");
  expect(document.querySelector("[data-testid='welcome-save']")).toBeTruthy();
  view.unmount();
});
