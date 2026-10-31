import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import Permissions from "@/pages/owner/Permissions";

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    api: globalThis.__permsApi,
    idx: { settings: { receptionPerms: { eclaimsView: true, managePayments: true }, mfaEnforcePrivileged: false } },
    user: { role: "owner", name: "Owner" },
    state: { practitioners: [{ id: "p-maya", name: "Maya Chen" }] },
    run: async (fn, message) => { await fn(); return message; },
  }),
}));

function mount(node) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  return {
    host,
    async render() {
      await act(async () => { root.render(createElement(MemoryRouter, null, node)); });
    },
    async cleanup() {
      await act(async () => { root.unmount(); });
      host.remove();
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  globalThis.__permsApi = {
    eclaimsPermissions: vi.fn(async () => ({
      manager: { note: "Managers inherit full eClaims workspace access." },
      practitioners: [{
        subject: "p-maya",
        name: "Maya Chen",
        email: "maya@example.com",
        status: "active",
        grants: [],
        flags: { view: false, submit: false, viewSensitive: false, allTreatments: false },
      }],
    })),
    setEclaimsPractitionerPermissions: vi.fn(async (_subject, flags) => ({
      grants: flags.view ? ["view", ...(flags.submit ? ["submit"] : [])] : [],
      flags: {
        view: !!flags.view,
        submit: !!flags.submit,
        viewSensitive: !!flags.viewSensitive,
        allTreatments: !!flags.allTreatments,
      },
    })),
    staff: vi.fn(async () => []),
    mfaEnroll: vi.fn(),
    patch: vi.fn(),
  };
});

test("permissions page shows manager, reception eClaims, and practitioner grant controls", async () => {
  const view = mount(createElement(Permissions));
  await view.render();
  expect(view.host.querySelector('[data-testid="permissions-manager"]')).toBeTruthy();
  expect(view.host.querySelector('[data-testid="permissions-reception-eclaims"]')).toBeTruthy();
  expect(view.host.querySelector('[data-testid="eclaims-practitioner-permissions"]')).toBeTruthy();
  expect(view.host.querySelector('[data-testid="eclaims-pract-p-maya-view"]')).toBeTruthy();
  expect(view.host.querySelector('[data-testid="eclaims-pract-p-maya-submit"]')).toBeTruthy();
  expect(view.host.querySelector('[data-testid="eclaims-pract-p-maya-viewSensitive"]')).toBeTruthy();
  expect(view.host.querySelector('[data-testid="eclaims-pract-p-maya-allTreatments"]')).toBeTruthy();
  await view.cleanup();
});

test("turning on submit asks the API with view implied by the handler", async () => {
  const view = mount(createElement(Permissions));
  await view.render();
  const submit = view.host.querySelector('[data-testid="eclaims-pract-p-maya-submit"]');
  await act(async () => { submit.click(); });
  expect(globalThis.__permsApi.setEclaimsPractitionerPermissions).toHaveBeenCalled();
  const [, flags] = globalThis.__permsApi.setEclaimsPractitionerPermissions.mock.calls.at(-1);
  expect(flags.view).toBe(true);
  expect(flags.submit).toBe(true);
  await view.cleanup();
});
