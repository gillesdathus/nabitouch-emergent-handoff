import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, Link, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CalendarDays, CalendarPlus, ClipboardList, Clock, HandHeart, Headphones, Home, LayoutDashboard, LayoutGrid, Menu, MessageSquare, MoreHorizontal, ReceiptText, Route as RouteIcon, Shield, Sun, Tag, Truck, UserRound, Users, LogIn, LogOut, RotateCcw, ShieldCheck, Star, X } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Attribution, Lockup, Logo } from "@/components/brand";
import { WhatsAppFab } from "@/components/ContactCards";
import { Avatar } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { homeFor, spacesOf, WORKSPACES, workspaceForPath } from "@/lib/workspaces";
import { BOTTOM_NAV, PUBLIC_NAV, showsFocusedBookingChrome, showsMarketingFooter } from "@/lib/navigation";
import { UNREAD_REFRESH_EVENT, visibleStaffUnreadFromInbox, visibleUnreadFromInbox } from "@/lib/team-connect";
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

/** Grouped More destinations — Clients/Practitioners/Availability/Routes live under Manage/Schedule. */
const OWNER_MORE_GROUPS = [
  {
    title: "Security Shield",
    items: [
      { to: "/owner/shield", label: "Overview", end: true },
      { to: "/owner/fleet", label: "Fleet" },
      { to: "/owner/shield/drivers", label: "Driver credentials" },
      { to: "/owner/shield/renewals", label: "Renewals" },
      { to: "/owner/shield/visits", label: "Active visits" },
      { to: "/owner/safety", label: "Safety alerts" },
    ],
  },
  {
    title: "Marketing & growth",
    items: [
      { to: "/owner/promos", label: "Promotions & rewards" },
      { to: "/owner/campaigns", label: "Flash campaigns" },
      { to: "/owner/giftcards", label: "Gift cards" },
      { to: "/owner/plans", label: "Wellness plans" },
      { to: "/owner/winback", label: "Welcome-back invites" },
      { to: "/owner/channels", label: "Email & texts" },
    ],
  },
  {
    title: "Client experience",
    items: [
      { to: "/owner/team", label: "Team Connect" },
      { to: "/owner/messages", label: "Visit messages" },
      { to: "/owner/feedback", label: "Client feedback" },
      { to: "/owner/turnaround", label: "Session turnaround" },
    ],
  },
  {
    title: "Business insights",
    items: [
      { to: "/owner/insights", label: "Insights" },
      { to: "/owner/reports", label: "Financial reports" },
    ],
  },
  {
    title: "Business settings",
    items: [
      { to: "/owner/zones", label: "Zones & settings" },
      { to: "/owner/permissions", label: "Reception access" },
      { to: "/owner/patients/invitations", label: "Patients · Invitations" },
      { to: "/owner/legacy", label: "Legacy clients" },
      { to: "/owner/clients/duplicates", label: "Potential duplicates" },
    ],
  },
  {
    title: "Training & support",
    items: [
      { to: "/owner/training", label: "Training Center" },
      { to: "/owner/recovery", label: "Recovery" },
    ],
  },
];

const OWNER_MORE = OWNER_MORE_GROUPS.flatMap((group) => group.items);

const STAFF = {
  pro: {
    title: "Practitioner",
    nav: [
      { to: "/pro", label: "Today", icon: Sun, end: true },
      { to: "/pro/route", label: "My Route", icon: RouteIcon },
      { to: "/pro/messages", label: "Messages", icon: MessageSquare },
      { to: "/pro/availability", label: "Schedule", icon: Clock },
      { to: "/pro/profile", label: "Me", icon: UserRound },
    ],
    more: [
      { to: "/pro/team", label: "Team Connect", icon: Headphones, group: "Team" },
      { to: "/pro/vehicle", label: "My vehicle", icon: Truck, group: "Security" },
      { to: "/pro/shield", label: "Driver's licence", icon: ShieldCheck, group: "Security" },
      { to: "/pro/plans", label: "Plans", icon: ClipboardList },
      { to: "/pro/earnings", label: "Earnings", icon: ReceiptText },
      { to: "/pro/ratings", label: "Client ratings", icon: Star },
      { to: "/pro/recovery", label: "Recovery", icon: RotateCcw },
    ],
  },
  owner: {
    title: "Owner",
    nav: [
      { to: "/owner", label: "Dashboard", short: "Home", icon: LayoutDashboard, end: true },
      { to: "/owner/schedule", label: "Schedule", icon: CalendarDays },
      { to: "/owner/manage", label: "Manage", icon: LayoutGrid },
      { to: "/owner/payments", label: "Invoices", icon: ReceiptText },
      { to: "/owner/eclaims", label: "eClaims", short: "eClaims", icon: Shield },
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
      { to: "/desk/team", label: "Team Connect", icon: Headphones },
      { to: "/desk/verify", label: "Payments", icon: ShieldCheck },
      { to: "/desk/eclaims", label: "eClaims", icon: Shield },
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

const slug = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");

function DockItem({ icon: Icon, label, active, primary, badge }) {
  return (
    <span className={cn("relative flex h-full flex-col items-center justify-center gap-0.5 rounded-2xl px-0 transition-colors duration-200", active ? "text-nb-ink" : primary ? "text-nb-blue" : "text-nb-mute")}>
      {active && <motion.span layoutId="dock-active" transition={{ type: "spring", stiffness: 420, damping: 34 }} className="absolute inset-x-2 top-0 h-[3px] rounded-full bg-nb-ink" />}
      <span className="relative">
        {Icon && <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.3 : 1.9} aria-hidden="true" />}
        {badge > 0 && <span className="absolute -right-1.5 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-nb-coral px-1 text-[9px] font-bold text-white" data-testid="nav-unread-badge">{badge > 9 ? "9+" : badge}</span>}
      </span>
      <span className={cn("max-w-full truncate text-[10px] leading-tight tracking-tight min-[360px]:text-[10.5px]", active ? "font-semibold" : "font-medium")}>{label}</span>
    </span>
  );
}

function MoreLink({ item, testid, badges }) {
  return (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      data-testid={`${testid}-more-${slug(item.label)}`}
      className={({ isActive }) => cn(
        "flex min-h-11 items-center justify-between gap-2 rounded-2xl px-3 py-2 text-sm font-medium ring-1 ring-sky-100",
        isActive ? "bg-nb-ink text-white ring-nb-ink" : "bg-white text-nb-ink hover:bg-sky-50",
      )}
    >
      <span>{item.label}</span>
      {badges[item.to] > 0 && (
        <span className="rounded-full bg-nb-coral px-1.5 text-[10px] font-bold text-white" data-testid={`nav-unread-${slug(item.label)}`}>
          {badges[item.to] > 9 ? "9+" : badges[item.to]}
        </span>
      )}
    </NavLink>
  );
}

function MoreSheet({ more, groups, testid, active, badges = {} }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const badgeTotal = Object.values(badges).reduce((sum, n) => sum + (Number(n) || 0), 0);
  useEffect(() => { setOpen(false); }, [pathname]);
  const sections = groups?.length
    ? groups
    : [{ title: null, items: more }];
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger data-testid={`${testid}-more`} aria-label="More" className="min-w-0 flex-1">
        <DockItem icon={MoreHorizontal} label="More" active={active} badge={badgeTotal} />
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto rounded-t-[28px] pb-[calc(1.25rem+var(--nb-safe-b))]" data-testid={`${testid}-more-sheet`}>
        <SheetTitle className="mb-3 text-base">More</SheetTitle>
        <div className="space-y-4">
          {sections.map((section) => (
            <div key={section.title || "more"}>
              {section.title && <p className="nb-eyebrow mb-2 px-0.5">{section.title}</p>}
              <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                {section.items.map((item) => (
                  <MoreLink key={item.to} item={item} testid={testid} badges={badges} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function FloatingNav({ items, more = [], groups, testid = "bottom-nav", badges = {} }) {
  const { pathname } = useLocation();
  const flat = groups?.length ? groups.flatMap((g) => g.items) : more;
  const moreActive = flat.some((item) => {
    if (item.end) return pathname === item.to;
    return pathname === item.to || pathname.startsWith(`${item.to}/`);
  });
  return (
    <nav data-testid={testid} className="nb-dock fixed inset-x-0 bottom-0 z-50 border-t border-sky-100 bg-white/95 backdrop-blur-md lg:hidden" aria-label="Primary">
      <div className="mx-auto flex h-[var(--nb-nav-h)] max-w-xl items-stretch justify-between gap-0.5 px-1.5">
        {items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end} data-testid={`${testid}-${slug(it.label)}`} aria-label={it.label} className="min-w-0 flex-1">
            {({ isActive }) => <DockItem icon={it.icon || ICONS[it.label]} label={it.short || it.label} active={isActive} primary={it.primary} badge={badges[it.to]} />}
          </NavLink>
        ))}
        {flat.length > 0 && <MoreSheet more={more} groups={groups} testid={testid} active={moreActive} badges={badges} />}
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
          <p>Mobile massage at a confirmed address. The price you confirm is the price Nabitouch stores for the visit.</p>
          <Attribution className="md:text-right" />
        </div>
      </div>
    </footer>
  );
}

export function AccountMenu() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { user, logout, api, setUser } = useDemo();
  const spaces = spacesOf(user);
  const current = workspaceForPath(pathname);
  const signOut = async () => { await logout(); nav("/"); };
  const switchWorkspace = async (role) => {
    try {
      const next = await api.setWorkspace(role);
      if (setUser) setUser(next);
      else if (user) Object.assign(user, next);
    } catch { /* navigation still proceeds; preference is best-effort */ }
    nav(WORKSPACES[role].to);
  };
  if (!user) return <Link to="/login" data-testid="account-sign-in" aria-label="Sign in" className="nb-btn-ghost h-10 w-10 px-0 text-sm lg:w-auto lg:px-4"><LogIn className="h-4 w-4 lg:hidden" /><span className="hidden lg:inline">Sign in</span></Link>;
  return (
    <div className="flex items-center gap-2">
      {spaces.length > 1 && (
        <select aria-label="Workspace" data-testid="workspace-switch" className="nb-input h-10 w-[7.5rem] text-sm sm:w-auto" value={spaces.includes(current) ? current : spaces[0]} onChange={(e) => switchWorkspace(e.target.value)}>
          {spaces.map((role) => <option key={role} value={role}>{WORKSPACES[role].label}</option>)}
        </select>
      )}
      <Link to="/account/security" data-testid="account-security-link" className="nb-btn-ghost inline-flex h-10 px-3 text-sm" aria-label="Account and security"><ShieldCheck className="h-4 w-4" /><span className="hidden sm:inline">Security</span></Link>
      <button type="button" onClick={signOut} data-testid="account-sign-out" aria-label="Sign out" className="nb-btn-ghost h-10 shrink-0 px-3 text-sm"><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span></button>
    </div>
  );
}

export function ClientShell() {
  const { me, idx } = useDemo();
  const wa = idx?.settings?.whatsapp || {};
  const waPages = wa.pages || ["/contact"];
  const { pathname } = useLocation();
  const focusBooking = showsFocusedBookingChrome(pathname);
  const showWa = !focusBooking && waPages.some((p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)));
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
    <div
      className={cn("flex min-h-[100dvh] flex-col overflow-x-clip", focusBooking && "nb-booking-focus")}
      data-testid={focusBooking ? "client-shell-booking-focus" : "client-shell"}
    >
      {!focusBooking && (
        <header className="sticky top-0 z-40 border-x-0 border-t-0 pt-[var(--nb-safe-t)] nb-glass">
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
      )}
      <main className={cn("flex-1", focusBooking ? "nb-main-clear-booking" : "nb-main-clear")}>
        <Page><Outlet /></Page>
        {!focusBooking && showsMarketingFooter(pathname) && <PublicFooter />}
      </main>
      {showWa && <WhatsAppFab phone={wa.phone || "+17802356508"} />}
      {!focusBooking && <FloatingNav items={BOTTOM_NAV} testid="client-bottom" />}
    </div>
  );
}

export function StaffShell({ role }) {
  const { user } = useDemo();
  const loc = useLocation();
  // Gate already waits for user === undefined. null means signed out.
  if (user === undefined) return null;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (!spacesOf(user).includes(NEED[role])) return <Navigate to={homeFor(user)} replace />;
  return <StaffShellInner role={role} />;
}

function StaffShellInner({ role }) {
  const cfg = STAFF[role];
  const loc = useLocation();
  const { idx, practitionerId, user, api } = useDemo();
  const me = role === "pro" ? idx?.practitioners?.[practitionerId] || null : null;
  const name = me?.name || user?.name || cfg.title;
  const [unread, setUnread] = useState(0);
  const [teamUnread, setTeamUnread] = useState(0);
  const visitSeq = useRef(0);
  const teamSeq = useRef(0);
  useEffect(() => { registerPush().catch(() => {}); }, []);

  useEffect(() => {
    if (role !== "pro") return undefined;
    let stop = false;
    const load = () => {
      const seq = ++visitSeq.current;
      api.inbox()
        .then((body) => { if (!stop && seq === visitSeq.current) setUnread(visibleUnreadFromInbox(body)); })
        .catch(() => { if (!stop && seq === visitSeq.current) setUnread(0); });
    };
    load();
    const timer = setInterval(load, 20000);
    const onRefresh = (event) => {
      const scope = event?.detail?.scope || "all";
      if (scope === "all" || scope === "visit") load();
    };
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener(UNREAD_REFRESH_EVENT, onRefresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      clearInterval(timer);
      window.removeEventListener(UNREAD_REFRESH_EVENT, onRefresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [role, practitionerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let stop = false;
    const load = () => {
      const seq = ++teamSeq.current;
      if (!api.teamInbox) {
        if (seq === teamSeq.current) setTeamUnread(0);
        return;
      }
      api.teamInbox()
        .then((body) => { if (!stop && seq === teamSeq.current) setTeamUnread(visibleStaffUnreadFromInbox(body)); })
        .catch(() => { if (!stop && seq === teamSeq.current) setTeamUnread(0); });
    };
    load();
    const timer = setInterval(load, 20000);
    const onRefresh = (event) => {
      const scope = event?.detail?.scope || "all";
      if (scope === "all" || scope === "team") load();
    };
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener(UNREAD_REFRESH_EVENT, onRefresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      clearInterval(timer);
      window.removeEventListener(UNREAD_REFRESH_EVENT, onRefresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh when entering messaging surfaces so badges catch up after mark-read.
  useEffect(() => {
    const path = loc.pathname || "";
    if (role === "pro" && path.startsWith("/pro/messages")) {
      window.dispatchEvent(new CustomEvent(UNREAD_REFRESH_EVENT, { detail: { scope: "visit" } }));
    }
    if (path.includes("/team")) {
      window.dispatchEvent(new CustomEvent(UNREAD_REFRESH_EVENT, { detail: { scope: "team" } }));
    }
  }, [loc.pathname, role]);

  const teamHome = role === "owner" ? "/owner/team" : role === "desk" ? "/desk/team" : "/pro/team";
  const badges = {
    ...(role === "pro" && unread > 0 ? { "/pro/messages": unread } : {}),
    ...(teamUnread > 0 ? { [teamHome]: teamUnread } : {}),
  };
  return (
    <div className="min-h-screen overflow-x-clip">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sky-100 bg-white px-4 py-6 lg:flex">
        <Lockup to={cfg.nav[0].to} testid={`${role}-logo-link`} className="px-2" />
        <p className="nb-eyebrow mb-3 mt-8 px-2">{cfg.title} workspace</p>
        <nav className="space-y-1" aria-label={`${cfg.title} navigation`}>
          {cfg.nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} data-testid={`${role}-side-${n.label.toLowerCase()}`} className={({ isActive }) => cn("flex h-11 items-center justify-between gap-2 rounded-2xl px-3 text-sm font-medium transition-colors", isActive ? "bg-nb-ink text-white" : "text-nb-mute hover:bg-sky-50 hover:text-nb-ink")}>
              <span className="flex items-center gap-3"><n.icon className="h-[18px] w-[18px]" />{n.label}</span>
              {badges[n.to] > 0 && <span className="rounded-full bg-nb-coral px-1.5 text-[10px] font-bold text-white" data-testid={`nav-unread-${n.label.toLowerCase()}`}>{badges[n.to] > 9 ? "9+" : badges[n.to]}</span>}
            </NavLink>
          ))}
          {cfg.more.map((n) => (
            <NavLink key={n.to} to={n.to} data-testid={`${role}-side-${n.label.toLowerCase().replace(/\s+/g, "-")}`} className={({ isActive }) => cn("flex h-11 items-center justify-between gap-2 rounded-2xl px-3 text-sm font-medium transition-colors", isActive ? "bg-nb-ink text-white" : "text-nb-mute hover:bg-sky-50 hover:text-nb-ink")}>
              <span className="flex items-center gap-3"><n.icon className="h-[18px] w-[18px]" />{n.label}</span>
              {badges[n.to] > 0 && <span className="rounded-full bg-nb-coral px-1.5 text-[10px] font-bold text-white">{badges[n.to] > 9 ? "9+" : badges[n.to]}</span>}
            </NavLink>
          ))}
        </nav>
        {role === "owner" && (
          <div className="no-scrollbar mt-6 min-h-0 flex-1 overflow-y-auto">
            <p className="nb-eyebrow mb-2 px-3">More</p>
            {OWNER_MORE_GROUPS.map((group) => (
              <div key={group.title} className="mb-3">
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-nb-teal">{group.title}</p>
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    data-testid={`owner-more-${slug(item.label)}`}
                    className={({ isActive }) => cn("block rounded-xl px-3 py-1.5 text-[13px] transition-colors", isActive ? "bg-sky-50 font-semibold text-nb-blue" : "text-nb-mute hover:text-nb-ink")}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
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
        <header className="sticky top-0 z-30 flex h-[calc(var(--nb-header-h)+var(--nb-safe-t))] items-center justify-between border-b border-sky-100 bg-white/95 px-4 pt-[var(--nb-safe-t)] backdrop-blur lg:hidden">
          <Lockup to={cfg.nav[0].to} testid={`${role}-mobile-logo-link`} className="min-w-0" />
          <div className="min-w-0 shrink"><AccountMenu /></div>
        </header>
        <main className="nb-main-clear mx-auto min-w-0 max-w-[1600px] px-4 pt-5 sm:px-6 lg:px-10 lg:pt-8"><Page><Outlet /></Page></main>
      </div>
      <FloatingNav
        items={cfg.nav}
        more={role === "owner" ? OWNER_MORE : cfg.more}
        groups={role === "owner" ? OWNER_MORE_GROUPS : undefined}
        testid={`${role}-bottom`}
        badges={badges}
      />
    </div>
  );
}
