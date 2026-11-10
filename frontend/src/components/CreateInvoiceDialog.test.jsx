import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => {
  const eligibility = vi.fn();
  const createInvoice = vi.fn();
  const searchClients = vi.fn();
  const api = { searchClients, invoiceWelcomeEligibility: eligibility, createInvoice };
  return {
    eligibility,
    createInvoice,
    searchClients,
    api,
    run: vi.fn((fn) => fn()),
    state: {
      clients: [{ id: "c-first", firstName: "First", lastName: "Client" }],
      services: [{ slug: "swedish", name: "Swedish", prices: { 60: 120 } }],
      practitioners: [],
    },
    idx: {
      services: { swedish: { name: "Swedish", prices: { 60: 120 } } },
      settings: { gst: 0.05 },
    },
  };
});

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    state: h.state,
    idx: h.idx,
    api: h.api,
    run: h.run,
  }),
}));

vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  const wrap = (tag) => ({ children }) => React.createElement(tag, null, children);
  return {
    Dialog: wrap("div"),
    DialogContent: wrap("div"),
    DialogTitle: wrap("h2"),
  };
});

vi.mock("@/lib/api", () => ({
  apiError: (error) => String(error?.message || error || "error"),
}));

import { CreateInvoiceDialog } from "./CreateInvoiceDialog";

async function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(CreateInvoiceDialog, { open: true, clientId: "c-first", onClose: vi.fn() }));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return {
    host,
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  h.eligibility.mockReset();
  h.createInvoice.mockReset();
  h.searchClients.mockReset();
  h.eligibility.mockResolvedValue({
    eligible: true, percentage: 20, maxDiscount: 40,
    reason: "Available for this client's first eligible treatment.",
  });
  h.createInvoice.mockResolvedValue({ id: "inv-demo" });
});

test("offers WELCOME20 with server eligibility and previews the discount", async () => {
  const view = await render();
  const radio = view.host.querySelector('[data-testid="inv-welcome20-option"]');
  expect(radio.disabled).toBe(false);
  await act(async () => { radio.click(); });
  expect(view.host.querySelector('[data-testid="inv-welcome-preview"]').textContent).toContain("24.00");
  await act(async () => { view.host.querySelector('[data-testid="inv-save-btn"]').click(); });
  expect(h.createInvoice).toHaveBeenCalledWith(expect.objectContaining({ discountMode: "welcome20", discount: 0 }));
  view.unmount();
});

test("ineligible clients cannot select WELCOME20", async () => {
  h.eligibility.mockResolvedValue({ eligible: false, reason: "Already used." });
  const view = await render();
  expect(view.host.querySelector('[data-testid="inv-welcome20-option"]').disabled).toBe(true);
  expect(view.host.querySelector('[data-testid="inv-welcome-status"]').textContent).toContain("Already used");
  view.unmount();
});
