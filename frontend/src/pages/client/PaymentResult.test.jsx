import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const h = vi.hoisted(() => ({ user: { id: "synthetic", role: "client" }, status: vi.fn(), cancel: vi.fn() }));
vi.mock("@/store/DemoStore", () => ({ useDemo: () => ({ user: h.user }) }));
vi.mock("@/lib/api", () => ({ api: { stripeReturn: h.status, cancelStripeCheckout: h.cancel } }));
import PaymentResult from "./PaymentResult";

async function render(url = "/me/billing/payment-result?session_id=cs_test_fixture&success=true&card=cancel") {
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(PaymentResult))));
  return { host, unmount() { act(() => root.unmount()); host.remove(); } };
}
beforeEach(() => { h.user = { id: "synthetic", role: "client" }; h.status.mockReset(); h.cancel.mockReset(); });

test.each([
  ["confirmed", "Payment confirmed"], ["pending", "Payment pending"],
  ["failed", "Payment failed or checkout expired"], ["cancelled", "Checkout cancelled"],
  ["refunded", "Payment refunded"], ["unrecognized", "Payment verification temporarily unavailable"],
])("renders authenticated backend state %s regardless of URL hints", async (status, title) => {
  h.status.mockResolvedValue({ status, amount: { display: "$25.20" }, balance: { display: "$75.60" } });
  const view = await render();
  expect(view.host.querySelector("h1").textContent).toBe(title);
  expect(h.status).toHaveBeenCalledWith("cs_test_fixture");
  expect(view.host.textContent).toContain("$75.60");
  view.unmount();
});
test("verification errors remain visible with retry", async () => {
  h.status.mockRejectedValue(new Error("private provider error must not be displayed"));
  const view = await render();
  expect(view.host.textContent).toContain("Payment verification temporarily unavailable");
  expect(view.host.textContent).not.toContain("private provider");
  h.status.mockResolvedValue({ status: "confirmed" });
  await act(async () => view.host.querySelector("button").click());
  expect(view.host.textContent).toContain("Payment confirmed");
  view.unmount();
});
test("missing Session does not infer success", async () => {
  const view = await render("/me/billing/payment-result?success=true");
  expect(h.status).not.toHaveBeenCalled();
  expect(view.host.textContent).toContain("Payment verification temporarily unavailable");
  view.unmount();
});
test("signed-out and expired sessions request authentication with a return path", async () => {
  h.status.mockRejectedValue({ response: { status: 401 } });
  const view = await render();
  expect(view.host.textContent).toContain("Sign in to verify your payment");
  expect(view.host.querySelector("a").getAttribute("href")).toContain("next=");
  view.unmount();
});
test("only explicit cancellation asks the authenticated backend to close Checkout", async () => {
  h.status.mockResolvedValue({ status: "pending" }); h.cancel.mockResolvedValue({ status: "cancelled" });
  const view = await render();
  expect(h.cancel).not.toHaveBeenCalled();
  await act(async () => [...view.host.querySelectorAll("button")].find((b) => b.textContent === "Cancel this checkout").click());
  expect(h.cancel).toHaveBeenCalledWith("cs_test_fixture");
  expect(view.host.textContent).toContain("Checkout cancelled");
  view.unmount();
});
