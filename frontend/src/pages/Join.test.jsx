import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Join from "./Join";

const h = vi.hoisted(() => ({
  acceptInvite: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiError: (e) => e?.response?.data?.detail || e?.message || "error",
  api: {
    acceptInvite: (...args) => h.acceptInvite(...args),
  },
}));

function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function renderJoin(search = "?token=invite-1") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(MemoryRouter, { initialEntries: [`/join${search}`] }, createElement(Join)));
  });
  return {
    host,
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  h.acceptInvite.mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
});

test("join password CTA is sticky and disabled until 8 characters", async () => {
  h.acceptInvite.mockResolvedValue({ message: "Password saved." });
  const view = renderJoin();
  const bar = document.querySelector("[data-testid='join-sticky-actions']");
  expect(bar).toBeTruthy();
  expect(bar.className).toMatch(/nb-sticky-actions/);
  expect(view.host.contains(bar)).toBe(false);
  const submit = document.querySelector("[data-testid='join-submit']");
  expect(submit.disabled).toBe(true);
  act(() => {
    type(view.host.querySelector("[data-testid='join-password']"), "password1");
  });
  expect(document.querySelector("[data-testid='join-submit']").disabled).toBe(false);
  await act(async () => {
    document.querySelector("[data-testid='join-submit']").click();
  });
  expect(h.acceptInvite).toHaveBeenCalledWith("invite-1", "password1");
  expect(view.host.querySelector("[data-testid='join-done']")).toBeTruthy();
  view.unmount();
});
