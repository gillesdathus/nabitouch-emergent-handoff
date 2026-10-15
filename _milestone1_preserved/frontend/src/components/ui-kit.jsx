import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Drawer } from "vaul";
import { X, Check, Info, Lock } from "lucide-react";
import { STATUS, PAY, initials, money0 } from "@/lib/domain";

export const cx = (...c) => c.filter(Boolean).join(" ");

export function useMedia(q) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

export const Card = ({ className = "", children, ...p }) => <div className={cx("nb-card", className)} {...p}>{children}</div>;

export function Avatar({ src, name, size = 40, className = "" }) {
  const s = { width: size, height: size };
  if (src) return <img src={src} alt={name} style={s} className={cx("rounded-full object-cover object-top shrink-0 ring-2 ring-white", className)} />;
  return (
    <span style={{ ...s, fontSize: size * 0.36 }} className={cx("nb-lagoon shrink-0 rounded-full grid place-items-center font-semibold text-white ring-2 ring-white", className)}>
      {initials(name)}
    </span>
  );
}

export const Pill = ({ tone = "bg-slate-100 text-nb-mute ring-slate-200", children, className = "", ...p }) => (
  <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 h-6 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap transition-colors duration-300", tone, className)} {...p}>{children}</span>
);
export const StatusPill = ({ status, ...p }) => <Pill tone={STATUS[status]?.tone} {...p}>{STATUS[status]?.label}</Pill>;
export const PayPill = ({ pay, ...p }) => <Pill tone={PAY[pay]?.tone} {...p}>{PAY[pay]?.label}</Pill>;

export const SectionHead = ({ title, action, onAction, testid, className = "", dark }) => (
  <div className={cx("flex items-end justify-between mb-3", className)}>
    <h2 className={cx("text-base md:text-lg font-semibold", dark ? "text-white" : "text-nb-ink")}>{title}</h2>
    {action && <button data-testid={testid} onClick={onAction} className={cx("text-sm font-medium", dark ? "text-nb-cyan" : "text-nb-blue")}>{action}</button>}
  </div>
);

export const Skeleton = ({ className = "" }) => <div className={cx("nb-skeleton rounded-2xl", className)} />;

export const EmptyState = ({ icon: Icon = Info, title, body, action, testid }) => (
  <div data-testid={testid} className="flex flex-col items-center text-center py-10 px-6">
    <div className="relative mb-4">
      <span className="absolute inset-0 rounded-full bg-nb-turq/20 nb-breathe" />
      <span className="relative grid place-items-center h-16 w-16 rounded-full tint-mint text-nb-teal"><Icon className="h-7 w-7" strokeWidth={1.5} /></span>
    </div>
    <p className="font-semibold text-nb-ink">{title}</p>
    {body && <p className="text-sm text-nb-mute mt-1 max-w-xs">{body}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export function CountUp({ value, format = money0, duration = 750 }) {
  const [v, setV] = useState(0);
  const raf = useRef();
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(value);
      return undefined;
    }
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / duration);
      setV(value * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);
  return <span className="nb-num">{format(v)}</span>;
}

export function Segmented({ options, value, onChange, testid, dark, className = "" }) {
  return (
    <div data-testid={testid} className={cx("inline-flex p-1 rounded-full", dark ? "bg-white/10" : "bg-white border border-sky-100", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} data-testid={`${testid}-${o.value}`} onClick={() => onChange(o.value)} className={cx("relative px-4 h-9 rounded-full text-sm font-medium transition-colors", on ? "text-white" : dark ? "text-white/70" : "text-nb-mute hover:text-nb-ink")}>
            {on && <motion.span layoutId={`${testid}-pill`} transition={{ type: "spring", stiffness: 420, damping: 34 }} className={cx("absolute inset-0 rounded-full", dark ? "bg-nb-blue" : "bg-nb-ink")} />}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function BottomSheet({ open, onOpenChange, title, sub, children, footer, testid, full }) {
  const desk = useMedia("(min-width: 1024px)");
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction={desk ? "right" : "bottom"}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[60] bg-nb-ink/40 backdrop-blur-[2px]" />
        <Drawer.Content data-testid={testid} aria-describedby={undefined} className={cx("fixed z-[61] bg-white flex flex-col outline-none", desk ? "right-0 top-0 bottom-0 w-[480px] shadow-2xl" : cx("inset-x-0 bottom-0 rounded-t-[28px]", full ? "h-[94dvh]" : "max-h-[92dvh]"))}>
          {!desk && <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-slate-200 shrink-0" />}
          <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 shrink-0">
            <div className="min-w-0">
              <Drawer.Title className="text-lg font-semibold text-nb-ink truncate">{title}</Drawer.Title>
              {sub && <p className="text-sm text-nb-mute mt-0.5">{sub}</p>}
            </div>
            <button data-testid={`${testid}-close`} onClick={() => onOpenChange(false)} className="h-10 w-10 shrink-0 grid place-items-center rounded-full bg-slate-100 text-nb-mute hover:bg-slate-200" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-6">{children}</div>
          {footer && <div className="shrink-0 border-t border-sky-100 px-5 py-4 safe-bottom bg-white">{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function Stepper({ steps, current, dark, testid = "stepper" }) {
  return (
    <div data-testid={testid} className="flex items-start w-full">
      {steps.map((s, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <div key={s} className="flex-1 flex flex-col items-center relative">
            {i > 0 && (
              <div className={cx("absolute top-[13px] right-1/2 w-full h-[3px] rounded-full", dark ? "bg-white/15" : "bg-sky-100")}>
                <motion.div initial={false} animate={{ width: i <= current ? "100%" : "0%" }} transition={{ duration: 0.35 }} className="h-full rounded-full bg-gradient-to-r from-nb-blue to-nb-turq" />
              </div>
            )}
            <motion.span initial={false} animate={{ scale: on ? 1.12 : 1 }} className={cx("relative z-10 grid place-items-center h-7 w-7 rounded-full text-[11px] font-bold transition-colors duration-300", done ? "bg-nb-turq text-white" : on ? "bg-nb-blue text-white ring-4 ring-nb-blue/20" : dark ? "bg-nb-tide2 text-white/60 ring-1 ring-white/20" : "bg-white text-nb-mute ring-1 ring-sky-200")}>
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
            </motion.span>
            <span className={cx("mt-1.5 text-[10.5px] font-medium text-center leading-tight px-1", on ? (dark ? "text-white" : "text-nb-ink") : dark ? "text-white/50" : "text-nb-mute")}>{s}</span>
          </div>
        );
      })}
    </div>
  );
}

export const ProgressRail = ({ value, className = "", dark }) => (
  <div className={cx("h-2 rounded-full overflow-hidden", dark ? "bg-white/10" : "bg-sky-100", className)}>
    <motion.div initial={{ width: 0 }} animate={{ width: `${Math.round(value * 100)}%` }} transition={{ duration: 0.7, ease: [0.2, 0.7, 0.2, 1] }} className="h-full rounded-full nb-gradient" />
  </div>
);

export const Reveal = ({ i = 0, children, className = "" }) => (
  <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, delay: i * 0.05, ease: [0.2, 0.7, 0.2, 1] }} className={className}>
    {children}
  </motion.div>
);

export const IconTile = ({ icon: Icon, label, sub, tint = "tint-ice", onClick, testid, disabled, iconClass = "text-nb-blue" }) => (
  <button data-testid={testid} onClick={onClick} className={cx("group w-full text-left rounded-3xl p-4 transition-transform duration-200 active:scale-[0.97] hover:-translate-y-0.5", tint, disabled && "opacity-70")}>
    <span className={cx("grid place-items-center h-11 w-11 rounded-2xl bg-white/80 mb-3 shadow-sm", iconClass)}><Icon className="h-5 w-5" /></span>
    <p className="text-sm font-semibold text-nb-ink leading-tight">{label}</p>
    {sub && <p className="text-[11.5px] text-nb-mute mt-0.5 leading-snug">{sub}</p>}
  </button>
);

export const RoundAction = ({ icon: Icon, label, onClick, testid, dark }) => (
  <button data-testid={testid} onClick={onClick} className="flex flex-col items-center gap-1.5 group">
    <span className={cx("grid place-items-center h-14 w-14 rounded-full shadow-[0_8px_20px_-10px_rgba(11,46,138,.5)] transition-transform duration-200 group-active:scale-90 group-hover:-translate-y-0.5", dark ? "bg-white/10 text-white" : "bg-white text-nb-blue ring-1 ring-sky-100")}><Icon className="h-5 w-5" /></span>
    <span className={cx("text-[11.5px] font-medium", dark ? "text-white/80" : "text-nb-ink")}>{label}</span>
  </button>
);

export const PageHeader = ({ eyebrow, title, sub, right, back, dark }) => (
  <div className="flex items-start justify-between gap-3 mb-5">
    <div className="flex items-start gap-3 min-w-0">
      {back}
      <div className="min-w-0">
        {eyebrow && <p className="nb-eyebrow mb-1">{eyebrow}</p>}
        <h1 className={cx("text-[28px] sm:text-4xl font-semibold tracking-tight leading-[1.1]", dark ? "text-white" : "text-nb-ink")}>{title}</h1>
        {sub && <p className={cx("text-sm mt-1.5", dark ? "text-white/60" : "text-nb-mute")}>{sub}</p>}
      </div>
    </div>
    {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
  </div>
);

export const Field = ({ label, hint, children }) => (
  <label className="block mb-4">
    <span className="nb-label">{label}</span>
    {children}
    {hint && <span className="block text-xs text-nb-mute mt-1.5">{hint}</span>}
  </label>
);

export const Notice = ({ children, icon: Icon = Lock, tone = "off", testid, className = "" }) => (
  <div data-testid={testid} className={cx("flex gap-2.5 items-start rounded-2xl px-3.5 py-3 text-[13px] leading-snug", tone === "off" ? "bg-slate-100 text-nb-mute" : "tint-ice text-nb-navy", className)}>
    <Icon className="h-4 w-4 mt-0.5 shrink-0" />
    <div>{children}</div>
  </div>
);

export const Row = ({ label, value, strong, className = "" }) => (
  <div className={cx("flex items-center justify-between py-2 text-sm", className)}>
    <span className="text-nb-mute">{label}</span>
    <span className={cx("nb-num", strong ? "font-semibold text-nb-ink" : "text-nb-ink")}>{value}</span>
  </div>
);
