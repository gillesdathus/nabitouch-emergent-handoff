import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Home, HandHeart, CalendarPlus, Tag, UserRound, LayoutDashboard, CalendarDays, LayoutGrid, ReceiptText, Sun, Route as RouteIcon, Clock, CircleUser, Truck, Users, MoreHorizontal, Eye, ChevronDown, Bell, Settings, FlaskConical } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Lockup, Attribution } from "@/components/brand";
import { cx, Avatar } from "@/components/ui-kit";
import { usePreview } from "@/store/PreviewStore";

export const NAV = {
  public: [
    { to: "/", label: "Home", icon: Home, end: true },
    { to: "/services", label: "Services", icon: HandHeart },
    { to: "/book", label: "Book", icon: CalendarPlus, hero: true },
    { to: "/offers", label: "Offers", icon: Tag },
    { to: "/me", label: "My Nabitouch", short: "Me", icon: UserRound },
  ],
  owner: [
    { to: "/owner", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/owner/schedule", label: "Schedule", icon: CalendarDays },
    { to: "/owner/manage", label: "Manage", icon: LayoutGrid },
    { to: "/owner/payments", label: "Invoices", icon: ReceiptText },
  ],
  pro: [
    { to: "/pro", label: "Today", icon: Sun, end: true },
    { to: "/pro/route", label: "Route", icon: RouteIcon },
    { to: "/pro/availability", label: "Hours", icon: Clock },
    { to: "/pro/me", label: "Me", icon: CircleUser },
  ],
  desk: [
    { to: "/desk", label: "Schedule", icon: CalendarDays, end: true },
    { to: "/desk/dispatch", label: "Dispatch", icon: Truck },
    { to: "/desk/clients", label: "Clients", icon: Users },
    { to: "/desk/more", label: "More", icon: MoreHorizontal },
  ],
};

const OWNER_MORE = [
  ["/owner/dispatch", "Live Fleet"], ["/owner/campaigns", "Flash campaigns"], ["/owner/promos", "Promotions & rewards"], ["/owner/zones", "Zones & settings"],
  ["/owner/credentials", "Credentials"], ["/owner/availability", "Availability"], ["/owner/recovery", "Recovery"], ["/owner/permissions", "Reception access"], ["/owner/insights", "Insights"], ["/owner/training", "Training Center"],
];

const ROLES = [
  { key: "guest", label: "Guest visitor", path: "/" },
  { key: "client", label: "Client", path: "/me" },
  { key: "owner", label: "Owner / manager", path: "/owner" },
  { key: "pro", label: "Practitioner", path: "/pro" },
  { key: "desk", label: "Reception", path: "/desk" },
  { key: "training", label: "Training workspace", path: "/train" },
];

export function PreviewBar() {
  const { role, setRole } = usePreview();
  const nav = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    const seg = pathname.split("/")[1];
    const r = { owner: "owner", pro: "pro", desk: "desk", train: "training" }[seg];
    if (r && r !== role) setRole(r);
  }, [pathname, role, setRole]);
  const cur = ROLES.find((r) => r.key === role) || ROLES[0];
  return (
    <div className="fixed top-0 inset-x-0 z-[70] flex justify-center pointer-events-none pt-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button data-testid="role-switcher" className="pointer-events-auto inline-flex items-center gap-1.5 h-7 pl-2.5 pr-2 rounded-full bg-nb-ink/90 text-white text-[11px] font-medium shadow-lg backdrop-blur hover:bg-nb-ink transition-colors">
            <Eye className="h-3.5 w-3.5 text-nb-turq" />
            <span className="uppercase tracking-wider text-[9.5px] font-bold text-nb-turq">Design preview</span>
            <span className="opacity-60">·</span>{cur.label}<ChevronDown className="h-3 w-3 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-60 rounded-2xl">
          <DropdownMenuLabel className="text-[11px] text-nb-mute font-normal leading-snug">Preview tool — not part of the product. All data is fictional mock data.</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {ROLES.map((r) => (
            <DropdownMenuItem key={r.key} data-testid={`role-option-${r.key}`} onSelect={() => { setRole(r.key); nav(r.path); }} className={cx("rounded-xl", r.key === role && "bg-sky-50 font-semibold")}>{r.label}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function FloatingNav({ items, testid = "bottom-nav" }) {
  return (
    <nav data-testid={testid} className="lg:hidden fixed bottom-3 inset-x-3 z-50 safe-bottom">
      <div className="mx-auto max-w-md flex items-center justify-between gap-1 rounded-full nb-glass p-1.5 shadow-[0_18px_40px_-16px_rgba(11,27,63,.45)]">
        {items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end} data-testid={`nav-${it.label.toLowerCase().replace(/\s/g, "-")}`} aria-label={it.label} title={it.label} className="relative flex-1 min-w-0">
            {({ isActive }) => (
              <span className={cx("relative flex items-center justify-center gap-1.5 h-12 rounded-full transition-colors duration-200", isActive ? "text-white" : it.hero ? "text-nb-blue" : "text-nb-mute")}>
                {isActive && <motion.span layoutId={`${testid}-active`} transition={{ type: "spring", stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-full bg-nb-ink" />}
                {!isActive && it.hero && <span className="absolute inset-1 rounded-full tint-lagoon" />}
                <it.icon className="relative h-5 w-5 shrink-0" strokeWidth={isActive ? 2.3 : 1.9} />
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function Sidebar({ role, items }) {
  const { pro, me } = usePreview();
  const who = role === "pro" ? pro(me.pro).name : role === "desk" ? "Maya · Reception" : "Alex · Owner";
  return (
    <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col bg-white border-r border-sky-100 pt-12 pb-5 px-4 z-40">
      <Lockup to={items[0].to} className="px-2 mb-8" />
      <nav className="space-y-1">
        {items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end} data-testid={`side-${it.label.toLowerCase()}`} className={({ isActive }) => cx("flex items-center gap-3 h-11 px-3 rounded-2xl text-sm font-medium transition-colors", isActive ? "bg-nb-ink text-white" : "text-nb-mute hover:bg-sky-50 hover:text-nb-ink")}>
            <it.icon className="h-[18px] w-[18px]" />{it.label}
          </NavLink>
        ))}
      </nav>
      {role === "owner" && (
        <div className="mt-6 overflow-y-auto no-scrollbar">
          <p className="nb-eyebrow px-3 mb-2">Inside Manage</p>
          {OWNER_MORE.map(([to, l]) => (
            <NavLink key={to} to={to} className={({ isActive }) => cx("block px-3 py-1.5 rounded-xl text-[13px] transition-colors", isActive ? "text-nb-blue font-semibold bg-sky-50" : "text-nb-mute hover:text-nb-ink")}>{l}</NavLink>
          ))}
        </div>
      )}
      <div className="mt-auto pt-4 border-t border-sky-100">
        <div className="flex items-center gap-3 px-2">
          <Avatar name={who} src={role === "pro" ? pro(me.pro).photo : undefined} size={36} />
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{who}</p><Link to={`/${role}/settings`} className="text-xs text-nb-blue">Settings</Link></div>
        </div>
        <Attribution className="px-2 mt-4" />
      </div>
    </aside>
  );
}

export const TopIcons = ({ base, dark }) => (
  <div className="flex items-center gap-2">
    <Link to={`${base}/notifications`} data-testid="notifications-btn" className={cx("relative grid place-items-center h-11 w-11 rounded-full transition-colors", dark ? "bg-white/10 text-white" : "bg-white ring-1 ring-sky-100 text-nb-ink hover:bg-sky-50")}>
      <Bell className="h-[18px] w-[18px]" /><span className="absolute top-2.5 right-3 h-2 w-2 rounded-full bg-nb-coral ring-2 ring-white" />
    </Link>
    <Link to={`${base}/settings`} data-testid="settings-btn" className={cx("grid place-items-center h-11 w-11 rounded-full transition-colors lg:hidden", dark ? "bg-white/10 text-white" : "bg-white ring-1 ring-sky-100 text-nb-ink hover:bg-sky-50")}>
      <Settings className="h-[18px] w-[18px]" />
    </Link>
  </div>
);

export function StaffShell({ role }) {
  const loc = useLocation();
  const items = NAV[role];
  return (
    <div className="min-h-screen">
      <Sidebar role={role} items={items} />
      <main key={loc.pathname} className="nb-page lg:pl-64 pb-28 lg:pb-10">
        <Outlet />
      </main>
      <FloatingNav items={items} />
    </div>
  );
}

export function TrainingBanner() {
  return (
    <div data-testid="training-banner" className="sticky top-0 z-[65] bg-amber-400 text-amber-950 text-center text-[12px] font-bold tracking-wide pt-9 pb-2 px-3 flex items-center justify-center gap-2">
      <FlaskConical className="h-4 w-4" />TRAINING MODE — No real bookings or payments
    </div>
  );
}

export function PublicShell() {
  const loc = useLocation();
  const { role } = usePreview();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 nb-glass border-x-0 border-t-0 pt-9 lg:pt-10">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
          <Lockup />
          <nav className="hidden md:flex items-center gap-1">
            {[["/", "Home"], ["/services", "Services"], ["/practitioners", "Practitioners"], ["/offers", "Offers"], ["/contact", "Contact"]].map(([to, l]) => (
              <NavLink key={to} to={to} end className={({ isActive }) => cx("px-3.5 h-9 grid place-items-center rounded-full text-sm font-medium transition-colors", isActive ? "bg-nb-ink text-white" : "text-nb-mute hover:text-nb-ink")}>{l}</NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link to={role === "client" ? "/me" : "/login"} data-testid="header-account-link" className="hidden sm:inline-flex nb-btn-ghost h-10">{role === "client" ? "My Nabitouch" : "Sign in"}</Link>
            <Link to="/book" data-testid="header-book-btn" className="nb-btn-primary h-10 px-5 text-sm">Book</Link>
          </div>
        </div>
      </header>
      <main key={loc.pathname} className="nb-page flex-1 pb-28 md:pb-0">
        <Outlet />
      </main>
      <footer className="hidden md:block border-t border-sky-100 bg-white">
        <div className="max-w-6xl mx-auto px-5 py-10 flex items-end justify-between gap-6">
          <img src="/brand/logo-full.png" alt="Nabitouch Mobile Massage Services — Relax, Recover, Anywhere" className="h-28 w-auto" />
          <div className="text-right space-y-1"><p className="text-xs text-nb-mute">Mobile massage across Edmonton · Times shown in Edmonton local time</p><Attribution /></div>
        </div>
      </footer>
      <FloatingNav items={NAV.public} testid="public-nav" />
    </div>
  );
}
