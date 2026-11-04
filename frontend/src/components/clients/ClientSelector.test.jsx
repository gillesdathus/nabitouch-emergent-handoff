import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const api = {
  searchClients: vi.fn(async () => ({
    clients: [{ id: "c-amy", firstName: "Amy", lastName: "Nguyen", phone: "7805550101", email: "amy@example.com" }],
    duplicates: [],
  })),
  createClient: vi.fn(async (body) => ({ id: "c-new", ...body })),
};

const store = {
  api,
  refresh: vi.fn(async () => {}),
  idx: {
    clients: {
      "c-pre": { id: "c-pre", firstName: "Pat", lastName: "Lee", phone: "7805550199", email: "pat@example.com" },
    },
  },
  state: { clients: [] },
};

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => store,
}));

import { ClientSelector } from "./ClientSelector";

let host;
let root;

function mount(props = {}) {
  const onChange = props.onChange || vi.fn();
  act(() => {
    root.render(createElement(ClientSelector, { testidPrefix: "cs", onChange, ...props }));
  });
  return onChange;
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
  api.searchClients.mockClear();
  api.createClient.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

test("State A shows compact selected card and Change returns to search", async () => {
  const onChange = mount({
    value: "c-pre",
    client: store.idx.clients["c-pre"],
  });
  expect(q("cs-selected")).toBeTruthy();
  expect(q("cs-name")?.textContent).toContain("Pat Lee");
  expect(q("cs-input")).toBeFalsy();
  expect(q("cs-create")).toBeFalsy();
  await click("cs-change");
  expect(onChange).toHaveBeenCalledWith(null);
});

test("State B search lists matches and selecting collapses to State A via onChange", async () => {
  const onChange = mount({ value: "" });
  expect(q("cs-search")).toBeTruthy();
  expect(q("cs-create")).toBeFalsy();
  await type("cs-input", "Amy");
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(api.searchClients).toHaveBeenCalled();
  await click("cs-hit-c-amy");
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "c-amy" }));
});

test("State C create then cancel returns to search without creating", async () => {
  mount({ value: "" });
  await click("cs-new");
  expect(q("cs-create")).toBeTruthy();
  await type("cs-new-first", "Sam");
  await click("cs-create-cancel");
  expect(q("cs-search")).toBeTruthy();
  expect(api.createClient).not.toHaveBeenCalled();
});

test("creating a client selects it and does not leave the form open", async () => {
  const onChange = mount({ value: "" });
  await click("cs-new");
  await type("cs-new-first", "Sam");
  await type("cs-new-last", "Ortiz");
  await type("cs-new-phone", "7805550111");
  api.searchClients.mockResolvedValueOnce({ clients: [], duplicates: [] });
  await click("cs-create-save");
  await act(async () => { await Promise.resolve(); });
  expect(api.createClient).toHaveBeenCalledWith(expect.objectContaining({
    firstName: "Sam",
    lastName: "Ortiz",
    phone: "7805550111",
  }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "c-new" }));
});

test("duplicate matches are offered instead of silent duplicate creation", async () => {
  const onChange = mount({ value: "" });
  await click("cs-new");
  await type("cs-new-first", "Amy");
  await type("cs-new-last", "Nguyen");
  await type("cs-new-phone", "7805550101");
  api.searchClients.mockResolvedValueOnce({
    clients: [{ id: "c-amy", firstName: "Amy", lastName: "Nguyen", phone: "7805550101" }],
    duplicates: [],
  });
  await click("cs-create-save");
  await act(async () => { await Promise.resolve(); });
  expect(api.createClient).not.toHaveBeenCalled();
  expect(q("cs-dupes")).toBeTruthy();
  await click("cs-dupe-c-amy");
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "c-amy" }));
});
