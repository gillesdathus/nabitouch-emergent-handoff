import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, vi } from "vitest";
import SessionPrep from "./SessionPrep";

const h = vi.hoisted(() => ({
  readiness: null,
  error: null,
  loading: false,
  setData: vi.fn(),
  reload: vi.fn(),
  confirmIntake: vi.fn(),
  signSessionConsent: vi.fn(),
  withdrawSessionConsent: vi.fn(),
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    me: { id: "c-1", firstName: "Ada", lastName: "Client" },
    state: {
      appointments: [{
        id: "a-1",
        serviceSlug: "swedish",
        date: "2026-10-20",
        time: "10:00",
        duration: 60,
        practitionerId: "p-1",
        address: { line: "12 River Rd" },
        location: "home",
        status: "confirmed",
      }],
    },
    idx: {
      services: { swedish: { name: "Swedish Massage" } },
      practitioners: { "p-1": { name: "Maya Chen" } },
    },
  }),
}));

vi.mock("@/components/session/SessionReadiness", async () => {
  const actual = await vi.importActual("@/components/session/SessionReadiness");
  return {
    ...actual,
    useSessionReadiness: () => ({
      data: h.readiness,
      error: h.error,
      loading: h.loading,
      reload: h.reload,
      setData: h.setData,
    }),
  };
});

vi.mock("@/lib/api", () => ({
  apiError: (e) => e?.response?.data?.detail || e?.message || "Something went wrong. Please try again.",
  api: {
    confirmIntake: (...args) => h.confirmIntake(...args),
    signSessionConsent: (...args) => h.signSessionConsent(...args),
    withdrawSessionConsent: (...args) => h.withdrawSessionConsent(...args),
    sessionReadiness: vi.fn(),
  },
}));

vi.mock("@/components/session/SignaturePad", () => ({
  SignaturePad: ({ onChange }) => createElement("button", {
    type: "button",
    "data-testid": "prep-signature",
    onClick: () => onChange("data:image/png;base64," + "a".repeat(400)),
  }, "Sign"),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function baseReadiness(overrides = {}) {
  return {
    appointmentId: "a-1",
    ready: false,
    questions: [{ id: "unwell", label: "Feeling unwell?", kind: "yesno" }],
    intake: {
      state: "confirm_needed",
      version: 2,
      at: "2026-10-01T12:00:00Z",
      latest: { allergies: "None", medications: "", conditions: ["None of these"] },
      answers: {},
    },
    consent: { state: "missing", record: null },
    consentText: "I consent to treatment.",
    consentVersion: "session-2026-1",
    acknowledgements: {
      explained: "Explained",
      withdraw: "Withdraw",
      draping: "Draping",
      accurate: "Accurate",
    },
    restrictions: null,
    ...overrides,
  };
}

function renderPrep() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(MemoryRouter, { initialEntries: ["/me/visit/a-1/prepare"] },
      createElement(Routes, null, createElement(Route, { path: "/me/visit/:id/prepare", element: createElement(SessionPrep) }))));
  });
  return {
    host,
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

beforeEach(() => {
  h.readiness = null;
  h.error = null;
  h.loading = false;
  h.setData.mockReset();
  h.reload.mockReset();
  h.confirmIntake.mockReset();
  h.signSessionConsent.mockReset();
  h.withdrawSessionConsent.mockReset();
  window.scrollTo = vi.fn();
});

afterEach(() => {
  document.body.innerHTML = "";
});

test("shows loading state while readiness is fetching", () => {
  h.loading = true;
  const view = renderPrep();
  expect(view.host.querySelector("[data-testid='prep-loading']")).toBeTruthy();
  view.unmount();
});

test("shows load error with retry when readiness fails", () => {
  h.error = { response: { data: { detail: "Not authenticated" } } };
  const view = renderPrep();
  expect(view.host.querySelector("[data-testid='prep-load-error']")).toBeTruthy();
  expect(view.host.textContent).toContain("Not authenticated");
  act(() => { view.host.querySelector("[data-testid='prep-load-retry']").click(); });
  expect(h.reload).toHaveBeenCalled();
  view.unmount();
});

test("incomplete health check shows confirm step instead of success", () => {
  h.readiness = baseReadiness();
  const view = renderPrep();
  expect(view.host.querySelector("[data-testid='prep-confirm-step']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='prep-done']")).toBeNull();
  view.unmount();
});

test("incomplete consent shows consent step after health is confirmed", () => {
  h.readiness = baseReadiness({
    intake: { ...baseReadiness().intake, state: "confirmed" },
  });
  const view = renderPrep();
  expect(view.host.querySelector("[data-testid='prep-consent-step']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='prep-done']")).toBeNull();
  view.unmount();
});

test("complete ready state shows confirmation, summary, and CTAs", () => {
  h.readiness = baseReadiness({
    ready: true,
    intake: { ...baseReadiness().intake, state: "confirmed" },
    consent: {
      state: "signed",
      record: { typedName: "Ada Client", at: "2026-10-19T18:00:00Z" },
    },
    restrictions: { pressureMax: "medium", draping: "standard", avoidAreas: [], sensitiveAreas: false, notes: "" },
  });
  const view = renderPrep();
  expect(view.host.querySelector("[data-testid='prep-done']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='prep-done-heading']").textContent).toBe("You're all set!");
  expect(view.host.querySelector("[data-testid='prep-done-message']").textContent).toContain("health check and consent are complete");
  expect(view.host.querySelector("[data-testid='prep-appointment-summary']").textContent).toContain("Swedish Massage");
  expect(view.host.querySelector("[data-testid='prep-appointment-summary']").textContent).toContain("Maya Chen");
  expect(view.host.querySelector("[data-testid='prep-done-saved']").textContent).toContain("saved on your account");
  expect(view.host.querySelector("[data-testid='prep-done-home']").getAttribute("href")).toBe("/me");
  expect(view.host.querySelector("[data-testid='prep-done-appointment']").getAttribute("href")).toBe("/me#upcoming-visit-card");
  view.unmount();
});

test("failed health confirm keeps form and shows retry", async () => {
  h.readiness = baseReadiness();
  h.confirmIntake.mockRejectedValue({ response: { data: { detail: "Document uploads are turned off" } } });
  const view = renderPrep();
  await act(async () => {
    view.host.querySelector("[data-testid='prep-changed-no']").click();
    view.host.querySelector("[data-testid='prep-answer-unwell-no']").click();
  });
  await act(async () => {
    view.host.querySelector("[data-testid='prep-confirm-submit']").click();
  });
  expect(view.host.querySelector("[data-testid='prep-confirm-error']")?.textContent).toContain("Document uploads are turned off");
  expect(view.host.querySelector("[data-testid='prep-confirm-step']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='prep-confirm-error-retry']")).toBeTruthy();
  view.unmount();
});
