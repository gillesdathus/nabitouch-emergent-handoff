import { Link } from "react-router-dom";
import { AlertTriangle, Inbox, RotateCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({ eyebrow, title, accent, description, actions, testid = "page-header" }) {
  return (
    <header className="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-3" data-testid={testid}>
      <div className="min-w-0">
        {eyebrow && <p className="nb-eyebrow mb-1">{eyebrow}</p>}
        <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight sm:text-3xl">
          {title}{accent && <> <span className="font-display font-normal italic nb-gradient-text">{accent}</span></>}
        </h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-nb-mute">{description}</p>}
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, action, children, testid, className, bodyClassName }) {
  return (
    <section className={cn("nb-panel", className)} data-testid={testid}>
      {(title || action) && (
        <div className="nb-panel-head">
          {title && <h2 className="nb-panel-title">{title}</h2>}
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn("nb-panel-body", bodyClassName)}>{children}</div>
    </section>
  );
}

const KPI_TONE = { default: "", warn: "text-amber-700", alert: "text-rose-700", good: "text-nb-teal" };

export function KpiCard({ label, value, sub, to, testid, icon: Icon, tone = "default" }) {
  const body = (
    <>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="line-clamp-2 text-xs font-medium leading-tight text-nb-mute">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-nb-mute/70" aria-hidden="true" />}
      </div>
      <p className={cn("nb-kpi-value mt-2", KPI_TONE[tone])} data-testid={testid && `${testid}-value`}>{value}</p>
      {sub && <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-nb-mute sm:text-xs">{sub}</p>}
    </>
  );
  if (to) return <Link to={to} className="nb-kpi" data-testid={testid}>{body}</Link>;
  return <div className="nb-kpi" data-testid={testid}>{body}</div>;
}

export function EmptyState({ icon: Icon = Inbox, title, body, action, testid = "empty-state", compact }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-2xl border border-dashed border-sky-200 bg-sky-50/40 text-center", compact ? "px-4 py-5" : "px-6 py-10")} data-testid={testid}>
      <Icon className="h-5 w-5 text-nb-mute" aria-hidden="true" />
      <p className="mt-2 text-sm font-semibold text-nb-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-xs text-nb-mute">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ message = "This could not be loaded.", onRetry, testid = "error-state" }) {
  return (
    <div role="alert" className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800" data-testid={testid}>
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold" data-testid={`${testid}-retry`}><RotateCw className="h-3.5 w-3.5" />Retry</button>}
    </div>
  );
}

export function Segmented({ options, value, onChange, testid, label }) {
  return (
    <div className="nb-seg" role="group" aria-label={label} data-testid={testid}>
      {options.map((opt) => {
        const [key, text] = Array.isArray(opt) ? opt : [opt, opt];
        return <button key={key} type="button" aria-pressed={value === key} className="nb-seg-btn" onClick={() => onChange(key)} data-testid={`${testid}-${key}`}>{text}</button>;
      })}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder = "Search", testid = "search-field" }) {
  return (
    <label className="relative block min-w-0 flex-1">
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-nb-mute" aria-hidden="true" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="nb-input h-11 pl-10" data-testid={testid} />
    </label>
  );
}

export function SkeletonRows({ rows = 3 }) {
  return <div className="space-y-2" aria-busy="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="nb-skeleton h-12 rounded-xl" />)}</div>;
}
