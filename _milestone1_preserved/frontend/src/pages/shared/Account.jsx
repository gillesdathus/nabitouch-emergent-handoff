import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CalendarCheck, BadgeAlert, Banknote, Info, ShieldCheck, Mail, LogOut, Navigation, ChevronRight, BellRing, Check } from "lucide-react";
import { getNavPref, setNavPref, availableApps } from "@/lib/geo";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, Reveal, SectionHead, Pill, cx } from "@/components/ui-kit";
import { Switch } from "@/components/ui/switch";
import { Attribution, Emblem } from "@/components/brand";

const ICON = { booking: CalendarCheck, credential: BadgeAlert, payment: Banknote, system: Info };

export default function Notifications() {
  const { db, api } = usePreview();
  const [f, setF] = useState("all");
  const list = db.notifications.filter((n) => f === "all" || (f === "unread" ? n.unread : n.kind === f));
  return (
    <div className="max-w-2xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader title="Notifications" right={<button data-testid="mark-all-read" onClick={() => db.notifications.forEach((n) => api.save("notifications", n.id, { unread: false }))} className="text-sm text-nb-blue font-medium">Mark all read</button>} />
      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">{["all", "unread", "booking", "payment", "credential"].map((k) => <button key={k} data-testid={`notif-filter-${k}`} onClick={() => setF(k)} className={cx(f === k ? "nb-chip-on" : "nb-chip-off", "capitalize")}>{k}</button>)}</div>
      <div className="space-y-2">
        {list.map((n, i) => { const I = ICON[n.kind]; return (
          <Reveal key={n.id} i={i}>
            <button data-testid={`notif-${n.id}`} onClick={() => api.save("notifications", n.id, { unread: false })} className={cx("w-full nb-card p-4 flex gap-3 text-left", n.unread && "ring-2 ring-nb-blue/20")}>
              <span className="h-10 w-10 rounded-2xl tint-ice grid place-items-center text-nb-blue shrink-0"><I className="h-5 w-5" /></span>
              <div className="flex-1 min-w-0"><p className="text-sm font-semibold">{n.title}</p><p className="text-sm text-nb-mute">{n.body}</p><p className="text-xs text-nb-mute/80 mt-1">{n.at}</p></div>
              {n.unread && <span className="h-2.5 w-2.5 rounded-full bg-nb-blue mt-1.5" />}
            </button>
          </Reveal>
        ); })}
      </div>
    </div>
  );
}

const Item = ({ icon: I, label, value, onClick, testid, right }) => (
  <button data-testid={testid} onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
    <span className="h-9 w-9 rounded-xl tint-ice grid place-items-center text-nb-blue"><I className="h-4 w-4" /></span>
    <span className="flex-1 text-sm font-medium">{label}</span>
    {right || <><span className="text-xs text-nb-mute">{value}</span><ChevronRight className="h-4 w-4 text-nb-mute" /></>}
  </button>
);

export function NavPref() {
  const [pref, setPref] = useState(getNavPref());
  return (
    <div data-testid="nav-pref-section">
      <SectionHead title="Navigation app" className="mt-6" />
      <div className="space-y-2">
        {availableApps().map((a) => (
          <button key={a.key} data-testid={`nav-pref-${a.key}`} onClick={() => { setNavPref(a.key); setPref(a.key); }} className={cx("w-full nb-card p-4 flex items-center gap-3 text-left", pref === a.key && "ring-2 ring-nb-blue/40")}>
            <span className="h-10 w-10 rounded-2xl tint-lagoon grid place-items-center text-nb-blue"><Navigation className="h-5 w-5" /></span>
            <div className="flex-1"><p className="text-sm font-semibold">{a.label}</p><p className="text-xs text-nb-mute">Start trip opens {a.label} with the visit address</p></div>
            {pref === a.key && <Check className="h-5 w-5 text-nb-blue" />}
          </button>
        ))}
      </div>
      <p className="text-xs text-nb-mute mt-2">If the app isn't installed, the trip screen offers the others and “Copy address”. Live ETA pauses while you're in another app.</p>
    </div>
  );
}

export function Settings() {
  const { role, setRole } = usePreview();
  const nav = useNavigate();
  const loc = useLocation();
  const [prefs, setPrefs] = useState({ push: true, email: true });
  const staff = ["owner", "pro", "desk"].includes(role);
  return (
    <div className="max-w-2xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader title="Settings" />
      <SectionHead title="Account" />
      <div className="nb-card divide-y divide-sky-100">
        <Item icon={Mail} label="Email" value="you@example.com" testid="settings-email" />
        {staff && <Item icon={ShieldCheck} label="Authenticator (MFA)" testid="settings-mfa" right={<Pill tone="bg-nb-green/15 text-[#3E7A1E] ring-nb-green/30">Enrolled</Pill>} />}
        {role === "pro" && <Item icon={Navigation} label="Location sharing" testid="settings-location" right={<Pill>Only during active trips</Pill>} />}
      </div>
      {role === "pro" && <NavPref />}
      <SectionHead title="Notifications" className="mt-6" />
      <div className="nb-card divide-y divide-sky-100">
        <Item icon={BellRing} label="Push notifications" testid="settings-push" right={<Switch checked={prefs.push} onCheckedChange={(v) => setPrefs({ ...prefs, push: v })} data-testid="settings-push-switch" />} />
        <Item icon={Mail} label="Email updates" testid="settings-email-pref" right={<Switch checked={prefs.email} onCheckedChange={(v) => setPrefs({ ...prefs, email: v })} data-testid="settings-email-switch" />} />
      </div>
      <button data-testid="sign-out-btn" onClick={() => { setRole("guest"); nav("/login"); }} className="nb-btn-ghost w-full mt-6 text-nb-coral"><LogOut className="h-4 w-4" />Sign out</button>
      <div data-testid="about-section" className="mt-10 mb-6 flex flex-col items-center text-center gap-2">
        <Emblem className="h-10" />
        <p className="text-xs text-nb-mute">Nabitouch Mobile Massage · Design preview build</p>
        <Attribution />
        <span className="hidden">{loc.pathname}</span>
      </div>
    </div>
  );
}
