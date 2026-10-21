import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { DayTimeline } from "./DayTimeline";

afterEach(() => {
  document.body.innerHTML = "";
});

test("off days show the banner without duplicate unavailable timeline cards", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(DayTimeline, {
      date: "2026-10-20",
      appointments: [],
      days: [{
        date: "2026-10-20",
        segments: [{ state: "unavailable", start: "00:00", end: "23:59" }],
      }],
      serviceName: () => "Swedish",
    }));
  });
  expect(host.querySelector("[data-testid='schedule-availability-banner']")?.textContent).toMatch(/Not working/i);
  expect(host.textContent).not.toMatch(/Unavailable/);
  expect(host.querySelector("[data-testid='schedule-day-empty']")).toBeTruthy();
  act(() => root.unmount());
  host.remove();
});
