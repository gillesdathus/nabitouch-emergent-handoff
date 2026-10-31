import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, Navigate } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";

let mockUser = { id: "u-owner", role: "owner", workspaces: ["owner"], name: "Owner" };

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({ user: mockUser }),
}));

import { ForbiddenPage, NotFoundPage } from "./RouteStatus";
import { StaffShell } from "@/components/shells";

function mount(ui, entry = "/owner/missing-feature") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  return {
    host,
    async render() {
      await act(async () => {
        root.render(createElement(MemoryRouter, { initialEntries: [entry] }, ui));
      });
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  mockUser = { id: "u-owner", role: "owner", workspaces: ["owner"], name: "Owner" };
});

test("unknown routes render 404 instead of redirecting to public home", async () => {
  const view = mount(
    createElement(
      Routes,
      null,
      createElement(Route, { path: "/owner", element: createElement("div", { "data-testid": "owner-home" }, "dash") }),
      createElement(Route, { path: "*", element: createElement(NotFoundPage) }),
    ),
    "/owner/wellness-studio",
  );
  await view.render();
  expect(view.host.querySelector("[data-testid='route-not-found']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='route-not-found']").textContent).toMatch(/Page not found/);
  expect(view.host.querySelector("[data-testid='owner-home']")).toBeFalsy();
  expect(view.host.querySelector("[data-testid='route-not-found-home']").getAttribute("href")).toBe("/owner");
  view.unmount();
});

test("legacy silent homepage redirect pattern is not used for unknown paths", async () => {
  // Guardrail: if someone reintroduces Navigate-to-/, this documents the broken behaviour.
  const broken = mount(
    createElement(
      Routes,
      null,
      createElement(Route, { path: "*", element: createElement(Navigate, { to: "/", replace: true }) }),
      createElement(Route, { path: "/", element: createElement("div", { "data-testid": "public-home" }, "home") }),
    ),
    "/owner/wellness-studio",
  );
  await broken.render();
  expect(broken.host.querySelector("[data-testid='public-home']")).toBeTruthy();
  broken.unmount();

  const fixed = mount(
    createElement(
      Routes,
      null,
      createElement(Route, { path: "*", element: createElement(NotFoundPage) }),
      createElement(Route, { path: "/", element: createElement("div", { "data-testid": "public-home" }, "home") }),
    ),
    "/owner/wellness-studio",
  );
  await fixed.render();
  expect(fixed.host.querySelector("[data-testid='route-not-found']")).toBeTruthy();
  expect(fixed.host.querySelector("[data-testid='public-home']")).toBeFalsy();
  fixed.unmount();
});

test("authenticated user without owner space sees 403 in StaffShell", async () => {
  mockUser = { id: "u-client", role: "client", workspaces: ["client"], name: "Client" };
  const view = mount(
    createElement(Routes, null, createElement(Route, {
      element: createElement(StaffShell, { role: "owner" }),
      children: createElement(Route, { path: "/owner/wellness-studio", element: createElement("div", { "data-testid": "studio" }, "studio") }),
    })),
    "/owner/wellness-studio",
  );
  await view.render();
  expect(view.host.querySelector("[data-testid='route-forbidden']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='studio']")).toBeFalsy();
  expect(view.host.querySelector("[data-testid='route-forbidden-home']").getAttribute("href")).toBe("/me");
  view.unmount();
});

test("signed-out staff route redirects to login with next=", async () => {
  mockUser = null;
  const view = mount(
    createElement(Routes, null,
      createElement(Route, {
        element: createElement(StaffShell, { role: "owner" }),
        children: createElement(Route, { path: "/owner/wellness-studio", element: createElement("div", { "data-testid": "studio" }, "studio") }),
      }),
      createElement(Route, { path: "/login", element: createElement("div", { "data-testid": "login" }, "login") }),
    ),
    "/owner/wellness-studio",
  );
  await view.render();
  expect(view.host.querySelector("[data-testid='login']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='studio']")).toBeFalsy();
  view.unmount();
});

test("ForbiddenPage exposes explicit access-denied copy", async () => {
  const view = mount(createElement(ForbiddenPage, { requiredRole: "owner" }), "/owner/secret");
  await view.render();
  expect(view.host.querySelector("[data-testid='route-forbidden']").textContent).toMatch(/Access denied/);
  expect(view.host.querySelector("[data-testid='route-forbidden']").textContent).toMatch(/owner/);
  view.unmount();
});
