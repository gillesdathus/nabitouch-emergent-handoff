import { StickyActionBar } from "@/components/StickyActionBar";

/**
 * Shared terminal / completion layout for mobile-first CTAs.
 * Primary actions sit in StickyActionBar (fixed above bottom nav + safe area).
 * Optional footer content (PWA install, tracking notes) renders below the fold
 * so it cannot push primary actions out of the first viewport.
 */
export function CompletionScreen({
  children,
  actions,
  footer = null,
  testid = "completion-screen",
  actionsTestid = "completion-sticky-actions",
  /** Client screens lift at md; keep dock longer for staff if needed. */
  liftAt = "md",
  className = "",
}) {
  return (
    <div
      className={`mx-auto flex w-full max-w-xl flex-col px-5 pt-5 text-center ${className}`.trim()}
      data-testid={testid}
    >
      {/* Summary only — keep first viewport free of install / tracking extras. */}
      <div className="nb-completion-body nb-step-scroll min-w-0" data-testid={`${testid}-body`}>
        {children}
      </div>
      {actions ? (
        <StickyActionBar testid={actionsTestid} liftAt={liftAt} stacked>
          {actions}
        </StickyActionBar>
      ) : null}
      {/* After primary actions in document order (below fold on mobile; after CTAs on md+). */}
      {footer ? (
        <div className="mt-4 border-t border-sky-100 pb-[calc(var(--nb-sticky-bottom)+1rem)] pt-4 text-left md:pb-8" data-testid={`${testid}-footer`}>
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
