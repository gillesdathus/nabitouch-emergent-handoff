import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    state: { services: [{ slug: "swedish", name: "Swedish massage", prices: { 60: 120 } }] },
    api: {
      campaigns: async () => ({ campaigns: [], promotionalSending: false }),
      marketingAnalytics: async () => ({ campaignBookings: 0, discountCost: 0, grossRevenue: 0, recovered: 0, conversion: 0 }),
    },
  }),
}));

import Campaigns from "./Campaigns";

test("flash campaigns stay closed until create is chosen", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Campaigns)); });
  expect(host.querySelector("[data-testid='campaign-form']")).toBeNull();
  expect(host.querySelector("[data-testid='campaign-create']")).toBeTruthy();
  expect(host.querySelector("[data-testid='campaign-empty']").textContent).toContain("No flash campaigns");
  await act(async () => { host.querySelector("[data-testid='campaign-create']").click(); });
  expect(document.body.querySelector("[data-testid='campaign-editor']")).toBeTruthy();
  expect(document.body.textContent).not.toContain("Cancellation fee");
  act(() => root.unmount());
  host.remove();
});
