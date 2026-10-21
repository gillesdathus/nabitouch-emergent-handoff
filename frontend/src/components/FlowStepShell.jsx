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

/** Steps where the primary choice is a tile tap that auto-advances. */
export function bookingTapAdvanceStep(step, { trialFlow = false } = {}) {
  if (step === BOOKING_STEP.SERVICE || step === BOOKING_STEP.DURATION || step === BOOKING_STEP.WHEN) {
    return true;
  }
  return !trialFlow && step === BOOKING_STEP.PAYMENT;
}

/**
 * Shell Continue visibility: always on Where/You/Review; on tap-advance steps only
 * when the gate is already satisfied (fallback when a duration/time is pre-selected).
 */
export function bookingShellShowContinue(draft, step, ok, { trialFlow = false, reviewStep } = {}) {
  if (bookingAddressOwnsActions(draft, step)) return false;
  const review = reviewStep ?? (trialFlow ? BOOKING_STEP.YOU + 1 : BOOKING_STEP.REVIEW);
  if (step >= review) return true;
  if (step === BOOKING_STEP.WHERE || step === BOOKING_STEP.YOU) return true;
  if (bookingTapAdvanceStep(step, { trialFlow })) return Boolean(ok?.[step]);
  return true;
}
