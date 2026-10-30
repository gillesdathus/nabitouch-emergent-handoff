import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, test, vi } from "vitest";

const api = {
  legacySummary: vi.fn(async () => ({
    counts: { imported: 2, ready_to_invite: 1 },
    invoicesMessage: "No historical invoices found in the source system.",
  })),
  legacyPatients: vi.fn(async () => ({
    total: 2,
    page: 1,
    pageSize: 25,
    invoicesMessage: "No historical invoices found in the source system.",
    items: [
      {
        id: "leg-ready",
        sourceId: "src-ready",
        firstName: "Ada",
        lastName: "Ready",
        email: "ada.ready@example.com",
        phone: "7805550101",
        status: "imported",
        contactComplete: true,
        invitationReadiness: "ready_for_email_invitation",
        duplicateOf: null,
        clientId: null,
      },
      {
        id: "leg-blocked",
        sourceId: "src-blocked",
        firstName: "No",
        lastName: "Contact",
        email: "",
        phone: "",
        status: "needs_contact_review",
        contactComplete: false,
        invitationReadiness: "requires_contact_verification",
        duplicateOf: null,
        clientId: null,
      },
    ],
  })),
  legacyInvitations: vi.fn(async () => ({
    items: [],
    total: 0,
    openCount: 0,
    autoSendOnImport: false,
  })),
  legacyInviteEligible: vi.fn(async () => ({
    ids: ["leg-ready"],
    total: 1,
    autoExpand: false,
    filter: { q: "", status: "" },
  })),
  legacyInvitePreview: vi.fn(async (ids) => ({
    ready: ids.filter((id) => id === "leg-ready"),
    blocked: ids.filter((id) => id !== "leg-ready"),
    recipients: ids.includes("leg-ready") ? [{
      id: "leg-ready",
      firstName: "Ada",
      lastName: "Ready",
      destination: "ada.ready@example.com",
      channel: "email",
      eligible: true,
      reason: null,
    }] : [],
    excluded: ids.includes("leg-blocked") ? [{
      id: "leg-blocked",
      firstName: "No",
      lastName: "Contact",
      reason: "missing_contact",
      eligible: false,
    }] : [],
    confirmCount: ids.filter((id) => id === "leg-ready").length,
    requestedCount: ids.length,
    template: {
      subject: "Set up your Nabitouch account",
      previewText: "Use this private link to set up your Nabitouch account. It expires and can be used once.",
      includesClinicalDetail: false,
      marketingConsent: false,
    },
    willSend: false,
    autoSendOnImport: false,
  })),
  legacyInvite: vi.fn(async () => ({ id: "liv-1", delivery: "sent", patientId: "leg-ready" })),
  legacyInvitationsSend: vi.fn(async () => ({
    sent: [{ id: "liv-1", patientId: "leg-ready", delivery: "sent" }],
    failed: [],
    sentCount: 1,
    failedCount: 0,
    autoExpanded: false,
  })),
  legacyPatient: vi.fn(async (id) => ({
    id,
    sourceId: "src-ready",
    firstName: "Ada",
    lastName: "Ready",
    email: "ada.ready@example.com",
    phone: "7805550101",
    status: "imported",
    batchId: "lb-1",
    invoices: [],
    invoicesMessage: "No historical invoices found in the source system.",
    invitationReadiness: "ready_for_email_invitation",
    legacyConsentSigned: null,
  })),
  legacyInviteRevoke: vi.fn(async () => ({ revoked: true })),
  legacyReview: vi.fn(async () => ({})),
  legacyImport: vi.fn(async () => ({ imported: 1 })),
};

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    api,
    run: async (fn, _label) => fn(),
  }),
}));

import LegacyClients from "./LegacyClients";

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  return {
    host,
    async render() {
      await act(async () => { root.render(createElement(LegacyClients)); });
    },
    async click(testId) {
      const node = host.querySelector(`[data-testid='${testId}']`) || document.body.querySelector(`[data-testid='${testId}']`);
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
  Object.values(api).forEach((fn) => fn.mockClear?.());
});

test("patients invitations UI confirms individual send and never auto-sends", async () => {
  const view = mount();
  await view.render();
  expect(view.host.querySelector("[data-testid='legacy-clients']").textContent).toContain("Invitations");
  expect(view.host.textContent).toContain("Nothing is sent until you confirm");
  await view.click("legacy-invite-row-src-ready");
  expect(api.legacyInvitePreview).toHaveBeenCalledWith(["leg-ready"]);
  expect(document.body.querySelector("[data-testid='invite-confirm-modal']")).toBeTruthy();
  expect(document.body.querySelector("[data-testid='invite-template-preview']").textContent).toContain("Set up your Nabitouch account");
  expect(document.body.querySelector("[data-testid='invite-confirm-count']").textContent).toContain("1 invitation");
  expect(api.legacyInvite).not.toHaveBeenCalled();
  await view.click("invite-confirm-send");
  expect(api.legacyInvite).toHaveBeenCalledWith("leg-ready", {});
  view.unmount();
});

test("batch selection uses eligible filter set and confirms exact recipient count", async () => {
  const view = mount();
  await view.render();
  await view.click("invite-select-eligible");
  expect(api.legacyInviteEligible).toHaveBeenCalled();
  expect(view.host.querySelector("[data-testid='invite-selection-count']").textContent).toContain("1 selected");
  await view.click("legacy-batch-preview");
  expect(api.legacyInvitePreview).toHaveBeenCalledWith(["leg-ready"]);
  expect(document.body.querySelector("[data-testid='invite-confirm-count']").textContent).toContain("1 invitation");
  await view.click("invite-confirm-send");
  expect(api.legacyInvitationsSend).toHaveBeenCalledWith(["leg-ready"]);
  view.unmount();
});

test("excluded recipients appear in batch confirmation and blocked invite stays disabled", async () => {
  const view = mount();
  await view.render();
  const blockedInvite = view.host.querySelector("[data-testid='legacy-invite-row-src-blocked']");
  expect(blockedInvite.disabled).toBe(true);
  await act(async () => {
    view.host.querySelector("[data-testid='legacy-select-src-blocked']").click();
    view.host.querySelector("[data-testid='legacy-select-src-ready']").click();
  });
  await view.click("legacy-batch-send");
  expect(document.body.querySelector("[data-testid='invite-excluded']").textContent).toContain("excluded");
  expect(document.body.querySelector("[data-testid='invite-confirm-count']").textContent).toContain("1 invitation");
  await view.click("invite-cancel");
  expect(document.body.querySelector("[data-testid='invite-confirm-modal']")).toBeNull();
  expect(api.legacyInvitationsSend).not.toHaveBeenCalled();
  view.unmount();
});
