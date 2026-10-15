import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, Link, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CalendarDays, CalendarPlus, ClipboardList, Clock, HandHeart, Home, LayoutDashboard, LayoutGrid, Menu, MessageSquare, MoreHorizontal, ReceiptText, Route as RouteIcon, Sun, Tag, Truck, UserRound, Users, LogIn, LogOut, RotateCcw, ShieldCheck, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Attribution, Lockup, Logo } from "@/components/brand";
import { WhatsAppFab } from "@/components/ContactCards";
import { Avatar } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { homeFor, spacesOf, WORKSPACES, workspaceForPath } from "@/lib/workspaces";
import { BOTTOM_NAV, PUBLIC_NAV, showsMarketingFooter } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { registerPush } from "@/lib/nativeShell";

const ICONS = {
  Home,
  Services: HandHeart,
  Practitioners: Users,
  Contact: MessageSquare,
  Offers: Tag,
  Book: CalendarPlus,
  "My Nabitouch": UserRound,
};

const OWNER_MORE = [
  ["/owner/dispatch", "Live Fleet"],
  ["/owner/messages", "Visit messages"],
  ["/owner/campaigns", "Flash campaigns"],
  ["/owner/promos", "Promotions & rewards"],
  ["/owner/giftcards", "Gift cards"],
  ["/owner/plans", "Wellness plans"],
  ["/owner/safety", "Safety alerts"],
  ["/owner/reports", "Financial reports"],
  ["/owner/zones", "Zones & settings"],
  ["/owner/credentials", "Credentials"],
  ["/owner/availability", "Availability"],
  ["/owner/routes", "Routes"],
  ["/owner/recovery", "Recovery"],
  ["/owner/permissions", "Reception access"],
  ["/owner/insights", "Insights"],
  ["/owner/legacy", "Legacy clients"],
  ["/owner/training", "Training Center"],
];

const STAFF = {
  pro: {
    title: "Practitioner",
    nav: [
      { to: "/pro", label: "Today", icon: Sun, end: true },
      { to: "/pro/route", label: "Route", icon: RouteIcon },
      { to: "/pro/availability", label: "Hours", icon: Clock },
      { to: "/pro/profile", label: "Me", icon: UserRound },
    ],
    more: [
      { to: "/pro/plans", label: "Plans", icon: ClipboardList },
      { to: "/pro/earnings", label: "Earnings", icon: ReceiptText },
      { to: "/pro/recovery", label: "Recovery", icon: RotateCcw },
    ],
  },
  owner: {
    title: "Owner",
    nav: [
      { to: "/owner", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/owner/schedule", label: "Schedule", icon: CalendarDays },
      { to: "/owner/manage", label: "Manage", icon: LayoutGrid },
      { to: "/owner/payments", label: "Invoices", icon: ReceiptText },
    ],
    more: [],
  },
  desk: {
    title: "Reception",
    nav: [
      { to: "/desk", label: "Schedule", icon: CalendarDays, end: true },
      { to: "/desk/dispatch", label: "Dispatch", icon: Truck },
      { to: "/desk/clients", label: "Clients", icon: Users },
    ],
    more: [
      { to: "/desk/verify", label: "Payments", icon: ShieldCheck },
      { to: "/desk/messages", label: "Messages", icon: MessageSquare },
      { to: "/desk/safety", label: "Safety", icon: ShieldCheck },
    ],
  },
};
const NEED = { pro: "practitioner", owner: "owner", desk: "desk" };

function Page({ children }) {
  const { pathname } = useLocation();
  return <div key={pathname} className="nb-page">{children}</div>;
}

export function FloatingNav({ items, more = [], testid = "bottom-nav" }) {
  const { pathname } = useLocation();
  const moreActive = more.some((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
  return (
    <nav data-testid={testid} className="safe-bottom fixed inset-x-3 bottom-3 z-50 lg:hidden" aria-label="Bottom">
      <div className="mx-auto flex max-w-md items-center justify-between gap-1 rounded-full p-1.5 shadow-[0_18px_40px_-16px_rgba(11,27,63,.45)] nb-glass">
        {items.map((it) => {
          const Icon = it.icon || ICONS[it.label];
          return (
            <NavLink key={it.to} to={it.to} end={it.end} data-testid={`${testid}-${it.label.toLowerCase().replace(/\s/g, "-")}`} aria-label={it.label} title={it.label} className="relative min-w-0 flex-1">
              {({ isActive }) => (
                <span className={cn("relative flex h-12 items-center justify-center gap-1.5 rounded-full transition-colors duration-200", isActive ? "text-white" : it.primary ? "text-nb-blue" : "text-nb-mute")}>
                  {isActive && <motion.span layoutId={`${testid}-active`} transition={{ type: "spring", stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-full bg-nb-ink" />}
                  {!isActive && it.primary && <span className="absolute inset-1 rounded-full tint-lagoon" />}
                  {Icon && <Icon className="relative h-5 w-5 shrink-0" strokeWidth={isActive ? 2.3 : 1.9} />}
                </span>
              )}
            </NavLink>
          );
        })}
        {more.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger data-testid={`${testid}-more`} aria-label="More" className={cn("relative flex h-12 min-w-0 flex-1 items-center justify-center rounded-full", moreActive ? "text-white" : "text-nb-mute")}>
              {moreActive && <span className="absolute inset-0 rounded-full bg-nb-ink" />}
              <MoreHorizontal className="relative h-5 w-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-2xl">
              {more.map((item) => (
                <DropdownMenuItem key={item.to} asChild className="rounded-xl">
                  <Link to={item.to} data-testid={`${testid}-more-${item.label.toLowerCase()}`}>{item.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </nav>
  );
}

function PublicFooter() {
  return (
    <footer className="hidden border-t border-sky-100 bg-white md:block">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 md:flex-row md:items-end md:justify-between">
        <Logo variant="full" className="h-28 w-auto max-w-full shrink-0 self-start object-contain" />
        <div className="max-w-md space-y-2 text-xs text-nb-mute md:text-right">
          <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium text-nb-navy md:justify-end" aria-label="Footer">
            {PUBLIC_NAV.filter((item) => item.to !== "/me").map((item) => <Link key={item.to} to={item.to}>{item.label}</Link>)}
            <Link to="/book">Book</Link>
          </nav>
          <p>Massage therapy may support relaxation and comfort; individual results vary and are not guaranteed. Insurance coverage depends on your plan and practitioner eligibility.</p>
          <p>Mobile massage in Edmonton. The price you confirm is the price Nabitouch stores for the visit.</p>
          <Attribution className="md:text-right" />
        </div>
      </div>
    </footer>
  );
}

export function AccountMenu() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { user, logout } = useDemo();
  const spaces = spacesOf(user);
  const current = workspaceForPath(pathname);
  const signOut = async () => { await logout(); nav("/"); };
  if (!user) return <Link to="/login" data-testid="account-sign-in" aria-label="Sign in" className="nb-btn-ghost h-10 w-10 px-0 text-sm lg:w-auto lg:px-4"><LogIn className="h-4 w-4 lg:hidden" /><span className="hidden lg:inline">Sign in</span></Link>;
  return (
    <div className="flex items-center gap-2">
      {spaces.length > 1 && (
        <select aria-label="Workspace" data-testid="workspace-switch" className="nb-input h-10 w-[7.5rem] text-sm sm:w-auto" value={spaces.includes(current) ? current : spaces[0]} onChange={(e) => nav(WORKSPACES[e.target.value].to)}>
          {spaces.map((role) => <option key={role} value={role}>{WORKSPACES[role].label}</option>)}
        </select>
      )}
      <button type="button" onClick={signOut} data-testid="account-sign-out" aria-label="Sign out" className="nb-btn-ghost h-10 shrink-0 px-3 text-sm"><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span></button>
    </div>
  );
}

export function ClientShell() {
  const { me, idx } = useDemo();
  const wa = idx?.settings?.whatsapp || {};
  const waPages = wa.pages || ["/contact"];
  const { pathname } = useLocation();
  const showWa = waPages.some((p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)));
  const [menuOpen, setMenuOpen] = useState(false);
  const headerLinks = PUBLIC_NAV.filter((item) => item.to !== "/me");
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <header className="sticky top-0 z-40 border-x-0 border-t-0 nb-glass">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-5">
          <Lockup />
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {headerLinks.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} data-testid={`client-nav-${n.label.toLowerCase().replace(/\s/g, "-")}`} className={({ isActive }) => cn("grid h-9 place-items-center rounded-full px-3.5 text-sm font-medium transition-colors", isActive ? "bg-nb-ink text-white" : "text-nb-mute hover:text-nb-ink")}>{n.label}</NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {me && <Link to="/me" data-testid="client-header-greeting" className="hidden text-sm text-nb-mute lg:inline">Hi, {me.preferredName || me.firstName}</Link>}
            <button type="button" data-testid="public-nav-toggle" aria-expanded={menuOpen} aria-controls="public-menu" aria-label={menuOpen ? "Close menu" : "Open menu"} className="nb-btn-ghost h-10 w-10 px-0 lg:hidden" onClick={() => setMenuOpen((open) => !open)}>
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <AccountMenu />
            <Link to="/book" data-testid="header-book-btn" className="nb-btn-primary h-10 px-5 text-sm">Book</Link>
          </div>
        </div>
        {menuOpen && (
          <nav id="public-menu" data-testid="public-nav-menu" aria-label="Main" className="absolute inset-x-0 top-full border-t border-sky-100 bg-white/95 px-5 py-3 shadow-[0_18px_40px_-24px_rgba(11,27,63,.45)] backdrop-blur lg:hidden">
            <div className="mx-auto grid max-w-6xl gap-1">
              {headerLinks.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} data-testid={`client-menu-${n.label.toLowerCase().replace(/\s/g, "-")}`} className={({ isActive }) => cn("flex h-11 items-center rounded-2xl px-3 text-sm font-medium", isActive ? "bg-nb-ink text-white" : "text-nb-ink hover:bg-sky-50")}>{n.label}</NavLink>
              ))}
            </div>
          </nav>
        )}
      </header>
      <main className="flex-1 pb-28 lg:pb-10"><Page><Outlet /></Page>{showsMarketingFooter(pathname) && <PublicFooter />}</main>
      {showWa && <WhatsAppFab phone={wa.phone || "+17802356508"} />}
      <FloatingNav items={BOTTOM_NAV} testid="client-bottom" />
    </div>
  );
}

export function StaffShell({ role }) {
  const { user } = useDemo();
  const loc = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (!spacesOf(user).includes(NEED[role])) return <Navigate to={homeFor(user)} replace />;
  return <StaffShellInner role={role} />;
}

function StaffShellInner({ role }) {
  const cfg = STAFF[role];
  const { idx, practitionerId, user } = useDemo();
  const me = role === "pro" ? idx.practitioners[practitionerId] : null;
  const name = me?.name || user?.name || cfg.title;
  useEffect(() => { registerPush().catch(() => {}); }, []);
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sky-100 bg-white px-4 py-6 lg:flex">
        <Lockup to={cfg.nav[0].to} testid={`${role}-logo-link`} className="px-2" />
        <p className="nb-eyebrow mb-3 mt-8 px-2">{cfg.title} workspace</p>
        <nav className="space-y-1" aria-label={`${cfg.title} navigation`}>
          {cfg.nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} data-testid={`${role}-side-${n.label.toLowerCase()}`} className={({ isActive }) => cn("flex h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium transition-colors", isActive ? "bg-nb-ink text-white" : "text-nb-mute hover:bg-sky-50 hover:text-nb-ink")}><n.icon className="h-[18px] w-[18px]" />{n.label}</NavLink>
          ))}
          {cfg.more.map((n) => (
            <NavLink key={n.to} to={n.to} data-testid={`${role}-side-${n.label.toLowerCase()}`} className={({ isActive }) => cn("flex h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium transition-colors", isActive ? "bg-nb-ink text-white" : "text-nb-mute hover:bg-sky-50 hover:text-nb-ink")}><n.icon className="h-[18px] w-[18px]" />{n.label}</NavLink>
          ))}
        </nav>
        {role === "owner" && (
          <div className="no-scrollbar mt-6 min-h-0 flex-1 overflow-y-auto">
            <p className="nb-eyebrow mb-2 px-3">Inside Manage</p>
            {OWNER_MORE.map(([to, label]) => (
              <NavLink key={to} to={to} data-testid={`owner-more-${label.split(" ")[0].toLowerCase()}`} className={({ isActive }) => cn("block rounded-xl px-3 py-1.5 text-[13px] transition-colors", isActive ? "bg-sky-50 font-semibold text-nb-blue" : "text-nb-mute hover:text-nb-ink")}>{label}</NavLink>
            ))}
          </div>
        )}
        <div className="mt-auto border-t border-sky-100 pt-4">
          <div className="flex items-center gap-3 px-2">
            <Avatar person={me || { name, initials: name.slice(0, 1), color: "#1565F0" }} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="text-xs text-nb-mute">{me?.isOwner ? "Owner · practitioner" : cfg.title}</p>
            </div>
          </div>
          <div className="mt-3 px-1"><AccountMenu /></div>
          <Attribution className="mt-4 px-2" />
        </div>
      </aside>
      <div className="min-w-0 lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-sky-100 bg-white/90 px-4 backdrop-blur lg:hidden">
          <Lockup to={cfg.nav[0].to} testid={`${role}-mobile-logo-link`} />
          <AccountMenu />
        </header>
        <main className="px-4 py-6 pb-28 sm:px-6 lg:px-10 lg:pb-10"><Page><Outlet /></Page></main>
      </div>
      <FloatingNav items={cfg.nav} more={cfg.more} testid={`${role}-bottom`} />
    </div>
  );
}
