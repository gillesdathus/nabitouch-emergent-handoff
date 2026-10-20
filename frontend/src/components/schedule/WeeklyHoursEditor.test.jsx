import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, vi } from "vitest";
import WeeklyHoursEditor from "./WeeklyHoursEditor";

afterEach(() => {
  document.body.innerHTML = "";
});

async function renderEditor(props) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(WeeklyHoursEditor, props));
  });
  return {
    host,
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

test("loads existing weekly hours and applies multi-day selection before one save", async () => {
  const onSave = vi.fn().mockResolvedValue({
    schedule: {
      weekly: [
        { weekday: 0, start: "09:00", end: "17:00" },
        { weekday: 1, start: "09:00", end: "17:00" },
        { weekday: 2, start: "09:00", end: "17:00" },
        { weekday: 3, start: "09:00", end: "17:00" },
        { weekday: 4, start: "09:00", end: "17:00" },
      ],
      updatedAt: "2026-06-01T12:00:00+00:00",
    },
  });
  const { host, unmount } = await renderEditor({
    schedule: {
      weekly: [{ weekday: 1, start: "10:00", end: "14:00" }],
      updatedAt: "2026-05-01T12:00:00+00:00",
    },
    onSave,
  });
  expect(host.querySelector("[data-testid='weekly-save-status']").textContent).toMatch(/Saved schedule loaded/i);
  expect(host.querySelector("[data-testid='weekly-block-1-10:00']")).toBeTruthy();

  // Defaults are Mon–Fri selected and 09:00–17:00 — one apply replaces those days.
  await act(async () => {
    host.querySelector("[data-testid='weekly-apply-selected']").click();
  });
  expect(host.querySelector("[data-testid='weekly-save-status']").textContent).toMatch(/Unsaved changes/i);

  await act(async () => {
    host.querySelector("[data-testid='weekly-save']").click();
    await Promise.resolve();
  });
  expect(onSave).toHaveBeenCalled();
  const body = onSave.mock.calls[0][0];
  expect(body.weekly.length).toBe(5);
  expect(body.weekly.every((row) => row.start === "09:00" && row.end === "17:00")).toBe(true);
  expect(body.weekly.map((row) => row.weekday)).toEqual([0, 1, 2, 3, 4]);
  unmount();
});

test("empty schedule shows informative empty state", async () => {
  const { host, unmount } = await renderEditor({
    schedule: { weekly: [], updatedAt: null },
    onSave: vi.fn(),
  });
  expect(host.querySelector("[data-testid='weekly-hours-empty']")).toBeTruthy();
  unmount();
});
