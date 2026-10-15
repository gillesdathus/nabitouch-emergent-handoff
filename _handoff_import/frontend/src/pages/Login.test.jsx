import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const h = vi.hoisted(() => ({
  login: vi.fn(async () => ({})),
  mfaEnrollChallenge: vi.fn(() => new Promise(() => {})),
  mfaConfirmChallenge: vi.fn(),
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({ login: h.login, finish: async (user) => user, demoMode: true }),
}));

vi.mock("@/lib/api", () => ({
  api: { mfaEnrollChallenge: h.mfaEnrollChallenge, mfaConfirmChallenge: h.mfaConfirmChallenge, mfaVerify: vi.fn() },
  apiError: (e) => e?.response?.data?.detail || "Something went wrong. Please try again.",
}));

import Login from "./Login";

function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(createElement(MemoryRouter, null, createElement(Login))); });
  return {
    host,
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

test("the login page does not offer demo accounts", () => {
  const view = render();
  expect(view.host.querySelector("[data-testid='demo-login-panel']")).toBeNull();
  expect(view.host.querySelector("[data-testid='login-email-input']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='login-password-input']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='login-submit-btn']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='login-forgot-password-link']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='login-register-link']")).toBeTruthy();
  expect(view.host.textContent).toContain("Staff accounts are created by the Nabitouch owner.");
  expect(view.host.textContent).not.toContain("demo accounts");
  view.unmount();
});

test("authenticator setup is not shown as an invalid password", async () => {
  h.login.mockResolvedValueOnce({ enrollmentRequired: true, mfaRequired: true, challenge: "hidden-challenge" });
  const view = render();
  await act(async () => {
    view.host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(view.host.querySelector("[data-testid='login-mfa-enroll']")).toBeTruthy();
  expect(view.host.textContent).not.toContain("Invalid email or password");
  expect(view.host.textContent).not.toContain("hidden-challenge");
  view.unmount();
});

test("a rejected password shows the safe authentication error", async () => {
  h.login.mockRejectedValueOnce({ response: { data: { detail: "Invalid email or password" } } });
  const view = render();
  await act(async () => {
    view.host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(view.host.querySelector("[data-testid='login-error']").textContent).toBe("Invalid email or password");
  expect(view.host.querySelector("[data-testid='login-mfa-enroll']")).toBeNull();
  view.unmount();
});
