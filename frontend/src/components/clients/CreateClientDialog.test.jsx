import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { api, toast } = vi.hoisted(() => ({
  api: {
    createClient: vi.fn(async (body) => ({
      id: "c-new",
      ...body,
      addresses: (body.addresses || []).map((row) => ({ ...row, id: row.id || "ad-1" })),
    })),
    clientWorkspace: vi.fn(async (id) => ({
      client: {
        id,
        firstName: "Sam",
        lastName: "Ortiz",
        addresses: [{
          id: "ad-1",
          line: "10150 104 St NW, Edmonton, AB",
          clientConfirmed: true,
          confidence: "address",
          lat: 53.54,
          lng: -113.49,
          mapboxId: "mbx-1",
        }],
      },
      access: { editAddresses: true },
    })),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({ refresh: vi.fn(async () => {}), api }),
}));

vi.mock("@/lib/api", () => ({
  api,
  apiError: (err) => err?.message || "failed",
}));

vi.mock("sonner", () => ({ toast }));

vi.mock("@/components/AddressPicker", () => ({
  AddressPicker: ({ value, onChange, query, onQuery, testid }) => createElement(
    "div",
    { "data-testid": testid },
    createElement("input", {
      "data-testid": `${testid}-input`,
      value: query || "",
      onChange: (e) => onQuery?.(e.target.value),
    }),
    createElement("button", {
      type: "button",
      "data-testid": `${testid}-fake-select`,
      onClick: () => onChange({
        line: "10150 104 St NW, Edmonton, AB",
        lat: 53.54,
        lng: -113.49,
        mapboxId: "mbx-1",
        postal: "T5J 2R4",
        confidence: "address",
        clientConfirmed: false,
        detailsSettled: false,
      }),
    }, "Select"),
    createElement("button", {
      type: "button",
      "data-testid": `${testid}-fake-confirm`,
      onClick: () => onChange({
        ...(value || {}),
        line: "10150 104 St NW, Edmonton, AB",
        lat: 53.54,
        lng: -113.49,
        mapboxId: "mbx-1",
        postal: "T5J 2R4",
        confidence: "address",
        clientConfirmed: true,
        detailsSettled: true,
      }),
    }, "Confirm"),
    createElement("button", {
      type: "button",
      "data-testid": `${testid}-fake-clear`,
      onClick: () => onChange(null),
    }, "Clear"),
  ),
}));

import { CreateClientDialog } from "./CreateClientDialog";

let host;
let root;

function mount(props = {}) {
  const onCreated = props.onCreated || vi.fn();
  const onClose = props.onClose || vi.fn();
  act(() => {
    root.render(createElement(CreateClientDialog, { open: true, onCreated, onClose, ...props }));
  });
  return { onCreated, onClose };
}

function q(id) {
  return host.querySelector(`[data-testid='${id}']`) || document.body.querySelector(`[data-testid='${id}']`);
}

async function click(id) {
  const node = q(id);
  expect(node).toBeTruthy();
  await act(async () => { node.click(); });
}

async function type(id, value) {
  const node = q(id);
  expect(node).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  api.createClient.mockClear();
  api.clientWorkspace.mockClear();
  toast.success.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

test("typed address without confirm does not create and shows an error", async () => {
  const { onCreated, onClose } = mount();
  await type("cc-first", "Sam");
  await type("cc-last", "Ortiz");
  await type("cc-address-picker-input", "10150 104 St");
  await click("cc-save");
  expect(api.createClient).not.toHaveBeenCalled();
  expect(q("cc-error")?.textContent).toMatch(/confirm the service address/i);
  expect(onCreated).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});

test("selected but unconfirmed address is rejected before create", async () => {
  mount();
  await type("cc-first", "Sam");
  await type("cc-last", "Ortiz");
  await click("cc-address-picker-fake-select");
  await click("cc-save");
  expect(api.createClient).not.toHaveBeenCalled();
  expect(q("cc-error")?.textContent).toMatch(/confirm the service address/i);
});

test("confirmed address creates, reloads workspace, then reports success", async () => {
  const { onCreated, onClose } = mount();
  await type("cc-first", "Sam");
  await type("cc-last", "Ortiz");
  await click("cc-address-picker-fake-select");
  await click("cc-address-picker-fake-confirm");
  await click("cc-save");
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  expect(api.createClient).toHaveBeenCalledWith(expect.objectContaining({
    firstName: "Sam",
    lastName: "Ortiz",
    addresses: [expect.objectContaining({
      line: "10150 104 St NW, Edmonton, AB",
      clientConfirmed: true,
      mapboxId: "mbx-1",
    })],
  }));
  expect(api.clientWorkspace).toHaveBeenCalledWith("c-new");
  expect(toast.success).toHaveBeenCalled();
  expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "c-new" }));
  expect(onClose).toHaveBeenCalled();
});

test("create without address still succeeds and does not require workspace address check", async () => {
  const { onCreated } = mount();
  await type("cc-first", "Sam");
  await type("cc-last", "Ortiz");
  await click("cc-save");
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(api.createClient).toHaveBeenCalledWith(expect.objectContaining({ addresses: [] }));
  expect(api.clientWorkspace).not.toHaveBeenCalled();
  expect(onCreated).toHaveBeenCalled();
  expect(toast.success).toHaveBeenCalled();
});
