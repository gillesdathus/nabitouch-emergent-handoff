import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ScheduleEditor } from "./ScheduleEditor";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: query.includes("max-width") || query.includes("767"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  return {
    host,
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

test("mobile editor docks save/cancel outside the scroll body", () => {
  const view = mount(createElement(ScheduleEditor, {
    editor: "hours",
    onClose: vi.fn(),
    date: "2026-10-20",
    hoursDefaults: { start: "09:00", end: "17:00" },
    onChangeHours: vi.fn(),
    saving: false,
  }));
  const shell = document.querySelector("[data-testid='schedule-editor-hours']");
  expect(shell).toBeTruthy();
  const actions = document.querySelector("[data-testid='schedule-editor-hours-actions']");
  expect(actions).toBeTruthy();
  expect(actions.querySelector("[data-testid='schedule-editor-hours-save']")).toBeTruthy();
  expect(actions.querySelector("[data-testid='schedule-editor-hours-cancel']")).toBeTruthy();
  view.unmount();
});

test("weekly hours progresses days → times before save", () => {
  const onWeeklyHours = vi.fn();
  const view = mount(createElement(ScheduleEditor, {
    editor: "weekly",
    onClose: vi.fn(),
    date: "2026-10-20",
    schedule: { weekly: [{ weekday: 1, start: "09:00", end: "17:00" }] },
    onWeeklyHours,
    saving: false,
  }));
  expect(document.querySelector("[data-testid='weekly-days-phase']")).toBeTruthy();
  expect(document.querySelector("[data-testid='weekly-hours-phase']")).toBeNull();
  expect(document.querySelector("[data-testid='schedule-editor-weekly-save']")).toBeNull();

  act(() => {
    document.querySelector("[data-testid='schedule-editor-weekly-continue']").click();
  });
  expect(document.querySelector("[data-testid='weekly-hours-phase']")).toBeTruthy();
  expect(document.querySelector("[data-testid='schedule-editor-weekly-save']")).toBeTruthy();

  act(() => {
    document.querySelector("[data-testid='schedule-editor-weekly-save']").click();
  });
  expect(onWeeklyHours).toHaveBeenCalledWith({
    weekly: [{ weekday: 1, start: "09:00", end: "17:00" }],
  });
  view.unmount();
});

test("time off progresses mode → details before save", () => {
  const onTimeOff = vi.fn();
  const view = mount(createElement(ScheduleEditor, {
    editor: "off",
    onClose: vi.fn(),
    date: "2026-10-20",
    appointments: [],
    onTimeOff,
    saving: false,
  }));
  expect(document.querySelector("[data-testid='timeoff-mode-phase']")).toBeTruthy();
  expect(document.querySelector("[data-testid='timeoff-details-phase']")).toBeNull();
  expect(document.querySelector("[data-testid='schedule-editor-off-save']")).toBeNull();

  act(() => {
    document.querySelector("[data-testid='timeoff-mode-partial']").click();
  });
  act(() => {
    document.querySelector("[data-testid='schedule-editor-off-continue']").click();
  });
  expect(document.querySelector("[data-testid='timeoff-details-phase']")).toBeTruthy();
  expect(document.querySelector("[data-testid='timeoff-start']")).toBeTruthy();
  expect(document.querySelector("[data-testid='schedule-editor-off-save']")).toBeTruthy();

  act(() => {
    document.querySelector("[data-testid='schedule-editor-off-save']").click();
  });
  expect(onTimeOff).toHaveBeenCalledWith(expect.objectContaining({ mode: "partial", start: "09:00", end: "17:00" }));
  view.unmount();
});

test("break sheet queues ranges with Add to list", () => {
  const onAddBreaks = vi.fn();
  const view = mount(createElement(ScheduleEditor, {
    editor: "break",
    onClose: vi.fn(),
    date: "2026-10-20",
    onAddBreaks,
    saving: false,
  }));
  act(() => {
    document.querySelector("[data-testid='break-add-another']").click();
  });
  expect(document.querySelector("[data-testid='break-preview-list']")).toBeTruthy();
  act(() => {
    document.querySelector("[data-testid='schedule-editor-break-save']").click();
  });
  expect(onAddBreaks).toHaveBeenCalledWith([{ start: "12:00", end: "13:00" }]);
  view.unmount();
});
