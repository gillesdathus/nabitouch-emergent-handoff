import { useEffect } from "react";

/**
 * Keyboard / visual-viewport inset for sticky action bars.
 * When the soft keyboard opens, visualViewport shrinks; we publish the covered
 * bottom band as --nb-keyboard-inset so sticky CTAs sit above it.
 */
export function computeKeyboardInset(innerHeight, viewportHeight, viewportOffsetTop = 0) {
  const ih = Number(innerHeight) || 0;
  const vh = Number(viewportHeight) || 0;
  const ot = Number(viewportOffsetTop) || 0;
  return Math.max(0, Math.round(ih - vh - ot));
}

export function syncVisualViewportInset(root = typeof document !== "undefined" ? document.documentElement : null) {
  if (!root || typeof window === "undefined") return 0;
  const vv = window.visualViewport;
  const inset = vv
    ? computeKeyboardInset(window.innerHeight, vv.height, vv.offsetTop)
    : 0;
  root.style.setProperty("--nb-keyboard-inset", `${inset}px`);
  return inset;
}

export function installVisualViewportListener(root = typeof document !== "undefined" ? document.documentElement : null) {
  if (!root || typeof window === "undefined") return () => {};
  const sync = () => syncVisualViewportInset(root);
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
  }
  window.addEventListener("resize", sync);
  window.addEventListener("orientationchange", sync);
  sync();
  return () => {
    if (vv) {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    }
    window.removeEventListener("resize", sync);
    window.removeEventListener("orientationchange", sync);
    root.style.removeProperty("--nb-keyboard-inset");
  };
}

/** Mount once near the app root so all sticky bars share the same inset. */
export function useVisualViewportInset() {
  useEffect(() => installVisualViewportListener(), []);
}
