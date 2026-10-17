import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const turnaroundBoard = vi.fn();
const ackTurnaroundAlert = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    turnaroundBoard: (...args) => turnaroundBoard(...args),
    ackTurnaroundAlert: (...args) => ackTurnaroundAlert(...args),
  },
  apiError: (err) => err?.response?.data?.detail || err?.message || "Request failed",
}));

import { TurnaroundBoard } from "./TurnaroundBoard";

async function renderBoard(props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(TurnaroundBoard, { people: {}, compact: true, ...props })));
  });
  return {
    host,
    async settle() {
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  turnaroundBoard.mockReset();
  ackTurnaroundAlert.mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
});

test("shows a labeled loading state while the board request is in flight", async () => {
  let resolve;
  turnaroundBoard.mockReturnValue(new Promise((r) => { resolve = r; }));
  const view = await renderBoard();
  expect(view.host.querySelector("[data-testid='turnaround-board-loading']")).toBeTruthy();
  expect(view.host.textContent).toContain("Practitioner status");
  expect(view.host.textContent).toContain("Loading live session timing");
  await act(async () => { resolve({ serverNow: new Date().toISOString(), practitioners: [], alerts: [] }); });
  await view.settle();
  expect(view.host.querySelector("[data-testid='turnaround-board']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='turnaround-board-empty']")).toBeTruthy();
  view.unmount();
});

test("API failure shows an error card instead of a permanent blank pulse", async () => {
  turnaroundBoard.mockRejectedValue({ response: { status: 405, data: { detail: "Method Not Allowed" } }, message: "Method Not Allowed" });
  const view = await renderBoard();
  await view.settle();
  expect(view.host.querySelector("[data-testid='turnaround-board-loading']")).toBeNull();
  expect(view.host.querySelector("[data-testid='turnaround-board-error']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='turnaround-board-error-message']").textContent).toMatch(/Method Not Allowed|unavailable/i);
  expect(view.host.querySelector("[data-testid='turnaround-board-retry']")).toBeTruthy();
  expect(view.host.textContent).toContain("Practitioner status");
  view.unmount();
});

test("compact success with idle-only practitioners shows the empty copy", async () => {
  turnaroundBoard.mockResolvedValue({
    serverNow: "2026-10-17T18:00:00+00:00",
    practitioners: [{ practitionerId: "p-1", name: "Maya", state: "idle" }],
    alerts: [],
  });
  const view = await renderBoard();
  await view.settle();
  expect(view.host.querySelector("[data-testid='turnaround-board-empty']").textContent).toContain("No practitioner is in a session");
  expect(view.host.querySelector("[data-testid='turnaround-board-more']")).toBeTruthy();
  view.unmount();
});
