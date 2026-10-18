import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    state: {
      promotions: [{
        id: "promo-welcome", code: "WELCOME20", name: "First-booking welcome offer", type: "percent",
        value: 20, maxDiscount: 40, enabled: true, approval: "approved", eligibility: "first_online",
        placements: ["home", "account"],
      }],
    },
    api: {
      marketingAnalytics: async () => ({ campaignBookings: 0, discountCost: 0, grossRevenue: 0, followUpIssued: 0, followUpRedeemed: 0, incrementalNote: "note", campaigns: [] }),
      followupCoupons: async () => [],
    },
  }),
}));

import Marketing from "./Marketing";

test("marketing hub renders tabs and welcome summary", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(Marketing)));
  });
  expect(host.querySelector("[data-testid='owner-marketing']")).toBeTruthy();
  expect(host.querySelector("[data-testid='marketing-tab-welcome']")).toBeTruthy();
  expect(host.querySelector("[data-testid='marketing-welcome']")?.textContent).toContain("WELCOME20");
  await act(async () => { host.querySelector("[data-testid='marketing-tab-campaigns']").click(); });
  expect(host.querySelector("[data-testid='marketing-open-campaigns']")).toBeTruthy();
  act(() => root.unmount());
  host.remove();
});
