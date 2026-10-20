import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, vi } from "vitest";
import CampaignSlotsEditor from "./CampaignSlotsEditor";

afterEach(() => {
  document.body.innerHTML = "";
});

test("loads saved blocks and saves the full list when open/closed changes", async () => {
  const onSave = vi.fn().mockResolvedValue({});
  const saved = [{
    id: "cb-sat",
    campaignId: "cmp-ten-minutes-on-us",
    mode: "recurring",
    weekdays: [5],
    start: "10:00",
    end: "14:00",
    fullDay: false,
    open: true,
    timezone: "America/Edmonton",
  }];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(CampaignSlotsEditor, { blocks: saved, onSave }));
  });
  expect(host.querySelector("[data-testid='campaign-slots-status']").textContent).toContain("Saved");
  expect(host.querySelector("[data-testid='campaign-block-cb-sat']")).toBeTruthy();

  await act(async () => {
    host.querySelector("[data-testid='campaign-block-open-cb-sat']").click();
  });
  expect(host.querySelector("[data-testid='campaign-slots-status']").textContent).toContain("Unsaved changes");

  await act(async () => {
    host.querySelector("[data-testid='campaign-slots-save']").click();
  });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0][0][0].open).toBe(false);
  expect(host.querySelector("[data-testid='campaign-slots-status']").textContent).toContain("Success");
  act(() => root.unmount());
  host.remove();
});

test("adds Tuesday and Thursday 1–3 PM in one draft before save", async () => {
  const onSave = vi.fn().mockResolvedValue({});
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(CampaignSlotsEditor, { blocks: [], onSave }));
  });
  await act(async () => {
    host.querySelector("[data-testid='campaign-slots-add']").click();
  });
  await act(async () => {
    host.querySelector("[data-testid='campaign-slots-day-1']").click();
    host.querySelector("[data-testid='campaign-slots-day-3']").click();
  });
  const setInput = (node, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  };
  await act(async () => {
    setInput(host.querySelector("[data-testid='campaign-slots-start']"), "13:00");
    setInput(host.querySelector("[data-testid='campaign-slots-end']"), "15:00");
  });
  await act(async () => {
    host.querySelector("[data-testid='campaign-slots-apply']").click();
  });
  await act(async () => {
    host.querySelector("[data-testid='campaign-slots-save']").click();
  });
  expect(onSave).toHaveBeenCalled();
  const payload = onSave.mock.calls[0][0][0];
  expect(payload.weekdays).toEqual([1, 3]);
  expect(payload.start).toBe("13:00");
  expect(payload.end).toBe("15:00");
  act(() => root.unmount());
  host.remove();
});
