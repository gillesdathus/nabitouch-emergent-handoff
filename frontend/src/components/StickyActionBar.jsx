import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

function useLifted(liftAt) {
  const query = liftAt === "lg" ? "(min-width: 1024px)" : "(min-width: 768px)";
  const [lifted, setLifted] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const sync = () => setLifted(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return lifted;
}

/**
 * Shared mobile primary-action dock.
 * On small viewports: portaled to document.body + position:fixed above --nb-sticky-bottom
 * so ClientShell overflow-x:clip cannot park CTAs under FloatingNav.
 * At liftAt breakpoint: rendered inline (static) in document flow.
 */
export function StickyActionBar({
  children,
  className = "",
  testid = "sticky-action-bar",
  /** Client booking lifts at md; staff Visit/SOAP keep the dock through lg. */
  liftAt = "md",
  /** Reserve height for stacked primary+secondary CTAs (confirmation) vs single-row Continue. */
  stacked = false,
}) {
  const lifted = useLifted(liftAt);
  const liftClass = liftAt === "lg" ? "nb-sticky-actions--lg" : "nb-sticky-actions--md";
  const bar = (
    <div data-testid={testid} className={`nb-sticky-actions ${liftClass} ${className}`.trim()}>
      {children}
    </div>
  );
  if (lifted || typeof document === "undefined") return bar;
  // In-flow spacer reserves the dock height so fixed CTAs never cover summary content.
  return (
    <>
      <div
        className={`nb-sticky-actions-spacer${stacked ? " nb-sticky-actions-spacer--stacked" : ""}`}
        aria-hidden="true"
        data-testid={`${testid}-spacer`}
      />
      {createPortal(bar, document.body)}
    </>
  );
}
