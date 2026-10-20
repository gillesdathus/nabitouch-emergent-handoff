import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";

const h = vi.hoisted(() => ({
  user: null,
  me: null,
  state: { appointments: [], promotions: [], plans: [] },
  idx: { services: {}, practitioners: {}, clients: {} },
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    user: h.user,
    me: h.me,
    state: h.state,
    idx: h.idx,
    patchDraft: () => {},
    logout: async () => {},
    api: { followupMine: async () => ({ coupons: [] }), billingNotices: async () => [] },
  }),
}));

import Me from "./Me";

function Loc() {
  const loc = useLocation();
  return createElement("div", { "data-testid": "loc", "data-path": loc.pathname });
}

async function renderMe() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(
      MemoryRouter,
      { initialEntries: ["/me"] },
      createElement(Routes, null,
        createElement(Route, { path: "/me", element: createElement(Me) }),
        createElement(Route, { path: "*", element: createElement(Loc) }),
      ),
    ));
  });
  return {
    host,
    path: () => host.querySelector("[data-testid='loc']")?.getAttribute("data-path")
      || (host.querySelector("[data-testid='me-signed-out']") ? "/me-signed-out" : null),
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

test("authenticated owner on /me is redirected to Owner Dashboard", async () => {
  h.user = { role: "owner", workspaces: ["owner", "practitioner"] };
  h.me = null;
  const view = await renderMe();
  expect(view.path()).toBe("/owner");
  expect(view.host.querySelector("[data-testid='me-signed-out']")).toBeNull();
  view.unmount();
});

test("signed-out visitor still sees Account CTAs", async () => {
  h.user = null;
  h.me = null;
  const view = await renderMe();
  expect(view.host.querySelector("[data-testid='me-signed-out']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='me-signin-btn']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='me-create-profile-btn']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='me-guest-book-btn']")).toBeTruthy();
  view.unmount();
});
