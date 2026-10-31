import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";

const toastMessage = vi.fn();

vi.mock("sonner", () => ({
  toast: { message: (...args) => toastMessage(...args), error: vi.fn(), success: vi.fn() },
}));

import WellnessStudioDashboard from "./WellnessStudioDashboard";
import WellnessStudioPlaceholder from "./WellnessStudioPlaceholder";

function mount(ui, entry = "/owner/wellness-studio") {
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
    async click(testId) {
      const node = host.querySelector(`[data-testid='${testId}']`);
      expect(node).toBeTruthy();
      await act(async () => { node.click(); });
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  toastMessage.mockClear();
});

test("dashboard renders synthetic sections and demo labelling", async () => {
  const view = mount(createElement(WellnessStudioDashboard));
  await view.render();
  expect(view.host.querySelector("[data-testid='wellness-studio-dashboard']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='wellness-studio-hero']").textContent).toMatch(/Welcome teams back to calm/);
  expect(view.host.querySelector("[data-testid='wellness-studio-safe-notice']").textContent).toMatch(/Demonstration workspace/);
  expect(view.host.querySelector("[data-testid='ws-section-campaigns']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='ws-section-assets']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='ws-section-orgs']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='ws-section-events']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='ws-section-activity']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='ws-org-aurora']").textContent).toMatch(/Aurora North Consulting/);
  expect(view.host.querySelector("[data-testid='ws-integration-engage']").textContent).toMatch(/engage\.nabitouch\.com/);
  expect(view.host.textContent).toMatch(/Synthetic demo/i);
  view.unmount();
});

test("studio nav exposes overview and upcoming sections", async () => {
  const view = mount(createElement(WellnessStudioDashboard));
  await view.render();
  const nav = view.host.querySelector("[data-testid='wellness-studio-nav']");
  expect(nav).toBeTruthy();
  expect(nav.textContent).toMatch(/Overview/);
  expect(nav.textContent).toMatch(/Campaigns/);
  expect(nav.textContent).toMatch(/Asset Library/);
  expect(nav.textContent).toMatch(/Organizations/);
  expect(nav.textContent).toMatch(/Events/);
  expect(nav.textContent).toMatch(/Outreach/);
  expect(nav.textContent).toMatch(/Analytics/);
  view.unmount();
});

test("quick actions toast without sending or publishing", async () => {
  const view = mount(createElement(WellnessStudioDashboard));
  await view.render();
  await view.click("ws-action-campaign");
  expect(toastMessage).toHaveBeenCalledTimes(1);
  expect(toastMessage.mock.calls[0][0]).toBe("New Campaign");
  expect(String(toastMessage.mock.calls[0][1]?.description || "")).toMatch(/Nothing is sent/);
  view.unmount();
});

test("placeholder pages stay empty for later phases", async () => {
  const view = mount(createElement(WellnessStudioPlaceholder), "/owner/wellness-studio/campaigns");
  await view.render();
  expect(view.host.querySelector("[data-testid='wellness-studio-placeholder']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='wellness-placeholder-empty']").textContent).toMatch(/Campaigns comes next/);
  expect(view.host.querySelector("[data-testid='wellness-placeholder-back']").getAttribute("href")).toBe("/owner/wellness-studio");
  view.unmount();
});
