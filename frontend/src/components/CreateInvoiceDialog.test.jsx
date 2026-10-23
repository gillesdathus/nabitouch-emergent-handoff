import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CreateInvoiceDialog } from "./CreateInvoiceDialog";

const searchClients = vi.fn();
const createInvoice = vi.fn();
const run = vi.fn(async (fn) => fn());

const fatima = {
  id: "c-fatima",
  firstName: "Fatima Elsayed",
  lastName: "Fatima Elsayed",
  email: "fatima@example.com",
  phone: "7805550100",
};

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    state: {
      services: [{ slug: "swedish", name: "Swedish", prices: { 60: 90, 90: 120 } }],
      practitioners: [{ id: "p-1", name: "Maya" }],
      clients: [fatima],
    },
    idx: {
      services: { swedish: { slug: "swedish", name: "Swedish", prices: { 60: 90, 90: 120 } } },
      clients: { "c-fatima": fatima },
    },
    api: { searchClients, createInvoice },
    run,
  }),
}));

vi.mock("@/lib/api", () => ({
  apiError: (err) => err?.message || "Request failed",
}));

function mount(props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(CreateInvoiceDialog, { open: true, onClose: vi.fn(), ...props })));
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

function typeSearch(value) {
  const input = document.querySelector("[data-testid=inv-client-search]");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function advanceSearch() {
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  searchClients.mockReset();
  createInvoice.mockReset();
  run.mockClear();
  searchClients.mockResolvedValue({ clients: [fatima], duplicates: [] });
  createInvoice.mockResolvedValue({ id: "inv-1" });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("CreateInvoiceDialog patient selector", () => {
  test("shows a single Patient autocomplete and no second dropdown", () => {
    const view = mount();
    expect(document.querySelector("[data-testid=inv-client-search]")).toBeTruthy();
    expect(document.querySelector("[data-testid=inv-client-select]")).toBeNull();
    expect(document.querySelector("[data-testid=inv-patient-selector]")).toBeTruthy();
    const labels = [...document.querySelectorAll(".nb-label")].map((el) => el.textContent);
    expect(labels.filter((t) => t === "Patient").length).toBe(1);
    expect(labels).not.toContain("Find patient");
    view.cleanup();
  });

  test("typing Fat shows matching patients with unduplicated names", async () => {
    const view = mount();
    typeSearch("Fat");
    await advanceSearch();
    expect(searchClients).toHaveBeenCalledWith("Fat");
    const option = document.querySelector("[data-testid=inv-patient-option-c-fatima]");
    expect(option).toBeTruthy();
    expect(option.textContent).toContain("Fatima Elsayed");
    expect(option.textContent).not.toMatch(/Fatima Elsayed\s*Fatima Elsayed/);
    expect(option.textContent).toContain("fatima@example.com");
    view.cleanup();
  });

  test("tapping a result selects the patient and closes the list", async () => {
    const view = mount();
    typeSearch("Fat");
    await advanceSearch();
    await act(async () => {
      document.querySelector("[data-testid=inv-patient-option-c-fatima]").click();
    });
    expect(document.querySelector("[data-testid=inv-patient-selected]")).toBeTruthy();
    expect(document.querySelector("[data-testid=inv-patient-name]")?.textContent).toBe("Fatima Elsayed");
    expect(document.querySelector("[data-testid=inv-client-search]")).toBeNull();
    expect(document.querySelector("[data-testid=inv-patient-results]")).toBeNull();
    view.cleanup();
  });

  test("Change restores search", async () => {
    const view = mount({ clientId: "c-fatima" });
    expect(document.querySelector("[data-testid=inv-patient-selected]")).toBeTruthy();
    await act(async () => {
      document.querySelector("[data-testid=inv-patient-change]").click();
    });
    expect(document.querySelector("[data-testid=inv-client-search]")).toBeTruthy();
    expect(document.querySelector("[data-testid=inv-patient-selected]")).toBeNull();
    view.cleanup();
  });

  test("create invoice uses the selected patient id", async () => {
    const onClose = vi.fn();
    const view = mount({ onClose });
    typeSearch("Fat");
    await advanceSearch();
    await act(async () => {
      document.querySelector("[data-testid=inv-patient-option-c-fatima]").click();
    });
    await act(async () => {
      document.querySelector("[data-testid=inv-save-btn]").click();
    });
    await act(async () => { await Promise.resolve(); });
    expect(createInvoice).toHaveBeenCalled();
    expect(createInvoice.mock.calls[0][0].clientId).toBe("c-fatima");
    expect(onClose).toHaveBeenCalledWith({ id: "inv-1" });
    view.cleanup();
  });

  test("search by phone works", async () => {
    const view = mount();
    typeSearch("780555");
    await advanceSearch();
    expect(searchClients).toHaveBeenCalledWith("780555");
    expect(document.querySelector("[data-testid=inv-patient-option-c-fatima]")).toBeTruthy();
    view.cleanup();
  });

  test("shows empty and error with retry", async () => {
    searchClients.mockResolvedValueOnce({ clients: [], duplicates: [] });
    const view = mount();
    typeSearch("Zz");
    await advanceSearch();
    expect(document.querySelector("[data-testid=inv-patient-empty]")?.textContent).toMatch(/No matching patient/);

    searchClients.mockRejectedValueOnce(new Error("Network down"));
    typeSearch("Yy");
    await advanceSearch();
    expect(document.querySelector("[data-testid=inv-patient-error]")).toBeTruthy();

    searchClients.mockResolvedValueOnce({ clients: [fatima], duplicates: [] });
    await act(async () => {
      document.querySelector("[data-testid=inv-patient-retry]").click();
    });
    await advanceSearch();
    expect(document.querySelector("[data-testid=inv-patient-option-c-fatima]")).toBeTruthy();
    view.cleanup();
  });

  test("save stays disabled without a patient", () => {
    const view = mount();
    const btn = document.querySelector("[data-testid=inv-save-btn]");
    expect(btn.disabled).toBe(true);
    view.cleanup();
  });
});
