import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const h = vi.hoisted(() => ({
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { forgotPassword: h.forgotPassword, resetPassword: h.resetPassword },
  apiError: (e) => e?.response?.data?.detail || "Something went wrong. Please try again.",
}));

import ForgotPassword from "./ForgotPassword";

function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(createElement(MemoryRouter, null, createElement(ForgotPassword))); });
  return {
    host,
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

test("a preview reset stays on the page and does not show the reset code", async () => {
  const secret = "preview-reset-code-should-stay-hidden";
  h.forgotPassword.mockResolvedValueOnce({ ok: true, previewResetToken: secret });
  const view = render();
  act(() => { type(view.host.querySelector("[data-testid='forgot-email-input']"), "info@nabitouch.com"); });
  await act(async () => {
    view.host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(view.host.querySelector("[data-testid='forgot-preview-reset']")).toBeTruthy();
  expect(view.host.textContent).not.toContain(secret);
  expect(view.host.textContent).not.toContain("demo accounts");
  view.unmount();
});
