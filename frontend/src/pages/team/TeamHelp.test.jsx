import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  api: { teamCreateRequest: async () => ({ request: { id: "r1" } }) },
  apiError: (err) => err?.message || "error",
}));
vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    practitionerId: "p-1",
    state: {
      appointments: [
        { id: "a-9", practitionerId: "p-1", status: "assigned", date: "2099-01-01", time: "10:00", ref: "NT-9" },
      ],
    },
  }),
}));

import TeamHelp from "./TeamHelp";

async function renderHelp(search) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(
      MemoryRouter,
      { initialEntries: [`/pro/team/help${search}`] },
      createElement(Routes, null, createElement(Route, { path: "/pro/team/help", element: createElement(TeamHelp, { role: "pro" }) })),
    ));
  });
  await act(async () => { await Promise.resolve(); });
  return { host, root };
}

test("applies category and appointmentId from the query string", async () => {
  const { host, root } = await renderHelp("?category=running_late&appointmentId=a-9");
  expect(host.querySelector("[data-testid='team-help']")).toBeTruthy();
  expect(host.querySelector("[data-testid='team-help-form']")).toBeTruthy();
  expect(host.querySelector("[data-testid='team-help-appointment']")?.value).toBe("a-9");
  expect(host.textContent).toMatch(/Running Late/i);
  act(() => root.unmount());
  host.remove();
});
