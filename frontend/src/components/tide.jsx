import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, ChevronRight, Info, Lock } from "lucide-react";
import { CatalogueImage } from "@/components/ui-kit";

export const cx = (...parts) => parts.filter(Boolean).join(" ");

export function useMedia(query) {
  const [match, setMatch] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatch(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return match;
}

export const Reveal = ({ i = 0, children, className = "" }) => (
  <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, delay: i * 0.05, ease: [0.2, 0.7, 0.2, 1] }} className={className}>
    {children}
  </motion.div>
);

export const IconTile = ({ icon: Icon, label, sub, tint = "tint-ice", onClick, testid, disabled, iconClass = "text-nb-blue" }) => (
  <button type="button" data-testid={testid} onClick={onClick} disabled={disabled} className={cx("group w-full rounded-3xl p-4 text-left transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.97]", tint, disabled && "opacity-70")}>
    <span className={cx("mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-white/80 shadow-sm", iconClass)}><Icon className="h-5 w-5" /></span>
    <p className="text-sm font-semibold leading-tight text-nb-ink">{label}</p>
    {sub && <p className="mt-0.5 text-[11.5px] leading-snug text-nb-mute">{sub}</p>}
  </button>
);

export const PageHeader = ({ eyebrow, title, sub, right }) => (
  <div className="mb-5 flex items-start justify-between gap-3">
    <div className="min-w-0">
      {eyebrow && <p className="nb-eyebrow mb-1">{eyebrow}</p>}
      <h1 className="text-[28px] font-semibold leading-[1.1] tracking-tight text-nb-ink sm:text-4xl">{title}</h1>
      {sub && <p className="mt-1.5 text-sm text-nb-mute">{sub}</p>}
    </div>
    {right}
  </div>
);

export const Field = ({ label, hint, children }) => (
  <label className="mb-4 block">
    <span className="nb-label">{label}</span>
    {children}
    {hint && <span className="mt-1.5 block text-xs text-nb-mute">{hint}</span>}
  </label>
);

export const Notice = ({ children, icon: Icon = Lock, tone = "off", testid, className = "" }) => (
  <div data-testid={testid} className={cx("flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-[13px] leading-snug", tone === "off" ? "bg-slate-100 text-nb-mute" : "text-nb-navy tint-ice", className)}>
    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
    <div>{children}</div>
  </div>
);

export const Row = ({ label, value, strong, className = "" }) => (
  <div className={cx("flex items-center justify-between py-2 text-sm", className)}>
    <span className="text-nb-mute">{label}</span>
    <span className={cx("nb-num", strong ? "font-semibold text-nb-ink" : "text-nb-ink")}>{value}</span>
  </div>
);

export const EmptyState = ({ icon: Icon = Info, title, body, action, testid }) => (
  <div data-testid={testid} className="flex flex-col items-center px-6 py-10 text-center">
    <span className="mb-4 grid h-16 w-16 place-items-center rounded-full text-nb-teal tint-mint"><Icon className="h-7 w-7" strokeWidth={1.5} /></span>
    <p className="font-semibold text-nb-ink">{title}</p>
    {body && <p className="mt-1 max-w-xs text-sm text-nb-mute">{body}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export function Segmented({ options, value, onChange, testid, className = "" }) {
  return (
    <div data-testid={testid} className={cx("inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-sky-100 bg-white p-1 no-scrollbar", className)}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button key={option.value} type="button" data-testid={testid ? `${testid}-${option.value}` : undefined} onClick={() => onChange(option.value)} className={cx("relative h-9 shrink-0 rounded-full px-4 text-sm font-medium transition-colors", on ? "text-white" : "text-nb-mute hover:text-nb-ink")}>
            {on && <motion.span layoutId={`${testid || "segment"}-pill`} transition={{ type: "spring", stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-full bg-nb-ink" />}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Stepper({ steps, current, testid = "stepper", onStep }) {
  return (
    <div data-testid={testid} className="flex w-full items-start">
      {steps.map((label, index) => {
        const done = index < current;
        const on = index === current;
        return (
          <button key={label} type="button" disabled={!onStep} onClick={() => onStep && onStep(index)} data-testid={`${testid}-${index}`} className="relative flex min-w-0 flex-1 flex-col items-center">
            {index > 0 && (
              <span className="absolute right-1/2 top-[13px] h-[3px] w-full rounded-full bg-sky-100">
                <motion.span initial={false} animate={{ width: index <= current ? "100%" : "0%" }} transition={{ duration: 0.35 }} className="block h-full rounded-full bg-gradient-to-r from-nb-blue to-nb-turq" />
              </span>
            )}
            <motion.span initial={false} animate={{ scale: on ? 1.12 : 1 }} className={cx("relative z-10 grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold", done ? "bg-nb-turq text-white" : on ? "bg-nb-blue text-white ring-4 ring-nb-blue/20" : "bg-white text-nb-mute ring-1 ring-sky-200")}>
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}
            </motion.span>
            <span className={cx("mt-1.5 max-w-full truncate px-0.5 text-center text-[10px] font-medium leading-tight sm:text-[10.5px]", on ? "text-nb-ink" : "text-nb-mute")}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function HubSection({ title, children, testid }) {
  return (
    <section data-testid={testid} className="nb-card flex flex-col p-2 sm:p-3">
      <h2 className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-nb-teal">{title}</h2>
      <div className="grid">{children}</div>
    </section>
  );
}

export function HubLink({ to, icon: Icon, title, detail, meta, testid, onClick, tint = "tint-ice" }) {
  const body = (
    <>
      <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-2xl", tint)}><Icon className="h-4 w-4 text-nb-navy" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-nb-ink">{title}</span>
        {detail && <span className="mt-0.5 block text-xs leading-snug text-nb-mute">{detail}</span>}
      </span>
      {meta ? <span className="nb-num shrink-0 text-xs font-semibold text-nb-navy">{meta}</span> : <ChevronRight className="h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />}
    </>
  );
  const className = "flex min-h-14 items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-sky-50 focus-visible:bg-sky-50";
  if (onClick) return <button type="button" data-testid={testid} onClick={onClick} className={className}>{body}</button>;
  return <Link to={to} data-testid={testid} className={className}>{body}</Link>;
}

export function TideAvatar({ person, size = 40 }) {
  const initials = person?.initials || `${person?.firstName?.[0] || person?.name?.[0] || "N"}`;
  const fallback = <span className="grid shrink-0 place-items-center rounded-full font-semibold text-white ring-2 ring-white nb-lagoon" style={{ width: size, height: size, fontSize: size * 0.36 }}>{initials}</span>;
  if (!person?.photo) return fallback;
  return <CatalogueImage src={person.photo} alt={person.name || ""} size="thumb" className="shrink-0 rounded-full object-cover object-top ring-2 ring-white" style={{ width: size, height: size }} fallback={fallback} />;
}
