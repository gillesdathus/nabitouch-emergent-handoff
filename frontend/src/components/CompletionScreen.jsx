/**
 * Shared terminal / completion layout.
 * Primary actions sit in normal document flow immediately after the summary —
 * no sticky/fixed docks and no artificial viewport-height spacing.
 */
export function CompletionScreen({
  children,
  actions,
  footer = null,
  testid = "completion-screen",
  actionsTestid = "completion-actions",
  /** Kept for call-site compatibility; ignored (actions are always in-flow). */
  liftAt: _liftAt = "md",
  className = "",
}) {
  return (
    <div
      className={`mx-auto flex w-full max-w-xl flex-col px-5 pb-[calc(1.25rem+var(--nb-safe-b))] pt-5 text-center ${className}`.trim()}
      data-testid={testid}
    >
      <div className="min-w-0" data-testid={`${testid}-body`}>
        {children}
      </div>
      {actions ? (
        <div className="mt-5 w-full space-y-2" data-testid={actionsTestid}>
          {actions}
        </div>
      ) : null}
      {footer ? (
        <div className="mt-5 border-t border-sky-100 pt-4 text-left" data-testid={`${testid}-footer`}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/** Compact success header used on booking / payment terminals. */
export function CompletionHero({ mark, title, subtitle, children, testid = "completion-hero" }) {
  return (
    <div data-testid={testid} className="mx-auto max-w-md">
      <div className="flex justify-center">{mark}</div>
      <h1 className="mt-2 text-xl font-semibold tracking-tight sm:mt-3 sm:text-3xl">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-nb-mute sm:mt-1.5">{subtitle}</p> : null}
      {children}
    </div>
  );
}
