import { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { AddressPicker } from "./AddressPicker";
import { api } from "@/lib/api";
import { quote } from "@/lib/domain";
import { etaCopy } from "@/lib/tracking/providers";

vi.mock("@/lib/api", () => ({
  api: { geoSuggest: vi.fn(), geoCheck: vi.fn(), geoConfirm: vi.fn() },
  apiError: (err) => err?.message || "Address search failed",
}));

beforeEach(() => {
  api.geoSuggest.mockReset();
  api.geoCheck.mockReset();
  api.geoConfirm.mockReset();
});

function Harness() {
  const [query, setQuery] = useState("");
  const [value, setValue] = useState(null);
  return <AddressPicker value={value} onChange={setValue} query={query} onQuery={setQuery} />;
}

function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  return {
    host,
    async find(testid) {
      const started = Date.now();
      while (Date.now() - started < 2000) {
        // Suggestion list is portaled to document.body above sticky chrome.
        const found = host.querySelector(`[data-testid="${testid}"]`)
          || document.querySelector(`[data-testid="${testid}"]`);
        if (found) return found;
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
      }
      throw new Error(`Missing ${testid}`);
    },
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

function type(input, value) {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

test("shows an Edmonton suggestion and the server travel fee", async () => {
  api.geoSuggest.mockResolvedValue({ suggestions: [{ id: "local-downtown", label: "10150 104 St NW, Edmonton, AB", area: "Downtown" }] });
  api.geoCheck.mockResolvedValue({
    eligible: true, line: "10150 104 St NW, Edmonton, AB", area: "Downtown",
    zone: { id: "z-central", name: "Central Edmonton", fee: 0 }, travel: 0, mapboxId: "local-downtown",
  });
  const view = mount(<Harness />);
  await act(async () => { type(view.host.querySelector("[data-testid=address-input]"), "104 St NW"); });
  const option = await view.find("address-option-0");
  await act(async () => { option.click(); });
  const ok = await view.find("address-zone-ok");
  expect(ok.textContent).toMatch(/Central Edmonton/);
  expect(ok.textContent).toMatch(/included/);
  const unit = view.host.querySelector("[data-testid=address-unit-input]");
  await act(async () => { type(unit, "Unit 4"); });
  expect(unit.value).toBe("Unit 4");
  view.cleanup();
});

test("shows an outside-area message and a geocoding error", async () => {
  api.geoSuggest.mockResolvedValue({ suggestions: [{ id: "local-leduc", label: "4950 Gateway Blvd, Leduc, AB", area: "Leduc" }] });
  api.geoCheck.mockResolvedValueOnce({ eligible: false, message: "That address is outside the mobile service area. You can still book an in-clinic visit." });
  const view = mount(<Harness />);
  await act(async () => { type(view.host.querySelector("[data-testid=address-input]"), "Leduc"); });
  const option = await view.find("address-option-0");
  await act(async () => { option.click(); });
  expect((await view.find("address-zone-outside")).textContent).toMatch(/outside the mobile service area/);

  api.geoSuggest.mockResolvedValue({ suggestions: [{ id: "missing", label: "999 Nowhere Rd, Edmonton, AB", area: "Edmonton" }] });
  api.geoCheck.mockRejectedValueOnce(new Error("We couldn't find that address."));
  await act(async () => { type(view.host.querySelector("[data-testid=address-input]"), "Nowhere"); });
  const next = await view.find("address-option-0");
  await act(async () => { next.click(); });
  expect((await view.find("address-error")).textContent).toMatch(/couldn't find/);
  view.cleanup();
});

test("shows a configuration error when address search is unavailable", async () => {
  api.geoSuggest.mockRejectedValue(new Error("Address search needs a Mapbox token. Add MAPBOX_TOKEN to this environment. Sample addresses are not offered."));
  const view = mount(<Harness />);
  await act(async () => { type(view.host.querySelector("[data-testid=address-input]"), "104 St NW"); });
  expect((await view.find("address-error")).textContent).toMatch(/Mapbox token/);
  expect(view.host.querySelector("[data-testid=address-option-0]")).toBeNull();
  view.cleanup();
});

test("coverage check can succeed while confirm still surfaces storage configuration failures", async () => {
  api.geoSuggest.mockResolvedValue({ suggestions: [{ id: "mbx-1", label: "10150 104 St NW, Edmonton, AB", area: "Downtown" }] });
  api.geoCheck.mockResolvedValue({
    eligible: true, line: "10150 104 St NW, Edmonton, AB", area: "Downtown",
    zone: { id: "z-central", name: "Central Edmonton", fee: 0 }, travel: 0, mapboxId: "mbx-1",
  });
  api.geoConfirm.mockRejectedValue(new Error("Address confirmation requires Mapbox storage configuration. Contact Nabitouch."));
  const view = mount(<Harness />);
  await act(async () => { type(view.host.querySelector("[data-testid=address-input]"), "104 St NW"); });
  const option = await view.find("address-option-0");
  await act(async () => { option.click(); });
  expect((await view.find("address-zone-ok")).textContent).toMatch(/Central Edmonton/);
  const confirm = await view.find("address-confirm");
  await act(async () => { confirm.click(); });
  expect((await view.find("address-error")).textContent).toMatch(/storage configuration/);
  view.cleanup();
});

test("GPS permission denied shows recovery copy and keeps the street field", async () => {
  vi.stubGlobal("navigator", {
    ...navigator,
    geolocation: {
      getCurrentPosition: (_ok, err) => err({ code: 1, message: "denied" }),
    },
  });
  const view = mount(<Harness />);
  await act(async () => { view.host.querySelector("[data-testid=address-geolocate-btn]").click(); });
  expect((await view.find("address-error")).textContent).toMatch(/couldn't read your location/i);
  expect(view.host.querySelector("[data-testid=address-input]")).toBeTruthy();
  expect(view.host.querySelector("[data-testid=address-confirm-card]")).toBeNull();
  view.cleanup();
  vi.unstubAllGlobals();
});

test("Change address from confirmation card restores the search field", async () => {
  api.geoSuggest.mockResolvedValue({ suggestions: [{ id: "local-downtown", label: "10150 104 St NW, Edmonton, AB", area: "Downtown" }] });
  api.geoCheck.mockResolvedValue({
    eligible: true, line: "10150 104 St NW, Edmonton, AB", area: "Downtown",
    zone: { id: "z-central", name: "Central Edmonton", fee: 0 }, travel: 0, mapboxId: "local-downtown",
  });
  const view = mount(<Harness />);
  await act(async () => { type(view.host.querySelector("[data-testid=address-input]"), "104 St NW"); });
  const option = await view.find("address-option-0");
  await act(async () => { option.click(); });
  expect(await view.find("address-confirm-card")).toBeTruthy();
  await act(async () => { (await view.find("address-change")).click(); });
  expect(view.host.querySelector("[data-testid=address-input]")).toBeTruthy();
  expect(view.host.querySelector("[data-testid=address-confirm-card]")).toBeNull();
  view.cleanup();
});

test("GPS coverage uses geoCheck with coordinates only", async () => {
  const position = { coords: { latitude: 53.54, longitude: -113.49 } };
  vi.stubGlobal("navigator", {
    ...navigator,
    geolocation: {
      getCurrentPosition: (ok) => ok(position),
    },
  });
  api.geoCheck.mockResolvedValue({
    eligible: true, line: "10150 104 St NW, Edmonton, AB", area: "Downtown",
    zone: { id: "z-central", name: "Central Edmonton", fee: 0 }, travel: 0, mapboxId: "mbx-gps",
  });
  const view = mount(<Harness />);
  await act(async () => { view.host.querySelector("[data-testid=address-geolocate-btn]").click(); });
  expect(api.geoCheck).toHaveBeenCalledWith({ lat: 53.54, lng: -113.49 });
  expect((await view.find("address-zone-ok")).textContent).toMatch(/Central Edmonton/);
  expect(await view.find("address-confirm-card")).toBeTruthy();
  expect(view.host.querySelector("[data-testid=address-input]")).toBeNull();
  expect((await view.find("address-card-detected")).textContent).toMatch(/Location detected/);
  view.cleanup();
  vi.unstubAllGlobals();
});

test("suite keystrokes do not wipe a typed postal before confirm", async () => {
  api.geoSuggest.mockResolvedValue({ suggestions: [{ id: "local-downtown", label: "10150 104 St NW, Edmonton, AB", area: "Downtown" }] });
  api.geoCheck.mockResolvedValue({
    eligible: true, line: "10150 104 St NW, Edmonton, AB", area: "Downtown",
    zone: { id: "z-central", name: "Central Edmonton", fee: 0 }, travel: 0, mapboxId: "local-downtown",
  });
  api.geoConfirm.mockResolvedValue({
    accepted: true, confidence: "address", line: "10150 104 St NW, Edmonton, AB",
    postalNormalized: "T5J 2R4", lat: 53.54, lng: -113.49, mapboxId: "local-downtown", travel: 0,
  });
  const view = mount(<Harness />);
  const input = view.host.querySelector("[data-testid=address-input]");
  await act(async () => { input.focus(); type(input, "104 St NW"); });
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  const option = await view.find("address-option-0");
  await act(async () => { option.click(); });
  await view.find("address-confirm-card");
  const postal = view.host.querySelector("[data-testid=address-postal-input]");
  const unit = view.host.querySelector("[data-testid=address-unit-input]");
  await act(async () => { type(postal, "T5J 2R4"); });
  await act(async () => { type(unit, "4"); });
  expect(view.host.querySelector("[data-testid=address-postal-input]").value).toBe("T5J 2R4");
  await act(async () => { (await view.find("address-confirm")).click(); });
  expect(api.geoConfirm).toHaveBeenCalledWith(expect.objectContaining({ postal: "T5J 2R4", unit: "4" }));
  expect((await view.find("address-confirmed")).textContent).toMatch(/confirmed this civic address/);
  view.cleanup();
});

test("requires an explicit confirm and does not treat an approximate match as verified", async () => {
  api.geoSuggest.mockResolvedValue({ suggestions: [{ id: "local-downtown", label: "10150 104 St NW, Edmonton, AB", area: "Downtown" }] });
  api.geoCheck.mockResolvedValue({
    eligible: true, line: "10150 104 St NW, Edmonton, AB", area: "Downtown",
    zone: { id: "z-central", name: "Central Edmonton", fee: 0 }, travel: 0, mapboxId: "local-downtown",
  });
  api.geoConfirm.mockResolvedValueOnce({
    accepted: false, confidence: "approximate", line: "10150 104 St NW, Edmonton, AB", postalNormalized: "",
  });
  const view = mount(<Harness />);
  await act(async () => { type(view.host.querySelector("[data-testid=address-input]"), "104 St NW"); });
  const option = await view.find("address-option-0");
  await act(async () => { option.click(); });
  const confirm = await view.find("address-confirm");
  await act(async () => { type(view.host.querySelector("[data-testid=address-postal-input]"), "T5J 2R4"); });
  await act(async () => { confirm.click(); });
  expect((await view.find("address-error")).textContent).toMatch(/not a verified civic address/);
  expect(view.host.querySelector("[data-testid=address-confirmed]")).toBeNull();

  api.geoConfirm.mockResolvedValueOnce({
    accepted: true, confidence: "address", line: "10150 104 St NW, Edmonton, AB",
    postalNormalized: "T5J 2R4", lat: 53.54, lng: -113.49, mapboxId: "local-downtown", travel: 0,
  });
  await act(async () => { (await view.find("address-confirm")).click(); });
  expect((await view.find("address-confirmed")).textContent).toMatch(/confirmed this civic address/);
  view.cleanup();
});

test("clinic bookings ignore a submitted travel fee and estimates are not confirmed arrivals", () => {
  const priced = quote({
    service: { slug: "swedish", prices: { 60: 120 } }, duration: 60, zone: { fee: 30, perKm: 2 },
    settings: { gst: 0.05, addons: [] }, promotions: [], locationType: "clinic", km: 10, serverTravel: 99,
  });
  expect(priced.travel).toBe(0);
  expect(priced.total).toBe(126);
  expect(etaCopy("mapbox-traffic")).toMatch(/not a confirmed arrival/);
  expect(etaCopy("mapbox")).toMatch(/Live traffic is unavailable/);
  expect(etaCopy("estimated")).toMatch(/Estimated travel time/);
});
