import { StickyActionBar } from "@/components/StickyActionBar";
import { BOOKING_STEP } from "@/lib/booking-selection";

/**
 * Lightweight mobile step shell: scroll clearance + optional StickyActionBar.
 * Parents own step index, URL sync, and validation — this only standardizes layout.
 */
export function FlowStepShell({
  children,
  actions = null,
  hint = null,
  hideActions = false,
  testid = "flow-step-shell",
  actionsTestid = "flow-step-actions",
  liftAt = "md",
  stacked = false,
  className = "",
  /** When false, children are not wrapped in nb-step-scroll (parent already wraps). */
  scrollBody = true,
}) {
  const showBar = Boolean(actions) && !hideActions;
  const body = scrollBody ? (
    <div className="nb-step-scroll min-w-0" data-testid={`${testid}-body`}>
      {children}
    </div>
  ) : (
    children
  );

  return (
    <div className={`min-w-0 ${className}`.trim()} data-testid={testid}>
      {body}
      {showBar ? (
        <StickyActionBar testid={actionsTestid} liftAt={liftAt} stacked={stacked}>
          {actions}
          {hint ? <div data-testid={`${actionsTestid}-hint`}>{hint}</div> : null}
        </StickyActionBar>
      ) : null}
    </div>
  );
}

/** True while AddressPicker owns confirm / details CTAs on the Where step. */
export function bookingAddressOwnsActions(draft, step) {
  return (
    step === BOOKING_STEP.WHERE
    && draft?.locationType !== "clinic"
    && Boolean(draft?.address?.line)
    && draft?.address?.detailsSettled !== true
  );
}
