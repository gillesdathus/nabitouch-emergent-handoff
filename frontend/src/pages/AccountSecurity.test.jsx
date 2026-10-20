import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const h = vi.hoisted(() => ({
  securityStatus: vi.fn(),
  changePassword: vi.fn(),
  mfaReplaceStart: vi.fn(),
  mfaReplaceConfirm: vi.fn(),
  mfaReplaceCancel: vi.fn(),
  mfaRecoveryRegenerate: vi.fn(),
  revokeOtherSessions: vi.fn(),
  user: { email: "owner@example.com", role: "owner", name: "Owner" },
}));

vi.mock("@/lib/api", () => ({
  api: {
    securityStatus: h.securityStatus,
    changePassword: h.changePassword,
    mfaReplaceStart: h.mfaReplaceStart,
    mfaReplaceConfirm: h.mfaReplaceConfirm,
    mfaReplaceCancel: h.mfaReplaceCancel,
    mfaRecoveryRegenerate: h.mfaRecoveryRegenerate,
    revokeOtherSessions: h.revokeOtherSessions,
  },
  apiError: (e) => e?.response?.data?.detail || "Something went wrong. Please try again.",
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({ user: h.user }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), message: vi.fn(), error: vi.fn() } }));

import AccountSecurity from "./AccountSecurity";

function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(createElement(MemoryRouter, null, createElement(AccountSecurity))); });
  return {
    host,
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

test("signed-in owner sees account security and MFA controls", async () => {
  h.securityStatus.mockResolvedValue({
    email: "owner@example.com",
    role: "owner",
    mfaEnabled: true,
    mfaEnforced: true,
    recoveryCodesRemaining: 5,
    replacePending: false,
    sessionMfaVerified: true,
    activeSessions: 1,
  });
  const view = render();
  await act(async () => { await Promise.resolve(); });
  expect(view.host.querySelector("[data-testid='account-security-page']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='security-email']").textContent).toContain("owner@example.com");
  expect(view.host.querySelector("[data-testid='security-mfa-status']").textContent).toMatch(/On/);
  expect(view.host.querySelector("[data-testid='security-replace-start']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='security-disable-blocked']")).toBeTruthy();
  expect(view.host.textContent).not.toContain("Turn authenticator off");
  view.unmount();
});

test("signed-out visitor is sent to sign in", async () => {
  h.user = null;
  h.securityStatus.mockResolvedValue({});
  const view = render();
  await act(async () => { await Promise.resolve(); });
  expect(view.host.querySelector("[data-testid='security-signed-out']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='security-signin']")).toBeTruthy();
  h.user = { email: "owner@example.com", role: "owner", name: "Owner" };
  view.unmount();
});
