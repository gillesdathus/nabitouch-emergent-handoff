import { Link } from "react-router-dom";
import { CheckCheck, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui-kit";

/** Rounded search field matching Messages Inbox references (Nabitouch tokens). */
export function TeamSearchField({ value, onChange, placeholder = "Search…", testid = "team-search" }) {
  return (
    <label className="relative block" data-testid={testid}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-nb-blue" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        className="nb-input h-12 w-full pl-10 pr-4"
        aria-label={placeholder}
      />
    </label>
  );
}

export function UnreadBadge({ count, testid = "team-unread-badge" }) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-nb-blue px-1.5 text-[10px] font-bold text-white" data-testid={testid}>
      {n > 9 ? "9+" : n}
    </span>
  );
}

export function PriorityPill({ level = "medium", testid }) {
  const tone = {
    high: "bg-rose-50 text-rose-800",
    medium: "bg-amber-50 text-amber-900",
    low: "bg-sky-50 text-sky-900",
  }[level] || "bg-slate-100 text-slate-700";
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", tone)} data-testid={testid}>
      {level}
    </span>
  );
}

export function RequestStatusPill({ status = "new", testid }) {
  const tone = {
    new: "bg-sky-50 text-sky-900",
    accepted: "tint-mint text-nb-navy",
    in_progress: "tint-lagoon text-nb-navy",
    resolved: "bg-teal-50 text-teal-800",
    escalated: "bg-rose-50 text-rose-800",
    cancelled: "bg-slate-100 text-slate-600",
    unable: "bg-amber-50 text-amber-900",
  }[status] || "bg-slate-100 text-slate-700";
  const label = String(status || "new").replace(/_/g, " ");
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize", tone)} data-testid={testid}>
      {label}
    </span>
  );
}

/** Conversation / request list row — screenshot density with Nabitouch styling. */
export function TeamInboxRow({
  to,
  person,
  title,
  subtitle,
  preview,
  timeLabel,
  unread = 0,
  showReadReceipt = false,
  testid,
}) {
  const body = (
    <>
      <span className="relative shrink-0">
        <Avatar person={person || { name: title, initials: (title || "?").slice(0, 1), color: "#1565F0" }} size={48} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="truncate text-sm font-semibold text-nb-ink">{title}</span>
          {timeLabel && <span className="shrink-0 text-[11px] text-nb-mute">{timeLabel}</span>}
        </span>
        {subtitle && <span className="mt-0.5 block truncate text-xs font-medium text-nb-mute">{subtitle}</span>}
        {preview && <span className="mt-0.5 block truncate text-xs text-nb-mute">{preview}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <UnreadBadge count={unread} />
        {showReadReceipt && unread <= 0 && <CheckCheck className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />}
      </span>
    </>
  );
  const className = "nb-card flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:border-nb-sky";
  if (to) return <Link to={to} data-testid={testid} className={className}>{body}</Link>;
  return <div data-testid={testid} className={className}>{body}</div>;
}

export function TeamAreaTile({ to, icon: Icon, title, detail, meta, tint = "tint-ice", testid, disabled = false }) {
  const inner = (
    <>
      <span className={cn("grid h-11 w-11 place-items-center rounded-2xl", tint)}>
        {Icon && <Icon className="h-5 w-5 text-nb-navy" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-nb-ink">{title}</span>
          {meta != null && meta !== "" && (
            <span className="rounded-full bg-nb-coral px-1.5 text-[10px] font-bold text-white">{meta}</span>
          )}
        </span>
        {detail && <span className="mt-0.5 block text-xs leading-snug text-nb-mute">{detail}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />
    </>
  );
  if (disabled || !to) {
    return (
      <div data-testid={testid} className="nb-card flex items-center gap-3 p-4 opacity-90">
        {inner}
      </div>
    );
  }
  return (
    <Link to={to} data-testid={testid} className="nb-card flex items-center gap-3 p-4 transition-colors hover:border-nb-sky">
      {inner}
    </Link>
  );
}

export function TeamComingSoon({ title, body, testid = "team-coming-soon" }) {
  return (
    <div className="nb-soft rounded-[28px] p-6 text-sm" data-testid={testid}>
      <p className="font-semibold text-nb-ink">{title}</p>
      <p className="mt-1 text-nb-mute">{body}</p>
    </div>
  );
}
