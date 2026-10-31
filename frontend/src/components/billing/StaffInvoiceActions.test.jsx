import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const h = vi.hoisted(() => ({
  checkout: vi.fn(),
  email: vi.fn(),
  record: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/api", () => ({
  api: {
    invoiceCheckout: h.checkout,
    emailInvoice: h.email,
    recordInvoicePayment: h.record,
    releaseInvoice: vi.fn(),
    recordTip: vi.fn(),
    issueInvoice: vi.fn(),
    invoiceEclaims: vi.fn(async () => ({
      policies: [],
      fields: [],
      pathways: [{ id: "telus-eclaims", name: "TELUS Health eClaims", kind: "platform", url: "https://www.providerconnect.ca/", notes: "" }],
      canSubmit: true,
      notice: "Opening an insurer portal does not submit a claim.",
    })),
    invoiceEclaimsFields: vi.fn(async () => ({ fields: [], incompleteFieldIds: [] })),
  },
  apiError: (e) => e?.message || "error",
}));
vi.mock("@/lib/useInvoices", () => ({ newKey: () => "idem-test-key-01" }));

import { StaffInvoiceActions } from "./StaffInvoiceActions";

const invoice = {
  id: "inv-1",
  number: "NT-INV-00042",
  state: "issued",
  version: 2,
  clientName: "Sarah Demo",
  clientEmail: "sarah.real@nabitouch.com",
  practitionerName: "Nabitu Kahindo",
  service: "Swedish massage",
  duration: 60,
  serviceDate: "2026-10-12",
  total: { cents: 10000, display: "$100.00" },
  balance: { cents: 10000, display: "$100.00" },
  received: { cents: 0, display: "$0.00" },
  expectedInsurance: { cents: 8000, display: "$80.00" },
  estimatedClientShare: { cents: 2000, display: "$20.00" },
  payableNow: { cents: 2000, display: "$20.00" },
  claims: [],
};

async function render(props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(StaffInvoiceActions, {
      invoice,
      emailOn: true,
      staffLink: "/owner/payments",
      ...props,
    })));
  });
  return {
    host,
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

beforeEach(() => {
  h.checkout.mockReset();
  h.email.mockReset();
  h.record.mockReset();
  Object.values(h.toast).forEach((fn) => fn.mockReset());
  h.checkout.mockResolvedValue({
    url: "https://checkout.stripe.com/c/pay/cs_test_share",
    sessionId: "cs_test_share",
    amount: { cents: 2000, display: "$20.00" },
  });
  h.email.mockResolvedValue({ queued: true, status: "queued", delivered: false, paymentUrl: "https://checkout.stripe.com/c/pay/cs_test_share" });
});

test("shows the four primary payment methods and insurance context without a patient search", async () => {
  const view = await render();
  for (const id of ["insurance", "stripe", "cash", "etransfer"]) {
    expect(view.host.querySelector(`[data-testid="staff-pay-method-${id}"]`)).toBeTruthy();
  }
  await act(async () => view.host.querySelector('[data-testid="staff-pay-method-insurance"]').click());
  expect(view.host.querySelector('[data-testid="staff-ins-patient"]').textContent).toBe("Sarah Demo");
  expect(view.host.querySelector('[data-testid="staff-ins-total"]').textContent).toBe("$100.00");
  expect(view.host.querySelector('[data-testid="staff-ins-share"]').textContent).toBe("$20.00");
  expect(view.host.textContent).not.toMatch(/search patient/i);
  view.unmount();
});

test("generates a client-share Stripe link and can copy it separately", async () => {
  const view = await render();
  await act(async () => view.host.querySelector('[data-testid="staff-payment-link-btn"]').click());
  expect(h.checkout).toHaveBeenCalledWith("inv-1", { forClient: true });
  expect(view.host.querySelector('[data-testid="staff-payment-link"]').textContent).toContain("checkout.stripe.com");
  await act(async () => view.host.querySelector('[data-testid="staff-payment-link-copy"]').click());
  expect(h.toast.success).toHaveBeenCalled();
  view.unmount();
});

test("emails a payment link only after the backend queues it", async () => {
  const view = await render();
  const input = view.host.querySelector('[data-testid="staff-payment-link-email"]');
  expect(input.value).toBe("sarah.real@nabitouch.com");
  await act(async () => view.host.querySelector('[data-testid="staff-payment-link-send"]').click());
  expect(h.email).toHaveBeenCalledWith("inv-1", "payment_link", "idem-test-key-01", { recipientEmail: "sarah.real@nabitouch.com" });
  expect(h.toast.success.mock.calls[0][0]).toMatch(/queued|emailed/i);
  view.unmount();
});

test("cash and e-Transfer use distinct record panels", async () => {
  const view = await render();
  await act(async () => view.host.querySelector('[data-testid="staff-pay-method-cash"]').click());
  expect(view.host.querySelector('[data-testid="staff-manual-payment-cash"]')).toBeTruthy();
  await act(async () => view.host.querySelector('[data-testid="staff-pay-method-etransfer"]').click());
  expect(view.host.querySelector('[data-testid="staff-manual-payment-etransfer"]')).toBeTruthy();
  view.unmount();
});
