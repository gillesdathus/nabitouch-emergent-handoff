import { Link } from "react-router-dom";

export const Emblem = ({ className = "h-8" }) => <img src="/brand/emblem.png" alt="Nabitouch" className={`${className} w-auto object-contain`} />;

export const Lockup = ({ to = "/", className = "", light = false }) => (
  <Link to={to} data-testid="brand-lockup" className={`flex items-center gap-2 ${className}`}>
    <img src="/brand/emblem.png" alt="" className="h-8 w-auto" />
    <img src="/brand/wordmark.png" alt="Nabitouch" className={`h-[18px] w-auto ${light ? "brightness-0 invert" : ""}`} />
  </Link>
);

export const Attribution = ({ className = "" }) => (
  <p data-testid="dg-attribution" className={`text-[11px] tracking-wide text-nb-mute/80 ${className}`}>
    Designed &amp; Developed by <span className="font-semibold text-nb-navy">DG Solutions</span>
  </p>
);
