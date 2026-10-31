import { Logo } from "@/components/brand";
import { engageProgress } from "@/lib/engage";

/**
 * Full-viewport, no page-scroll shell for Engage.
 * Content area may use internal scroll only when a step opts in (consent viewer).
 */
export function EngageShell({
  children,
  stepId,
  showProgress = true,
  actions = null,
  hint = null,
  banner = null,
  mode = "phone",
  eventLabel = "",
  testid = "engage-shell",
}) {
  const progress = engageProgress(stepId);
  const isWelcome = stepId === "welcome" || stepId === "idle" || stepId === "reset";

  return (
    <div
      className="engage-shell relative flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden"
      data-testid={testid}
      data-mode={mode}
      data-step={stepId}
    >
      <div className="pointer-events-none absolute inset-0 engage-ambient" aria-hidden="true" />

      <header className="relative z-10 flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-[calc(0.75rem+var(--nb-safe-t))] sm:px-6">
        <Logo className="scale-90 origin-left" />
        <div className="min-w-0 text-right">
          <p className="nb-eyebrow text-[10px]">Engage</p>
          {eventLabel ? (
            <p className="truncate text-xs font-medium text-nb-ink/80" data-testid="engage-event-chip">
              {eventLabel}
            </p>
          ) : null}
        </div>
      </header>

      {showProgress && !isWelcome ? (
        <div className="relative z-10 shrink-0 px-4 sm:px-6" data-testid="engage-progress">
          <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-nb-mute">
            <span>
              Step {progress.index + 1} of {progress.total}
            </span>
            <span className="nb-num">{progress.pct}%</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-white/70 ring-1 ring-sky-100"
            role="progressbar"
            aria-valuenow={progress.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Registration progress ${progress.pct} percent`}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#0B2E8A] via-[#1565F0] to-[#14D8C4] transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      ) : null}

      {banner ? <div className="relative z-10 shrink-0 px-4 pt-2 sm:px-6">{banner}</div> : null}

      <main className="relative z-10 flex min-h-0 flex-1 flex-col px-4 pb-2 pt-3 sm:px-6">
        <div className="engage-stage mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col" data-testid={`${testid}-stage`}>
          {children}
        </div>
      </main>

      {actions ? (
        <footer
          className="relative z-10 shrink-0 border-t border-sky-100/80 bg-white/90 px-4 pb-[calc(0.85rem+var(--nb-safe-b)+var(--nb-keyboard-inset))] pt-3 backdrop-blur-md sm:px-6"
          data-testid="engage-actions"
        >
          <div className="mx-auto flex w-full max-w-lg flex-col gap-2">{actions}</div>
          {hint ? (
            <p className="mx-auto mt-2 max-w-lg text-center text-xs text-amber-800" role="status" data-testid="engage-hint">
              {hint}
            </p>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}

export function EngageHeading({ title, sub, testid }) {
  return (
    <div className="mb-4 shrink-0 sm:mb-5" data-testid={testid}>
      <h1 className="font-display text-[1.65rem] font-semibold leading-tight tracking-tight text-nb-ink sm:text-3xl">
        {title}
      </h1>
      {sub ? <p className="mt-1.5 text-sm leading-snug text-nb-mute sm:text-[15px]">{sub}</p> : null}
    </div>
  );
}

export function EngageYesNo({ value, onChange, name, yesLabel = "Yes", noLabel = "No", testid }) {
  const opts = [
    { id: "yes", label: yesLabel },
    { id: "no", label: noLabel },
  ];
  return (
    <div className="grid grid-cols-2 gap-3" role="group" aria-label={name} data-testid={testid}>
      {opts.map((opt) => {
        const on = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={on}
            data-testid={`${testid}-${opt.id}`}
            onClick={() => onChange(opt.id)}
            className={`engage-choice flex min-h-[3.5rem] flex-col items-center justify-center gap-1 rounded-2xl border-2 px-3 py-3 text-sm font-semibold transition-[border-color,background-color,transform] duration-200 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 ${
              on
                ? "border-nb-teal bg-[#E3FAF5] text-nb-ink shadow-sm"
                : "border-sky-100 bg-white text-nb-ink hover:border-sky-200"
            }`}
          >
            <span
              className={`grid h-8 w-8 place-items-center rounded-full text-xs font-bold ${
                on ? "bg-nb-teal text-white" : "bg-sky-50 text-nb-mute"
              }`}
              aria-hidden="true"
            >
              {on ? "✓" : opt.id === "yes" ? "Y" : "N"}
            </span>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
