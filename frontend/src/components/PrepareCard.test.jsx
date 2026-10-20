import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import { PrepareCard } from "./PrepareCard";

const h = vi.hoisted(() => ({
  preparation: vi.fn(),
  saveReadiness: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiError: (e) => e?.message || "error",
  api: {
    preparation: (...args) => h.preparation(...args),
    saveReadiness: (...args) => h.saveReadiness(...args),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const checklist = [
  { key: "space", label: "Treatment space is ready" },
  { key: "paths", label: "Pathways and entrance are clear" },
  { key: "pets", label: "Pets are secured away from the area" },
  { key: "entry", label: "Entry and parking instructions are accurate" },
  { key: "safe", label: "The environment is safe and quiet" },
  { key: "service", label: "Service-specific items are ready" },
];

function allItems(on = true) {
  return Object.fromEntries(checklist.map((c) => [c.key, on]));
}

async function renderCard(prep) {
  h.preparation.mockResolvedValue(prep);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(PrepareCard, { appt: { id: "a-1", status: "confirmed" } }));
  });
  await act(async () => { await Promise.resolve(); });
  return {
    host,
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

beforeEach(() => {
  h.preparation.mockReset();
  h.saveReadiness.mockReset();
});

afterEach(() => { document.body.innerHTML = ""; });

test("loads persisted checklist items from the appointment readiness payload", async () => {
  const view = await renderCard({
    sections: [],
    checklist,
    disclaimer: "Safety check still applies.",
    readiness: { items: allItems(true), allReady: true, updatedAt: "2026-10-19T12:00:00Z" },
  });
  expect(view.host.querySelector("[data-testid='prepare-complete-title']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='prepare-progress']").textContent).toMatch(/6\/6 confirmed on your account/);
  expect(view.host.querySelector("[data-testid='readiness-checklist']")).toBeNull();
  view.unmount();
});

test("incomplete checklist stays expandable and is not local-only", async () => {
  const view = await renderCard({
    sections: [{ id: "space", title: "Your space", items: ["Clear the room"] }],
    checklist,
    disclaimer: "Safety check still applies.",
    readiness: { items: { space: true }, allReady: false },
  });
  expect(view.host.querySelector("[data-testid='readiness-checklist']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='readiness-space']").getAttribute("aria-pressed")).toBe("true");
  expect(view.host.querySelector("[data-testid='prepare-progress']").textContent).toMatch(/1\/6/);
  view.unmount();
});
