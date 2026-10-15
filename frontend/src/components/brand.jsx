import { Link } from "react-router-dom";

// Approved brand assets (uploaded by Nabitouch) — never redraw.
export function Logo({ variant = "lockup", className = "" }) {
  if (variant === "full") return <img src="/brand/logo-full.png" alt="Nabitouch Mobile Massage Services — Relax, Recover, Anywhere" className={`object-contain ${className}`} />;
  if (variant === "emblem") return <img src="/brand/emblem.png" alt="Nabitouch" className={`object-contain ${className}`} />;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img src="/brand/emblem.png" alt="" className="h-9 w-auto shrink-0 object-contain" />
      <img src="/brand/wordmark.png" alt="Nabitouch" className="h-[18px] w-auto shrink-0 object-contain" />
    </span>
  );
}

export const LogoLink = ({ to = "/", testid = "brand-logo-link" }) => (
  <Link to={to} data-testid={testid} aria-label="Nabitouch home" className="shrink-0"><Logo /></Link>
);

export const Emblem = ({ className = "h-8" }) => <img src="/brand/emblem.png" alt="Nabitouch" className={`${className} w-auto object-contain`} />;

export const Lockup = ({ to = "/", className = "", light = false, testid = "brand-lockup" }) => (
  <Link to={to} data-testid={testid} aria-label="Nabitouch home" className={`flex shrink-0 items-center gap-2 ${className}`}>
    <img src="/brand/emblem.png" alt="Nabitouch" className="h-9 w-auto sm:h-8" />
    <img src="/brand/wordmark.png" alt="" className={`hidden h-[18px] w-auto sm:block ${light ? "brightness-0 invert" : ""}`} />
  </Link>
);

export const Attribution = ({ className = "" }) => (
  <p data-testid="dg-attribution" className={`text-[11px] tracking-wide text-nb-mute/80 ${className}`}>
    Designed &amp; Developed by <span className="font-semibold text-nb-navy">DG Solutions</span>
  </p>
);

const Leaf = ({ className, style, id }) => (
  <svg viewBox="0 0 40 40" className={className} style={style} aria-hidden="true">
    <defs>
      <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stopColor="#0E9E9A" /><stop offset="1" stopColor="#A8E063" />
      </linearGradient>
    </defs>
    <path d="M4 36C4 16 16 4 36 4C36 24 24 36 4 36Z" fill={`url(#${id})`} />
    <path d="M6 34C14 24 22 16 32 8" stroke="white" strokeOpacity=".55" strokeWidth="1.2" fill="none" />
  </svg>
);

// Ambient living gradient + floating botanical shapes. Transform/opacity only.
export function Breathing({ leaves = true, className = "" }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <div className="nb-breathe absolute -top-24 -left-24 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,#12C9EF55,transparent_65%)]" />
      <div className="nb-breathe absolute top-10 right-[-120px] h-[460px] w-[460px] rounded-full bg-[radial-gradient(circle,#14D8C450,transparent_65%)]" style={{ animationDelay: "-3s" }} />
      <div className="nb-breathe absolute bottom-[-160px] left-1/3 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,#1565F030,transparent_65%)]" style={{ animationDelay: "-6s" }} />
      {leaves && (
        <>
          <Leaf id="lf1" className="nb-drift absolute top-[14%] right-[8%] h-12 w-12 opacity-60" />
          <Leaf id="lf2" className="nb-drift absolute bottom-[18%] left-[6%] h-8 w-8 opacity-40" style={{ animationDelay: "-4s" }} />
          <Leaf id="lf3" className="nb-drift absolute top-[55%] right-[40%] h-6 w-6 opacity-30 hidden md:block" style={{ animationDelay: "-7s" }} />
        </>
      )}
    </div>
  );
}
