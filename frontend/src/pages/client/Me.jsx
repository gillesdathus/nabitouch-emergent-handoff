import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LiveTrack } from "@/components/LiveTrack";
import { PaymentPanel } from "@/components/PaymentPanel";
import { BillingFacts } from "@/components/BillingFacts";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Cake, Gift, Heart, MapPin, Receipt, RotateCcw, ShieldCheck, Star, Users, Award, Navigation, CreditCard, Pencil, Plus, UserRound, CalendarDays, ClipboardList, ShieldPlus } from "lucide-react";
import { IconTile, Notice } from "@/components/tide";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Avatar, CatalogueImage, ClientTracker, PayPill, StatusPill, SectionHead } from "@/components/ui-kit";
import { Breathing } from "@/components/brand";
import { useDemo } from "@/store/DemoStore";
import { OPEN, DONE, money, fmtDate, fmtTime, promoEligibility } from "@/lib/domain";

const greet = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

function SignedOut() {
  return (
    <div className="relative mx-auto max-w-xl overflow-hidden px-5 py-16 text-center" data-testid="me-signed-out">
      <Breathing leaves={false} />
      <div className="relative">
        <h1 className="text-3xl font-semibold tracking-tight">Your wellness space</h1>
        <p className="mt-2 text-nb-mute">Track visits, rebook favourites and keep your insurance details in one calm place.</p>
        <div className="mt-8 flex flex-col gap-3">
          <Link to="/login?next=/me" data-testid="me-signin-btn" className="nb-btn-primary">Sign in</Link>
          <Link to="/me/profile" data-testid="me-create-profile-btn" className="nb-btn-ghost h-12">Create a profile</Link>
          <Link to="/book" data-testid="me-guest-book-btn" className="text-sm font-medium text-nb-blue">Or book as a guest →</Link>
        </div>
        <p className="mt-6 text-xs text-nb-mute">Your account keeps your visits, insurance and payments private to you.</p>
      </div>
    </div>
  );
}

function Feedback({ appt }) {
  const { run, api } = useDemo();
  const [stars, setStars] = useState(0);
  const [text, setText] = useState("");
  return (
    <div className="nb-card p-5" data-testid="feedback-card">
      <p className="text-sm font-semibold">How did your last visit feel?</p>
      <p className="text-xs text-nb-mute">Private feedback to help us care for you better.</p>
      <div className="mt-3 flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setStars(n)} data-testid={`feedback-star-${n}`} aria-label={`${n} stars`}><Star className={`h-7 w-7 ${n <= stars ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} /></button>)}</div>
      {stars > 0 && <><textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="nb-input mt-3 h-auto py-3" placeholder="Anything to share? (optional)" data-testid="feedback-text-input" />
        <button onClick={() => run(() => api.patch("appointments", appt.id, { feedback: { stars, text, at: new Date().toISOString() } }), "Thank you for your feedback")} data-testid="feedback-submit-btn" className="nb-btn-primary mt-3 h-11">Send feedback</button></>}
    </div>
  );
}

function ReceiptDialog({ appt, onClose }) {
  const { idx } = useDemo();
  if (!appt) return null;
  const p = appt.pricing;
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="rounded-3xl sm:max-w-md" data-testid="receipt-dialog">
        <DialogTitle>Receipt · {appt.ref}</DialogTitle>
        <p className="text-xs text-amber-800">This summary is not a tax receipt.</p>
        <div className="space-y-1.5 text-sm">
          <p className="text-nb-mute">{idx.services[appt.serviceSlug].name} · {appt.duration} min · {fmtDate(appt.date)}</p>
          <p className="text-nb-mute">Practitioner: {idx.practitioners[appt.practitionerId]?.name}</p>
          <div className="border-t border-dashed pt-2" />
          {[["Treatment", p.base], ["Discount", -p.discount], ["Enhancements", p.addons], ["Travel", p.travel], ["GST", p.tax]].filter(([, v]) => v).map(([l, v]) => <div key={l} className="flex justify-between"><span>{l}</span><span>{v < 0 ? `−${money(-v)}` : money(v)}</span></div>)}
          <div className="flex justify-between font-semibold"><span>Total</span><span>{money(p.total)}</span></div>
          <div className="pt-2"><PayPill status={appt.paymentStatus} /></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EarlierOpening() {
  const { api } = useDemo();
  const [serviceSlug, setService] = useState("swedish");
  const [duration, setDuration] = useState(60);
  const [saved, setSaved] = useState("");
  const [editing, setEditing] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    const body = await api.watchOpening({ optIn: true, serviceSlug, duration });
    setSaved(body.notices?.reason || "Saved. Nabitouch will not send a message until notices are turned on.");
    setEditing(false);
  };
  return (
    <form onSubmit={save} className="nb-card mt-6 p-5" data-testid="earlier-opening">
      <p className="font-semibold">Earlier appointment</p>
      <p className="mt-1 text-sm text-nb-mute">Opt in if you want Nabitouch to match you with an earlier opening. This does not book a visit, and no message is sent yet.</p>
      {editing ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="nb-input w-auto" value={serviceSlug} onChange={(event) => setService(event.target.value)} aria-label="Service" data-testid="earlier-service" />
          <select className="nb-input w-auto" value={duration} onChange={(event) => setDuration(Number(event.target.value))} data-testid="earlier-duration"><option value={60}>60 min</option><option value={90}>90 min</option></select>
          <button className="nb-btn-primary h-12" data-testid="earlier-opt-in">Opt in</button>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
          <p className="text-nb-mute">{saved ? `${serviceSlug} · ${duration} min` : "Not watching for an earlier opening."}</p>
          <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" onClick={() => setEditing(true)}>{saved ? "Edit" : "Opt in"}</button>
        </div>
      )}
      {saved && <p className="mt-2 text-sm text-nb-mute" data-testid="earlier-saved">{saved}</p>}
    </form>
  );
}

export default function Me() {
  const { me, state, idx, patchDraft, logout, api, user } = useDemo();
  const nav = useNavigate();
  const [receipt, setReceipt] = useState(null);
  const lastStatus = useRef({});
  const seenNotices = useRef(new Set());
  const noticesReady = useRef(false);
  useEffect(() => {
    if (user?.role !== "client") return undefined;
    let stop = false;
    const pull = async () => {
      try {
        const rows = await api.billingNotices();
        if (stop || !Array.isArray(rows)) return;
        rows.forEach((notice) => {
          if (seenNotices.current.has(notice.id)) return;
          seenNotices.current.add(notice.id);
          if (noticesReady.current) toast.message(notice.title || "Billing update", { description: "Open your account to review it." });
        });
        noticesReady.current = true;
      } catch { /* the next poll recovers */ }
    };
    pull();
    const timer = setInterval(pull, 20000);
    const onFocus = () => pull();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { stop = true; clearInterval(timer); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [api, user?.role]);
  const mineAll = me ? state.appointments.filter((a) => a.clientId === me.id) : [];
  useEffect(() => {
    mineAll.forEach((a) => { const prev = lastStatus.current[a.id]; if (prev && prev !== a.status && a.status === "arrived") toast.success(`${idx.practitioners[a.practitionerId]?.name || "Your practitioner"} has arrived`, { description: "Nabitouch Live · location sharing has stopped" }); lastStatus.current[a.id] = a.status; });
  }); // eslint-disable-line
  if (!me) return <SignedOut />;
  const mine = state.appointments.filter((a) => a.clientId === me.id);
  const upcoming = mine.filter((a) => OPEN.includes(a.status)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const history = mine.filter((a) => DONE.includes(a.status) || ["cancelled", "no_show"].includes(a.status)).sort((a, b) => b.date.localeCompare(a.date));
  const next = upcoming[0];
  const lastDone = history.find((a) => DONE.includes(a.status));
  const bday = state.promotions.find((p) => p.id === "promo-birthday");
  const bdayOk = bday && promoEligibility(bday, me, "swedish");
  const plans = state.plans.filter((p) => p.clientId === me.id && p.visibleToClient);
  const gifts = state.giftcards.filter((g) => g.recipient?.includes(me.firstName) || g.purchaser?.includes(me.firstName));
  const rebook = (a, slug) => { const s = slug || a.serviceSlug; patchDraft({ serviceSlug: s, duration: a?.duration || Number(Object.keys(idx.services[s].prices).includes("60") ? 60 : Object.keys(idx.services[s].prices)[0]), practitionerId: a?.practitionerId || me.preferredPractitioners[0] || "", locationType: a?.locationType || "home", address: me.addresses[0] || null, addressQuery: me.addresses[0]?.line || "", step: 2, date: null, time: null }); nav("/book"); };

  return (
    <div className="mx-auto max-w-5xl px-5 py-8" data-testid="client-dashboard">
      <div className="flex items-center gap-3">
        <Avatar person={me} photo={me.photo} size={48} />
        <div className="flex-1"><p className="text-xs text-nb-mute">{greet()}</p><h1 className="text-lg font-semibold" data-testid="me-greeting">{me.preferredName || me.firstName}</h1></div>
        <button onClick={async () => { await logout(); nav("/"); }} data-testid="me-signout-btn" className="text-xs text-nb-mute">Sign out</button>
      </div>
      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <IconTile testid="me-tile-profile" icon={UserRound} label="Profile" sub="Details and address" tint="tint-lagoon" onClick={() => nav("/me/profile")} />
        <IconTile testid="me-tile-visits" icon={CalendarDays} label="Visits" sub={`${history.length} in history`} tint="tint-mint" iconClass="text-nb-teal" onClick={() => document.getElementById("visit-history")?.scrollIntoView({ behavior: "smooth" })} />
        <IconTile testid="me-tile-rewards" icon={Gift} label="Rewards" sub="Programme status" tint="tint-meadow" iconClass="text-[#4E9A2B]" onClick={() => nav("/me/rewards")} />
        <IconTile testid="me-tile-insurance" icon={ShieldPlus} label="Insurance" sub="Not submitted" tint="tint-ice" iconClass="text-nb-sky" onClick={() => nav("/me/insurance")} />
      </section>
      <Link to="/me/billing" data-testid="me-billing-card" className="nb-card mt-4 flex items-center gap-3 p-4 transition-transform hover:-translate-y-0.5">
        <span className="grid h-11 w-11 place-items-center rounded-2xl text-nb-blue tint-lagoon"><Receipt className="h-5 w-5" /></span>
        <div className="flex-1"><p className="text-sm font-semibold">Invoices & payments</p><p className="text-xs text-nb-mute">Balances, insurance status, PDFs and ways to pay.</p></div>
      </Link>
      <Link to="/me/intake" data-testid="me-intake-card" className="nb-card mt-4 flex items-center gap-3 p-4 transition-transform hover:-translate-y-0.5">
        <span className="grid h-11 w-11 place-items-center rounded-2xl text-nb-teal tint-mint"><ClipboardList className="h-5 w-5" /></span>
        <div className="flex-1"><p className="text-sm font-semibold">Health intake</p><p className="text-xs text-nb-mute">Saved on your account as a new version. It is not stored only on this phone.</p></div>
      </Link>

      {bdayOk && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative mt-6 overflow-hidden rounded-3xl bg-gradient-to-r from-teal-50 to-sky-50 p-5" data-testid="birthday-offer-card">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center"><span className="nb-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-white"><Cake className="h-6 w-6" /></span>
            <div className="flex-1"><p className="font-semibold">Happy birthday month, {me.firstName}!</p><p className="text-sm text-nb-mute">Enjoy $15 off a treatment this month — applied automatically at checkout.</p><p className="text-[11px] text-slate-500">Shown because you opted in to offers. Manage in Profile.</p></div>
            <button onClick={() => rebook(null, me.favorites[0] || "swedish")} data-testid="birthday-rebook-btn" className="nb-btn-primary h-10 px-4 text-sm">Treat yourself</button></div>
        </motion.div>
      )}

      {next ? (
        <div className="mt-6 space-y-3" data-testid="upcoming-visit-card">
          <div className="relative overflow-hidden rounded-[30px] p-5 text-white nb-lagoon">
            <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-nb-turq/40 blur-2xl" />
            <div className="relative flex items-end justify-between gap-3">
              <p className="nb-num text-3xl font-semibold sm:text-4xl">{fmtDate(next.date, { weekday: "short", day: "numeric" })}</p>
              <p className="nb-num text-3xl font-semibold">{fmtTime(next.time)}</p>
            </div>
            <div className="relative mt-4 flex items-center gap-3">
              <Avatar person={idx.practitioners[next.practitionerId]} size={44} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{idx.practitioners[next.practitionerId]?.name || "Practitioner being assigned"}</p>
                <p className="text-sm text-white/75">{idx.services[next.serviceSlug]?.name} · {next.duration} min</p>
              </div>
              <StatusPill status={next.status} client testid="upcoming-status-pill" />
            </div>
            <p className="relative mt-3 flex items-center gap-1 text-xs text-white/80"><MapPin className="h-3.5 w-3.5" />{next.address?.line || "Address on the visit"}</p>
          </div>
          <div className="nb-card p-5">
            <ClientTracker appt={next} />
            {next.status === "en_route" && next.trip?.sharing && <div className="mt-4" id="client-live"><LiveTrack appt={next} practitioner={idx.practitioners[next.practitionerId]} /></div>}
            {next.status === "en_route" && !next.trip?.sharing && <p className="mt-3 flex items-center gap-2 rounded-2xl bg-cyan-50 p-3 text-sm text-cyan-800" data-testid="eta-notice"><Navigation className="h-4 w-4" />Your practitioner is on the way. A live position appears only after they start sharing. An estimate is not a confirmed arrival.</p>}
            {(next.status === "en_route" || next.status === "arrived") && (
              <div className="mt-3" data-testid="client-trip-alerts">
                <Notice>This status is in the app. No SMS or email is sent from this page.</Notice>
              </div>
            )}
            {next.practitionerId && <Link to={`/me/messages/${next.id}`} data-testid="client-message-practitioner" className="nb-btn-ghost mt-3 h-11">Message practitioner</Link>}
            <div className="mt-4 space-y-3"><BillingFacts appointmentId={next.id} /><PaymentPanel appt={next} role="client" /></div>
          </div>
        </div>
      ) : (
        <div className="nb-soft mt-6 flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center" data-testid="no-upcoming-card"><p className="flex-1 text-sm">No upcoming visits. Ready for your next moment of calm?</p><Link to="/book" className="nb-btn-primary h-11" data-testid="no-upcoming-book-btn">Book now</Link></div>
      )}

      <EarlierOpening />
      <section className="nb-card mt-6 p-5" data-testid="notification-preferences">
        <p className="font-semibold">Messages</p>
        <p className="mt-1 text-sm text-nb-mute">Visit updates and promotional offers are separate. Promotional email stays off until unsubscribe and sender identification are verified.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" data-testid="consent-promotional" onClick={() => api.saveConsent({ purpose: "promotional", granted: true }).then(() => toast.success("Promotional preference saved. No message was sent."))}>Allow promotional offers</button>
          <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" data-testid="unsubscribe-promotional" onClick={() => api.unsubscribe("promotional").then(() => toast.success("Promotional messages are off"))}>Unsubscribe</button>
          <Link to="/offers" className="nb-btn-primary h-10 px-4 text-sm">View offers</Link>
        </div>
      </section>

      <Tabs defaultValue="overview" className="mt-8">
        <TabsList className="h-12 w-full justify-start gap-1 overflow-x-auto rounded-full bg-white p-1 no-scrollbar">
          {["overview", "visits", "wallet", "profile"].map((t) => <TabsTrigger key={t} value={t} data-testid={`me-tab-${t}`} className="rounded-full px-5 capitalize data-[state=active]:bg-nb-ink data-[state=active]:text-white">{t}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          {lastDone && !lastDone.feedback && <Feedback appt={lastDone} />}
          <div>
            <SectionHead eyebrow="Favourites" title="Rebook in one tap" />
            <div className="grid gap-3 sm:grid-cols-2">{(me.favorites.length ? me.favorites : ["swedish"]).map((slug) => { const s = idx.services[slug]; return (
              <div key={slug} className="nb-card flex items-center gap-4 p-4"><CatalogueImage src={s?.img} alt="" size="thumb" className="h-14 w-14 rounded-2xl object-cover" /><div className="flex-1"><p className="flex items-center gap-1 text-sm font-semibold"><Heart className="h-3.5 w-3.5 fill-rose-400 text-rose-400" />{s.name}</p><p className="text-xs text-nb-mute">{me.preferredPractitioners[0] ? `with ${idx.practitioners[me.preferredPractitioners[0]].name}` : "Best available"}</p></div><button onClick={() => rebook(history.find((h) => h.serviceSlug === slug), slug)} data-testid={`rebook-${slug}`} className="nb-btn-dark h-10 px-4 text-sm"><RotateCcw className="h-4 w-4" />Rebook</button></div>); })}
            </div>
          </div>
          {plans.map((p) => (
            <div key={p.id} className="nb-card p-5" data-testid={`client-plan-${p.id}`}>
              <p className="nb-eyebrow">Your treatment plan</p><p className="mt-1 font-semibold">{p.title}</p><p className="text-xs text-nb-mute">{p.frequency} · with {idx.practitioners[p.practitionerId].name}</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-100"><div className="nb-gradient h-full" style={{ width: `${(p.sessionsDone / p.sessionsTotal) * 100}%` }} /></div>
              <p className="mt-1 text-xs text-nb-mute">{p.sessionsDone} of {p.sessionsTotal} sessions · home care: {p.homeCare.join(", ")}</p>
            </div>))}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="nb-card p-5" data-testid="loyalty-card"><Award className="h-5 w-5 text-nb-teal" /><p className="mt-2 font-semibold">Nabitouch Rewards</p><p className="mt-1 text-xs text-nb-mute">Points, referrals, and badges are prepared and not active.</p><Link to="/me/rewards" className="mt-3 inline-flex text-sm font-medium text-nb-blue">View rewards</Link></div>
            <div className="nb-card p-5" data-testid="referral-card"><Users className="h-5 w-5 text-nb-blue" /><p className="mt-2 font-semibold">Share the calm</p><p className="text-xs text-nb-mute">Your referral code is on the rewards page. Bonuses stay off until the owner turns the programme on.</p><Link to="/me/rewards" className="mt-3 inline-flex text-sm font-medium text-nb-blue">Get your code</Link></div>
          </div>
          <div className="nb-soft p-5 text-sm" data-testid="wellness-tip"><p className="font-semibold">Gentle reminder</p><p className="text-nb-mute">Drinking water and some light stretching after a treatment can help you feel your best. Wellness tips are general and not medical advice.</p></div>
        </TabsContent>

        <TabsContent value="visits" className="mt-6 space-y-3" id="visit-history">
          {upcoming.slice(1).map((a) => <VisitRow key={a.id} a={a} />)}
          {history.map((a) => <VisitRow key={a.id} a={a} onReceipt={() => setReceipt(a)} onRebook={() => rebook(a)} />)}
          {history.length === 0 && <p className="text-sm text-nb-mute">No past visits yet.</p>}
        </TabsContent>

        <TabsContent value="wallet" className="mt-6 space-y-6">
          <div data-testid="wallet-balances"><SectionHead eyebrow="Payments" title="Balances & insurance" />
            {history.filter((a) => DONE.includes(a.status)).map((a) => <div key={a.id} className="nb-card mb-3 p-5" data-testid={`wallet-visit-${a.id}`}><p className="mb-3 text-sm font-semibold">{a.ref} · {idx.services[a.serviceSlug].name} · {fmtDate(a.date)}</p><BillingFacts appointmentId={a.id} /><PaymentPanel appt={a} role="client" /></div>)}
          </div>
          <div><SectionHead eyebrow="Insurance" title="Insurance profiles" action={<Link to="/me/insurance" data-testid="wallet-add-insurance-btn" className="nb-btn-ghost h-10 text-sm"><Plus className="h-4 w-4" />Add</Link>} />
            <div className="space-y-3">{me.insurance.map((i) => <div key={i.id} className="nb-card flex items-center gap-4 p-4" data-testid={`wallet-insurance-${i.id}`}><ShieldCheck className="h-5 w-5 text-nb-teal" /><div className="flex-1"><p className="text-sm font-semibold">{i.insurer}</p><p className="text-xs text-nb-mute">Member {i.memberId || "—"} · {i.relationship}</p></div><PayPill status={i.status} /></div>)}
              {me.insurance.length === 0 && <p className="text-sm text-nb-mute">No insurance saved. You can always pay yourself.</p>}</div></div>
          <div className="nb-card flex items-center gap-4 p-4"><CreditCard className="h-5 w-5 text-nb-blue" /><div className="flex-1"><p className="text-sm font-semibold">Payment preference</p><p className="text-xs text-nb-mute">Insurance billing is not connected. Card and cash follow the payment recorded on each visit.</p></div></div>
          <div><SectionHead eyebrow="Gift cards" title="Gift cards" />{gifts.map((g) => <div key={g.id} className="nb-gradient mb-3 rounded-3xl p-5 text-white" data-testid={`giftcard-${g.id}`}><Gift className="h-5 w-5" /><p className="mt-3 font-mono text-sm">{g.code}</p><p className="text-2xl font-semibold">{money(g.balance)} <span className="text-sm font-normal opacity-80">of {money(g.amount)}</span></p><p className="text-xs opacity-80">{g.purchaser === `${me.firstName} ${me.lastName}` ? `Gift for ${g.recipient}` : `From ${g.purchaser}`} · {g.status}</p></div>)}{gifts.length === 0 && <p className="text-sm text-nb-mute">No gift cards yet.</p>}</div>
          <div><SectionHead eyebrow="Receipts" title="Receipts & invoices" />{history.filter((a) => DONE.includes(a.status)).map((a) => <button key={a.id} onClick={() => setReceipt(a)} data-testid={`wallet-receipt-${a.id}`} className="nb-card mb-2 flex w-full items-center gap-3 p-4 text-left"><Receipt className="h-4 w-4 text-nb-mute" /><span className="flex-1 text-sm">{a.ref} · {fmtDate(a.date)}</span><span className="text-sm font-semibold">{money(a.pricing.total)}</span></button>)}</div>
        </TabsContent>

        <TabsContent value="profile" className="mt-6 space-y-4">
          <div className="nb-card p-5" data-testid="profile-summary">
            <div className="flex items-center justify-between"><p className="font-semibold">{me.firstName} {me.lastName}</p><Link to="/me/profile" data-testid="profile-edit-btn" className="nb-btn-ghost h-9 px-4 text-xs"><Pencil className="h-3.5 w-3.5" />Edit</Link></div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">{[["Email", me.email], ["Phone", me.phone], ["Birthday", me.dob ? fmtDate(me.dob, { month: "long", day: "numeric" }) : "—"], ["Language", me.language], ["Contact by", me.contactMethod], ["Offers & birthday wishes", me.marketingConsent ? "Opted in" : "Not subscribed"]].map(([k, v]) => <div key={k}><dt className="text-xs text-nb-mute">{k}</dt><dd>{v}</dd></div>)}</dl>
          </div>
          <div className="nb-card p-5"><p className="mb-3 font-semibold">Saved addresses</p>{me.addresses.map((a) => <p key={a.id} className="flex items-center gap-2 text-sm"><MapPin className="h-4 w-4 text-nb-teal" /><b>{a.label}</b> {a.line}</p>)}</div>
        </TabsContent>
      </Tabs>
      <ReceiptDialog appt={receipt} onClose={() => setReceipt(null)} />
    </div>
  );
}

function VisitRow({ a, onReceipt, onRebook }) {
  const { idx } = useDemo();
  return (
    <div className="nb-card flex flex-wrap items-center gap-4 p-4" data-testid={`visit-row-${a.id}`}>
      <CatalogueImage src={idx.services[a.serviceSlug]?.img} alt="" size="thumb" className="h-12 w-12 rounded-2xl object-cover" />
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{idx.services[a.serviceSlug].name} · {a.duration} min</p><p className="text-xs text-nb-mute">{fmtDate(a.date)} · {idx.practitioners[a.practitionerId]?.name || "—"}</p></div>
      <StatusPill status={a.status} client />
      {onReceipt && DONE.includes(a.status) && <button onClick={onReceipt} data-testid={`visit-receipt-${a.id}`} className="text-xs font-semibold text-nb-blue">Receipt</button>}
      {onRebook && <button onClick={onRebook} data-testid={`visit-rebook-${a.id}`} className="text-xs font-semibold text-nb-teal">Rebook</button>}
    </div>
  );
}
