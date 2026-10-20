import { Building2, CarFront, Coffee, Ban } from "lucide-react";
import { StatusPill } from "@/components/ui-kit";
import { cn } from "@/lib/utils";
import { isClinicVisit, timeRangeLabel, visitPlaceLabel } from "./scheduleUtils";

const KIND = {
  clinic: {
    label: "Clinic",
    Icon: Building2,
    shell: "border-blue-100 bg-blue-50/70",
    iconWrap: "bg-white text-nb-blue ring-blue-100",
    bar: "bg-nb-blue",
  },
  mobile: {
    label: "Mobile",
    Icon: CarFront,
    shell: "border-teal-100 bg-teal-50/70",
    iconWrap: "bg-white text-nb-teal ring-teal-100",
    bar: "bg-nb-teal",
  },
  break: {
    label: "Break",
    Icon: Coffee,
    shell: "border-slate-200 bg-slate-50",
    iconWrap: "bg-white text-slate-600 ring-slate-200",
    bar: "bg-slate-400",
  },
  unavailable: {
    label: "Unavailable",
    Icon: Ban,
    shell: "border-slate-200 bg-slate-100/80 opacity-80",
    iconWrap: "bg-white text-slate-500 ring-slate-200",
    bar: "bg-slate-300",
  },
};

export function blockKind(item) {
  if (item?.kind === "break" || item?.state === "blocked") return "break";
  if (item?.kind === "unavailable" || item?.state === "unavailable") return "unavailable";
  if (item?.locationType != null) return isClinicVisit(item) ? "clinic" : "mobile";
  return "unavailable";
}

export function AppointmentCard({ item, serviceName, onOpen, compact = false }) {
  const kind = blockKind(item);
  const meta = KIND[kind];
  const Icon = meta.Icon;
  const title = item.serviceSlug || item.title
    ? (serviceName || item.title || "Visit")
    : meta.label;
  const time = item.start && item.end
    ? timeRangeLabel(item.start, item.end)
    : timeRangeLabel(item.time, item.duration || 60);
  const place = kind === "clinic" || kind === "mobile" ? visitPlaceLabel(item) : meta.label;

  return (
    <button
      type="button"
      onClick={() => onOpen?.(item)}
      disabled={!onOpen}
      className={cn(
        "flex w-full min-w-0 items-stretch gap-0 overflow-hidden rounded-2xl border text-left transition-[box-shadow,transform] active:scale-[0.99]",
        meta.shell,
        onOpen && "hover:shadow-md focus-visible:ring-2 focus-visible:ring-nb-blue/40",
        !onOpen && "cursor-default",
        compact ? "min-h-14" : "min-h-[4.5rem]"
      )}
      data-testid={item.id ? `schedule-appt-${item.id}` : `schedule-block-${kind}-${item.start || "all"}`}
      aria-label={`${title}, ${time}, ${place}`}
    >
      <span className={cn("w-1.5 shrink-0", meta.bar)} aria-hidden="true" />
      <span className={cn("flex min-w-0 flex-1 items-start gap-3", compact ? "p-2.5" : "p-3.5")}>
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1", meta.iconWrap)}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="nb-num block text-sm font-semibold text-nb-ink">{time}</span>
          <span className="mt-0.5 block truncate text-sm font-medium text-nb-ink">{title}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-nb-ink ring-1 ring-black/5">
              <Icon className="h-3 w-3" aria-hidden="true" />
              {place}
            </span>
            {item.status && <StatusPill status={item.status} />}
          </span>
        </span>
      </span>
    </button>
  );
}
