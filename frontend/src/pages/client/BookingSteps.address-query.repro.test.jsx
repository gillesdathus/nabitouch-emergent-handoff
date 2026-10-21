/**
 * Slice 3 regression: Booking Where must keep typed characters (C1).
 * Home local-query path remains the control.
 */
import { useState, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { AddressPicker } from "@/components/AddressPicker";
import { addressSelectionPatch } from "@/lib/booking-selection";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { geoSuggest: vi.fn().mockResolvedValue({ suggestions: [] }), geoCheck: vi.fn(), geoConfirm: vi.fn() },
  apiError: (err) => err?.message || "Address search failed",
}));

function type(input, value) {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** Mirrors StepWhere wiring in BookingSteps.jsx (draft-controlled query). */
function BookingWhereHarness() {
  const [draft, setDraft] = useState({ addressQuery: "", address: null });
  const patchDraft = (p) => setDraft((d) => ({ ...d, ...p }));
  return createElement(AddressPicker, {
    testid: "step-where-address",
    query: draft.addressQuery,
    onQuery: (v) => patchDraft({ addressQuery: v }),
    value: draft.address,
    onChange: (a) => patchDraft(a
      ? addressSelectionPatch(a, { query: a.line, forceWhere: true })
      : addressSelectionPatch(null, { forceWhere: true, preserveQuery: true })),
  });
}

/** Mirrors Home.jsx wiring (local query state). */
function HomeHarness() {
  const [query, setQuery] = useState("");
  const [address, setAddress] = useState(null);
  return createElement(AddressPicker, {
    testid: "area-check",
    query,
    onQuery: setQuery,
    value: address,
    onChange: (next) => {
      if (!next) {
        setAddress(null);
        return;
      }
      setAddress(next);
    },
  });
}

beforeEach(() => {
  api.geoSuggest.mockReset();
  api.geoSuggest.mockResolvedValue({ suggestions: [] });
});

test("booking draft-controlled AddressPicker keeps typed characters on each keystroke", async () => {
  const view = mount(createElement(BookingWhereHarness));
  const input = view.host.querySelector("[data-testid=step-where-address-input]");
  await act(async () => { type(input, "101"); });
  expect(input.value).toBe("101");
  view.cleanup();
});

test("control: Home local-query AddressPicker keeps typed characters", async () => {
  const view = mount(createElement(HomeHarness));
  const input = view.host.querySelector("[data-testid=area-check-input]");
  await act(async () => { type(input, "101"); });
  expect(input.value).toBe("101");
  view.cleanup();
});
