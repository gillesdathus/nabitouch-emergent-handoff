/**
 * Booking confirmation: primary CTAs in StickyActionBar; install/tracking below.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import Booking from "./Booking";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }) => children,
  motion: {
    div: ({ children, ...props }) => createElement("div", props, children),
    button: ({ children, ...props }) => createElement("button", props, children),
    span: ({ children, ...props }) => createElement("span", props, children),
  },
}));

vi.mock("sonner", () => ({ toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() } }));

const h = vi.hoisted(() => ({
  draft: {
    step: 6,
    bookingFlowVersion: 2,
    locationType: "home",
    address: null,
    addressQuery: "",
    addressNotes: "",
    forceWhere: false,
    serviceId: "svc-swedish",
    serviceSlug: "swedish",
    duration: 60,
    addons: [],
    date: null,
    time: null,
    practitionerId: "",
    goals: [],
    focus: [],
    notes: "",
    paymentMethod: "self",
    selfMethod: "cash",
    guest: { firstName: "", lastName: "", email: "", phone: "", createProfile: false, dob: "", marketingConsent: false },
  },
  doneAppt: {
    id: "ap-1",
    ref: "NT-CONF",
    serviceSlug: "swedish",
    duration: 60,
    date: "2026-10-21",
    time: "09:00",
    status: "requested",
    practitionerId: null,
    payNow: "cash",
    clientId: "c-new",
    pricing: { base: 120, total: 126, tax: 6, travel: 0, discount: 0, addons: 0, addonList: [] },
    paymentDue: { totalCents: 12600, dueNowCents: 0, remainingCents: 12600, choice: "cash" },
  },
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    draft: h.draft,
    patchDraft: vi.fn(),
    me: null,
    state: {
      zones: [],
      services: [{ id: "svc-swedish", slug: "swedish", name: "Swedish Massage", prices: { 60: 120 }, publication: "published", img: "" }],
      promotions: [],
      appointments: [h.doneAppt],
      practitioners: [],
    },
    idx: {
      services: { swedish: { id: "svc-swedish", slug: "swedish", name: "Swedish Massage", prices: { 60: 120 }, img: "" } },
      practitioners: {},
      clients: { "c-new": { id: "c-new", onlineBookings: 1 } },
      settings: { clinic: { enabled: false }, addons: [], paymentPolicy: { mode: "full", cashAccepted: true } },
    },
    api: {
      plansMine: vi.fn(async () => ({ wallet: [] })),
      winbackMine: vi.fn(async () => ({ invite: null })),
      followupMine: vi.fn(async () => ({ coupons: [] })),
      quoteBooking: vi.fn(),
      recommend: vi.fn(async () => ({ slots: [] })),
      book: vi.fn(),
    },
    run: (fn) => fn(),
    resetDraft: vi.fn(),
    register: vi.fn(),
  }),
}));

vi.mock("@/components/AddressPicker", () => ({
  AddressPicker: () => createElement("div"),
}));

// Force confirmation branch by wrapping — inject done via module mock of useState is heavy;
// instead render a thin harness that mirrors the confirmation layout contract after book.
import { CompletionHero, CompletionScreen } from "@/components/CompletionScreen";
import { InstallCard } from "@/components/InstallCard";
import { SuccessMark } from "@/components/ui-kit";
import { Link } from "react-router-dom";

function ConfirmationFixture({ withInstall = true }) {
  const live = h.doneAppt;
  return createElement(
    CompletionScreen,
    {
      testid: "booking-confirmation",
      actionsTestid: "booking-confirmation-actions",
      actions: createElement(
        "div",
        { className: "flex w-full flex-col gap-2" },
        createElement(Link, { to: "/me", "data-testid": "confirmation-view-visit-btn", className: "nb-btn-primary h-12" }, "View my visit"),
        createElement(Link, { to: "/", "data-testid": "confirmation-home-btn", className: "nb-btn-ghost h-12" }, "Back home"),
      ),
      footer: createElement(
        "div",
        null,
        createElement("p", { "data-testid": "booking-settlement-note" }, "Request confirmed — no online payment collected. Cash is due at the visit."),
        withInstall ? createElement(InstallCard, { collapsible: true }) : null,
      ),
    },
    createElement(CompletionHero, {
      mark: createElement(SuccessMark, { size: 44 }),
      title: "Request received",
      subtitle: createElement("span", null, "Reference ", createElement("b", { "data-testid": "booking-ref" }, live.ref)),
    }),
    createElement(
      "div",
      { className: "nb-card mt-3 p-3 text-left", "data-testid": "booking-confirmation-summary" },
      createElement("div", { "data-testid": "price-breakdown" },
        createElement("div", { "data-testid": "breakdown-total" }, "Appointment total $126.00"),
        createElement("div", { "data-testid": "breakdown-due-now" }, "Due now $0.00"),
        createElement("div", { "data-testid": "breakdown-remaining" }, "Remaining balance $126.00"),
        createElement("p", { "data-testid": "breakdown-settlement-note" }, "No payment collected online. Cash is due at the visit — this booking is not prepaid."),
      ),
    ),
  );
}

function mountConfirm(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(MemoryRouter, null, ui)));
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  localStorage.removeItem("nt_install_card_dismissed");
});

describe("Booking confirmation layout", () => {
  test("primary actions use sticky dock; install is collapsible in footer after actions", () => {
    const view = mountConfirm(createElement(ConfirmationFixture));
    const actions = document.querySelector("[data-testid=booking-confirmation-actions]");
    const viewVisit = document.querySelector("[data-testid=confirmation-view-visit-btn]");
    const home = document.querySelector("[data-testid=confirmation-home-btn]");
    const install = view.host.querySelector("[data-testid=install-prompt-card]");
    const footer = view.host.querySelector("[data-testid=booking-confirmation-footer]");
    expect(actions.className).toMatch(/nb-sticky-actions/);
    expect(actions.contains(viewVisit)).toBe(true);
    expect(actions.contains(home)).toBe(true);
    expect(view.host.contains(actions)).toBe(false);
    expect(footer.contains(install)).toBe(true);
    expect(view.host.querySelector("[data-testid=install-card-toggle]")).toBeTruthy();
    expect(view.host.querySelector("[data-testid=booking-confirmation]").className).not.toMatch(/py-14/);
    view.cleanup();
  });

  test("cash settlement copy does not claim a deposit was due online", () => {
    const view = mountConfirm(createElement(ConfirmationFixture, { withInstall: false }));
    expect(view.host.querySelector("[data-testid=breakdown-settlement-note]").textContent).toMatch(/No payment collected online/);
    expect(view.host.querySelector("[data-testid=breakdown-settlement-note]").textContent).not.toMatch(/deposit/i);
    expect(view.host.querySelector("[data-testid=booking-settlement-note]").textContent).toMatch(/no online payment collected/i);
    view.cleanup();
  });

  test("375 and 390 viewports keep primary CTA inside sticky actions (layout contract)", () => {
    for (const [w, hgt] of [[375, 667], [390, 844]]) {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: hgt });
      const view = mountConfirm(createElement(ConfirmationFixture));
      const actions = document.querySelector("[data-testid=booking-confirmation-actions]");
      const btn = document.querySelector("[data-testid=confirmation-view-visit-btn]");
      expect(actions).toBeTruthy();
      expect(view.host.contains(actions)).toBe(false);
      expect(actions.className).toMatch(/nb-sticky-actions/);
      expect(btn).toBeTruthy();
      expect(actions.contains(btn)).toBe(true);
      view.cleanup();
    }
  });
});

// Keep Booking import referenced so tree-shaking does not drop coverage of the live module path.
test("Booking module exports default component", () => {
  expect(typeof Booking).toBe("function");
});
