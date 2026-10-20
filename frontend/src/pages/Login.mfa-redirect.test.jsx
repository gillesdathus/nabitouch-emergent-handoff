import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";

const h = vi.hoisted(() => ({
  login: vi.fn(),
  finish: vi.fn(async (user) => user),
  mfaVerify: vi.fn(),
  mfaEnrollChallenge: vi.fn(() => new Promise(() => {})),
  mfaConfirmChallenge: vi.fn(),
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({ login: h.login, finish: h.finish, demoMode: false }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    mfaVerify: h.mfaVerify,
    mfaEnrollChallenge: h.mfaEnrollChallenge,
    mfaConfirmChallenge: h.mfaConfirmChallenge,
  },
  apiError: (e) => e?.response?.data?.detail || "Something went wrong. Please try again.",
}));

import Login from "./Login";

function LocationProbe() {
  const loc = useLocation();
  return createElement("div", { "data-testid": "loc", "data-path": loc.pathname + loc.search });
}

async function renderAt(entry = "/login") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(
      MemoryRouter,
      { initialEntries: [entry] },
      createElement(Routes, null,
        createElement(Route, { path: "/login", element: createElement(Login) }),
        createElement(Route, { path: "*", element: createElement(LocationProbe) }),
      ),
    ));
  });
  return {
    host,
    path: () => host.querySelector("[data-testid='loc']")?.getAttribute("data-path"),
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

function setInput(el, value) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc.set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function completeMfa(view, profile) {
  h.login.mockResolvedValueOnce({ mfaRequired: true, challenge: "chal-1" });
  await act(async () => {
    view.host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(view.host.querySelector("[data-testid='login-mfa']")).toBeTruthy();
  h.mfaVerify.mockResolvedValueOnce(profile);
  const code = view.host.querySelector("[data-testid='login-mfa-code']");
  await act(async () => {
    setInput(code, "123456");
    view.host.querySelector("[data-testid='login-mfa']").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

test("owner MFA with next=/me lands on Owner Dashboard, not client Account", async () => {
  const view = await renderAt("/login?next=/me");
  await completeMfa(view, { role: "owner", workspaces: ["owner", "practitioner"], preferredWorkspace: "owner" });
  expect(h.finish).toHaveBeenCalled();
  expect(view.path()).toBe("/owner");
  view.unmount();
});

test("owner MFA failure keeps the authenticator form and shows an error", async () => {
  const view = await renderAt("/login?next=/me");
  h.login.mockResolvedValueOnce({ mfaRequired: true, challenge: "chal-fail" });
  await act(async () => {
    view.host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  h.mfaVerify.mockRejectedValueOnce({ response: { data: { detail: "That authenticator code was not accepted" } } });
  const code = view.host.querySelector("[data-testid='login-mfa-code']");
  await act(async () => {
    setInput(code, "000000");
    view.host.querySelector("[data-testid='login-mfa']").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(view.host.querySelector("[data-testid='login-mfa']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='login-error']").textContent).toContain("not accepted");
  expect(view.path()).toBeUndefined();
  view.unmount();
});

test("dual-role owner+practitioner honors preferred practitioner workspace after MFA", async () => {
  const view = await renderAt("/login?next=/me");
  await completeMfa(view, {
    role: "owner",
    roles: ["owner", "practitioner"],
    workspaces: ["practitioner", "owner"],
    preferredWorkspace: "practitioner",
  });
  expect(view.path()).toBe("/pro");
  view.unmount();
});

test("owner MFA with next=/owner keeps Owner Dashboard", async () => {
  const view = await renderAt("/login?next=/owner");
  await completeMfa(view, { role: "owner", workspaces: ["owner"] });
  expect(view.path()).toBe("/owner");
  view.unmount();
});

test("practitioner MFA ignores next=/me", async () => {
  const view = await renderAt("/login?next=/me");
  await completeMfa(view, { role: "practitioner", workspaces: ["practitioner"] });
  expect(view.path()).toBe("/pro");
  view.unmount();
});

test("desk MFA ignores next=/me", async () => {
  const view = await renderAt("/login?next=/me");
  await completeMfa(view, { role: "desk", workspaces: ["desk"] });
  expect(view.path()).toBe("/desk");
  view.unmount();
});

test("client MFA (or login) may still open /me", async () => {
  const view = await renderAt("/login?next=/me");
  await completeMfa(view, { role: "client", workspaces: ["client"], subject: "c-1" });
  expect(view.path()).toBe("/me");
  view.unmount();
});
