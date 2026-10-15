import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { UserRound, CalendarDays, Gift, ShieldPlus, ArrowRight, Navigation, CalendarClock, Copy, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { usePreview } from "@/store/PreviewStore";
import { Avatar, IconTile, Reveal, SectionHead, BottomSheet, Field, Notice, EmptyState, StatusPill, Pill } from "@/components/ui-kit";
import { TopIcons } from "@/components/shells";
import { money, timeLabel, fmtDate, todayISO, greeting, weekdayShort } from "@/lib/domain";

function ProfileSheet({ open, onOpenChange, c }) {
  const { api } = usePreview();
  const [f, setF] = useState(c);
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="My profile" testid="me-profile-sheet" footer={<button data-testid="me-profile-save" onClick={async () => { await api.save("clients", c.id, f, "Profile saved"); onOpenChange(false); }} className="nb-btn-primary w-full">Save changes</button>}>
      {["name", "email", "phone", "address"].map((k) => <Field key={k} label={k[0].toUpperCase() + k.slice(1)}><input data-testid={`me-profile-${k}`} className="nb-input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
    </BottomSheet>
  );
}

export default function Me() {
  const { db, cli, svc, pro, me, role, openAppt } = usePreview();
  const nav = useNavigate();
  const [sheet, setSheet] = useState(null);
  if (role !== "client") return <EmptyState icon={UserRound} title="Sign in to see your visits" body="Your upcoming visits, profile and offers live here." testid="me-signed-out" action={<Link to="/login" className="nb-btn-primary">Sign in</Link>} />;
  const c = cli(me.client);
  const mine = db.appointments.filter((a) => a.clientId === c.id);
  const upcoming = mine.filter((a) => a.date >= todayISO() && !["completed", "cancelled"].includes(a.status)).sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
  const history = mine.filter((a) => a.status === "completed").sort((x, y) => y.date.localeCompare(x.date));
  const next = upcoming[0];
  return (
    <div className="max-w-3xl mx-auto px-5 pt-5 space-y-7">
      <div className="flex items-center gap-3">
        <Avatar name={c.name} size={48} />
        <div className="flex-1"><p className="text-xs text-nb-mute">{greeting()}</p><p className="text-lg font-semibold">{c.name.split(" ")[0]}</p></div>
        <TopIcons base="/me" />
      </div>
      <section>
        <SectionHead title={<span className="flex items-center gap-2">Upcoming <span className="h-6 min-w-6 px-1.5 rounded-full bg-nb-coral text-white text-xs grid place-items-center">{upcoming.length}</span></span>} />
        {next ? (
          <Reveal className="relative overflow-hidden rounded-[30px] nb-lagoon text-white p-5" >
            <div data-testid="next-visit-card">
              <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-nb-turq/40 blur-2xl" />
              <div className="relative flex items-end justify-between">
                <p className="text-4xl font-semibold nb-num">{weekdayShort(next.date)} {fmtDate(next.date, { day: "numeric" })}</p>
                <p className="text-3xl font-semibold nb-num">{timeLabel(next.time)}</p>
              </div>
              <div className="relative flex items-center gap-3 mt-4">
                <Avatar src={pro(next.practitionerId).photo} name="" size={44} />
                <div className="flex-1"><p className="font-semibold">{pro(next.practitionerId).name}</p><p className="text-sm text-white/75">{svc(next.serviceId).name} · {money(next.pricing.total)} at visit</p></div>
                <StatusPill status={next.status} className="!bg-white/15 !text-white !ring-white/30" />
              </div>
              <div className="relative grid grid-cols-2 gap-2 mt-5">
                <button data-testid="next-visit-reschedule" onClick={() => nav(`/book?service=${next.serviceId}`)} className="nb-btn h-12 bg-white text-nb-ink"><CalendarClock className="h-4 w-4" />Reschedule</button>
                <Link to="/track/preview" data-testid="next-visit-track" className="nb-btn h-12 bg-nb-ink text-white"><Navigation className="h-4 w-4" />Track</Link>
              </div>
            </div>
          </Reveal>
        ) : <EmptyState icon={CalendarDays} title="No upcoming visits" action={<Link to="/book" className="nb-btn-primary">Book a massage</Link>} />}
      </section>
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <IconTile testid="me-tile-profile" icon={UserRound} label="Profile" sub="Details & address" tint="tint-lagoon" onClick={() => setSheet("profile")} />
        <IconTile testid="me-tile-visits" icon={CalendarDays} label="Visits" sub={`${history.length} completed`} tint="tint-mint" iconClass="text-nb-teal" onClick={() => document.getElementById("history")?.scrollIntoView({ behavior: "smooth" })} />
        <IconTile testid="me-tile-rewards" icon={Gift} label="Rewards" sub="Programme off" tint="tint-meadow" iconClass="text-[#4E9A2B]" onClick={() => setSheet("rewards")} />
        <IconTile testid="me-tile-insurance" icon={ShieldPlus} label="Insurance" sub="Not connected" tint="tint-ice" iconClass="text-nb-sky" onClick={() => setSheet("insurance")} />
      </section>
      <Link to="/me/intake" data-testid="me-intake-card" className="flex items-center gap-3 nb-card p-4 hover:-translate-y-0.5 transition-transform">
        <span className="grid place-items-center h-11 w-11 rounded-2xl tint-mint text-nb-teal"><ClipboardList className="h-5 w-5" /></span>
        <div className="flex-1"><p className="text-sm font-semibold">Health intake form</p><p className="text-xs text-nb-mute">{c.intake === "complete" ? "Complete · review or update anytime" : localStorage.getItem("nb-intake-c1") ? "In progress · continue where you left off" : "Takes about 3 minutes"}</p></div>
        <Pill tone={c.intake === "complete" ? "bg-nb-green/15 text-[#3E7A1E] ring-nb-green/30" : "bg-sky-50 text-nb-blue ring-sky-200"}>{c.intake === "complete" ? "Complete" : "To do"}</Pill>
      </Link>
      <Link to="/offers" data-testid="me-offers-link" className="flex items-center justify-between rounded-3xl nb-tide text-white px-5 h-16"><span className="text-sm font-medium">Last-minute openings near you</span><ArrowRight className="h-4 w-4 text-nb-turq" /></Link>
      <section id="history">
        <SectionHead title="Visit history" />
        {history.map((a, i) => (
          <Reveal key={a.id} i={i}>
            <button data-testid={`history-row-${a.id}`} onClick={() => openAppt(a.id)} className="w-full flex items-center gap-3 rounded-3xl bg-white ring-1 ring-sky-100 p-3 mb-2 text-left active:scale-[0.99] transition-transform">
              <Avatar src={pro(a.practitionerId).photo} name="" size={44} />
              <div className="flex-1 min-w-0"><p className="font-semibold text-sm">{pro(a.practitionerId).name}</p><p className="text-xs text-nb-mute">{svc(a.serviceId).name} · {fmtDate(a.date, { month: "short", day: "numeric" })}</p></div>
              <span className="rounded-full bg-nb-ink text-white text-xs font-semibold px-3 h-8 grid place-items-center nb-num">{money(a.pricing.total)}</span>
            </button>
          </Reveal>
        ))}
      </section>
      <ProfileSheet open={sheet === "profile"} onOpenChange={(o) => !o && setSheet(null)} c={c} />
      <BottomSheet open={sheet === "rewards"} onOpenChange={(o) => !o && setSheet(null)} title="Rewards" testid="me-rewards-sheet">
        <div className="rounded-3xl tint-meadow p-5"><p className="text-sm text-nb-mute">Points</p><p className="text-4xl font-semibold nb-num">—</p><Pill className="mt-2">Earning not active</Pill></div>
        <Notice className="mt-3">The rewards programme isn't switched on yet. Points will appear here once the owner activates it.</Notice>
        <div className="flex items-center justify-between rounded-2xl ring-1 ring-sky-100 p-4 mt-3"><div><p className="text-xs text-nb-mute">Your referral code</p><p className="font-semibold nb-num">SOPHIE-NB24</p></div><button data-testid="copy-referral" onClick={() => toast.success("Code copied")} className="nb-btn-ghost h-10"><Copy className="h-4 w-4" />Copy</button></div>
      </BottomSheet>
      <BottomSheet open={sheet === "insurance"} onOpenChange={(o) => !o && setSheet(null)} title="Insurance" testid="me-insurance-sheet">
        <Field label="Coverage preference"><select className="nb-input" defaultValue="receipt"><option value="receipt">Send me receipts to claim myself</option><option value="none">No insurance</option></select></Field>
        <Notice>Direct insurer billing is not connected. We provide receipts you can submit to your insurer.</Notice>
      </BottomSheet>
    </div>
  );
}
