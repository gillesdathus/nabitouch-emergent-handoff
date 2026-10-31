import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const h = vi.hoisted(() => ({
  eclaims: vi.fn(),
  fields: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/api", () => ({
  api: { invoiceEclaims: h.eclaims, invoiceEclaimsFields: h.fields },
  apiError: (e) => e?.message || "error",
}));

import { EClaimsWorkspace } from "./EClaimsWorkspace";

const body = {
  notice: "Opening an insurer portal does not submit a claim.",
  policies: [{ id: "ins-1", insurer: "Alberta Blue Cross", policy: "P-1", memberId: "M-1", complete: true }],
  selectedPolicyId: "ins-1",
  suggestedPathwayId: "alberta-blue-cross",
  fields: [
    { id: "patientName", label: "Patient name", value: "Sarah Thompson" },
    { id: "policyNumber", label: "Policy or group number", value: "P-1" },
  ],
  pathways: [
    { id: "alberta-blue-cross", name: "Alberta Blue Cross", kind: "carrier_portal", url: "https://provider.ab.bluecross.ca/", notes: "Portal only", suggested: true },
    { id: "telus-eclaims", name: "TELUS Health eClaims", kind: "platform", url: "https://providerportal.telushealth.com/", notes: "No auto submit", suggested: false },
    { id: "providerconnect", name: "providerConnect", kind: "platform", url: "https://www.providerconnect.ca/", notes: "Distinct portal", suggested: false },
  ],
  canSubmit: true,
  submitsFromApp: false,
};

async function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(EClaimsWorkspace, { invoiceId: "inv-1", clientId: "c-1" })));
  });
  return { host, unmount() { act(() => root.unmount()); host.remove(); } };
}

beforeEach(() => {
  h.eclaims.mockReset();
  h.fields.mockReset();
  h.toast.success.mockReset();
  h.eclaims.mockResolvedValue(body);
});

test("loads invoice eClaims context with copyable fields and portal noopener link", async () => {
  const view = await render();
  expect(h.eclaims).toHaveBeenCalledWith("inv-1");
  expect(view.host.querySelector('[data-testid="eclaims-field-patientName"]').textContent).toContain("Sarah Thompson");
  expect(view.host.querySelector('[data-testid="eclaims-pathway-suggested"]').textContent).toMatch(/Alberta Blue Cross/);
  const portal = view.host.querySelector('[data-testid="eclaims-open-portal"]');
  expect(portal.getAttribute("href")).toBe("https://provider.ab.bluecross.ca/");
  expect(portal.getAttribute("target")).toBe("_blank");
  expect(portal.getAttribute("rel")).toContain("noopener");
  expect(portal.getAttribute("rel")).toContain("noreferrer");
  view.unmount();
});

test("switching pathway updates the portal destination without claiming submission", async () => {
  const view = await render();
  await act(async () => view.host.querySelector('[data-testid="eclaims-pathway-telus-eclaims"]').click());
  expect(view.host.querySelector('[data-testid="eclaims-open-portal"]').getAttribute("href")).toBe("https://providerportal.telushealth.com/");
  await act(async () => view.host.querySelector('[data-testid="eclaims-pathway-providerconnect"]').click());
  expect(view.host.querySelector('[data-testid="eclaims-open-portal"]').getAttribute("href")).toBe("https://www.providerconnect.ca/");
  expect(view.host.textContent).toMatch(/does not submit/i);
  view.unmount();
});

test("shows sensitive-redaction notice when viewSensitive is false", async () => {
  h.eclaims.mockResolvedValue({
    ...body,
    viewSensitive: false,
    fields: [
      { id: "patientName", label: "Patient name", value: "Sarah Thompson" },
      { id: "policyNumber", label: "Policy or group number", value: "", sensitiveRedacted: true },
      { id: "memberId", label: "Member or certificate ID", value: "", sensitiveRedacted: true },
    ],
    policies: [{ id: "ins-1", insurer: "Alberta Blue Cross", policy: "", memberId: "", complete: true, sensitiveRedacted: true }],
  });
  const view = await render();
  expect(view.host.querySelector('[data-testid="eclaims-sensitive-redacted"]')).toBeTruthy();
  expect(view.host.querySelector('[data-testid="eclaims-field-policyNumber"]').textContent).toContain("Hidden for your role");
  view.unmount();
});
