import { afterEach, describe, expect, test, vi } from "vitest";
import { computeKeyboardInset, syncVisualViewportInset } from "./viewport";

describe("computeKeyboardInset", () => {
  test("returns 0 when the visual viewport fills the layout viewport", () => {
    expect(computeKeyboardInset(800, 800, 0)).toBe(0);
  });

  test("returns the covered bottom band when the keyboard shrinks the visual viewport", () => {
    // Short phone with keyboard: layout 700, visible 420, offsetTop 0 → 280px inset
    expect(computeKeyboardInset(700, 420, 0)).toBe(280);
  });

  test("accounts for visualViewport.offsetTop (iOS rubber-band / scrolled focused field)", () => {
    expect(computeKeyboardInset(700, 420, 40)).toBe(240);
  });

  test("never returns a negative inset", () => {
    expect(computeKeyboardInset(500, 600, 0)).toBe(0);
  });
});

describe("syncVisualViewportInset", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--nb-keyboard-inset");
    vi.unstubAllGlobals();
  });

  test("publishes --nb-keyboard-inset on the document element", () => {
    vi.stubGlobal("visualViewport", {
      height: 400,
      offsetTop: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 720 });
    const inset = syncVisualViewportInset(document.documentElement);
    expect(inset).toBe(320);
    expect(document.documentElement.style.getPropertyValue("--nb-keyboard-inset")).toBe("320px");
  });
});
