import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, vi } from "vitest";
import ProfileForm from "./ProfileForm";

const h = vi.hoisted(() => ({
  settings: { documentUploadsEnabled: false },
  appointments: [],
  patch: vi.fn(async () => ({})),
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    me: {
      id: "c-1",
      firstName: "Ada",
      lastName: "Client",
      email: "ada@example.com",
      phone: "7805550100",
      dob: "1990-01-01",
      language: "English",
      contactMethod: "Text",
      addresses: [],
      photo: "data:image/jpeg;base64,EXISTING",
      clientId: "c-1",
    },
    state: {
      zones: [],
      appointments: h.appointments,
    },
    idx: { settings: h.settings },
    run: async (fn) => fn(),
    api: { patch: h.patch, recordConsent: vi.fn(async () => ({})) },
    register: vi.fn(),
  }),
}));

vi.mock("@/components/AddressPicker", () => ({
  AddressPicker: () => createElement("div", { "data-testid": "profile-address-input" }),
}));

function renderForm() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(ProfileForm)));
  });
  return {
    host,
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

beforeEach(() => {
  h.settings.documentUploadsEnabled = false;
  h.appointments = [];
  h.patch.mockReset();
  h.patch.mockResolvedValue({});
});

afterEach(() => {
  document.body.innerHTML = "";
});

test("hides profile photo controls when document uploads are off", () => {
  const view = renderForm();
  expect(view.host.querySelector("[data-testid='profile-photo-unavailable']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='profile-photo-btn']")).toBeNull();
  view.unmount();
});

test("shows profile photo controls when document uploads are on", () => {
  h.settings.documentUploadsEnabled = true;
  const view = renderForm();
  expect(view.host.querySelector("[data-testid='profile-photo-btn']")).toBeTruthy();
  expect(view.host.querySelector("[data-testid='profile-photo-unavailable']")).toBeNull();
  view.unmount();
});

test("save strips photo when document uploads are off", async () => {
  const view = renderForm();
  await act(async () => {
    view.host.querySelector("[data-testid='profile-save-btn']").click();
  });
  expect(h.patch).toHaveBeenCalled();
  const body = h.patch.mock.calls[0][2];
  expect(body.photo).toBeUndefined();
  expect(body.firstName).toBe("Ada");
  view.unmount();
});

test("hides mobile visit consent unless a non-clinic appointment is open", () => {
  const view = renderForm();
  expect(view.host.querySelector("[data-testid='consent-mobile']")).toBeNull();
  view.unmount();

  h.appointments = [{ id: "a-1", clientId: "c-1", location: "home", status: "confirmed" }];
  const withMobile = renderForm();
  expect(withMobile.host.querySelector("[data-testid='consent-mobile']")).toBeTruthy();
  withMobile.unmount();
});
