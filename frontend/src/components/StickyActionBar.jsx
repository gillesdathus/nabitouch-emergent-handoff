/**
 * Shared mobile primary-action dock.
 * Uses --nb-sticky-bottom (nav + safe-area, or keyboard inset — whichever is larger).
 */
export function StickyActionBar({
  children,
  className = "",
  testid = "sticky-action-bar",
  /** Client booking lifts at md; staff Visit/SOAP keep the dock through lg. */
  liftAt = "md",
}) {
  const liftClass = liftAt === "lg" ? "nb-sticky-actions--lg" : "nb-sticky-actions--md";
  return (
    <div data-testid={testid} className={`nb-sticky-actions ${liftClass} ${className}`.trim()}>
      {children}
    </div>
  );
}
