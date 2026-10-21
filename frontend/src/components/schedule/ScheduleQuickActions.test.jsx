import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ScheduleQuickActions } from "./ScheduleQuickActions";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: String(query).includes("767"),
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

test("mobile compact hub opens action picker with the same action testids", () => {
  const onOpen = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(ScheduleQuickActions, { onOpen })));

  expect(document.querySelector("[data-testid='schedule-adjust']")).toBeTruthy();
  expect(document.querySelector("[data-testid='schedule-action-hours']")).toBeNull();

  act(() => {
    document.querySelector("[data-testid='schedule-adjust']").click();
  });
  expect(document.querySelector("[data-testid='schedule-action-picker']")).toBeTruthy();
  expect(document.querySelector("[data-testid='schedule-action-hours']")).toBeTruthy();

  act(() => {
    document.querySelector("[data-testid='schedule-action-weekly']").click();
  });
  expect(onOpen).toHaveBeenCalledWith("weekly");

  act(() => root.unmount());
  host.remove();
});
