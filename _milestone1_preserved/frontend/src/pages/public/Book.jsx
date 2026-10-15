import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, MapPin, Home as HomeIcon, Check, Banknote, CreditCard, Sparkles, Navigation, CalendarPlus, Zap } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { Stepper, Notice, Avatar, Row, Field, cx } from "@/components/ui-kit";
import { DayStrip } from "@/components/Calendar";
import { freeSlots } from "@/lib/schedule";
import { MapView } from "@/components/MapView";
import { geocode, hasMapbox, pointInPoly, zoneCoords } from "@/lib/geo";
import { money, money0, quote, timeLabel, todayISO, fmtDate } from "@/lib/domain";

const STEPS = ["Location", "Service", "Time", "Therapist", "Review", "Payment"];
const KEY = "nb-booking-draft";
const blank = { step: 0, address: "", zoneId: "", serviceId: "", date: todayISO(), time: "", practitionerId: "best", notes: "", method: "cash", campaignId: "", name: "", email: "", phone: "" };

function AddressSearch({ d, set, db }) {
  const [q, setQ] = useState(d.address);
  const [res, setRes] = useState([]);
  const [pin, setPin] = useState(null);
  useEffect(() => { const t = setTimeout(() => geocode(q).then(setRes), 300); return () => clearTimeout(t); }, [q]);
  const pick = (r) => {
    const z = db.zones.find((x) => pointInPoly(r.lngLat, zoneCoords(x)));
    setPin({ ...r, zone: z });
    setRes([]); setQ(r.label);
    set({ address: r.label, zoneId: z?.id || "" });
  };
  return (
    <div>
      <Field label="Visit address"><input data-testid="address-input" className="nb-input" placeholder="Start typing your address" value={q} onChange={(e) => { setQ(e.target.value); set({ address: e.target.value }); }} /></Field>
      {res.length > 0 && <div data-testid="address-suggestions" className="-mt-2 mb-3 rounded-2xl bg-white ring-1 ring-sky-100 shadow-lg overflow-hidden">{res.map((r) => <button key={r.id} onClick={() => pick(r)} className="w-full text-left px-4 py-3 text-sm border-b border-sky-50 hover:bg-sky-50 flex gap-2"><MapPin className="h-4 w-4 text-nb-teal shrink-0 mt-0.5" />{r.label}</button>)}</div>}
      {pin && (
        <div className="space-y-2 mb-2">
          <MapView className="h-40 rounded-3xl" zones={pin.zone ? [{ ...pin.zone, coords: zoneCoords(pin.zone), active: true }] : []} markers={[{ id: "addr", kind: "pin", lngLat: pin.lngLat }]} fit={[pin.lngLat]} testid="address-map" />
          <p data-testid="zone-check-result" className={cx("text-sm font-semibold", pin.zone ? "text-nb-teal" : "text-nb-coral")}>{pin.zone ? `Inside ${pin.zone.name} · ${pin.zone.fee ? `travel ${money0(pin.zone.fee)}` : "no travel fee"}` : "Outside our service area — choose the closest area below or contact us"}</p>
        </div>
      )}
    </div>
  );
}

function LocationStep({ d, set, db }) {
  return (
    <div className="space-y-4">
      <div className="nb-select-tile border-nb-blue bg-sky-50/60 flex items-center gap-3" data-testid="location-mobile-tile">
        <span className="grid place-items-center h-11 w-11 rounded-2xl nb-lagoon text-white"><HomeIcon className="h-5 w-5" /></span>
        <div><p className="font-semibold">Mobile visit</p><p className="text-xs text-nb-mute">We come to your home, hotel or office</p></div>
        <Check className="h-5 w-5 text-nb-blue ml-auto" />
      </div>
      {hasMapbox ? <AddressSearch d={d} set={set} db={db} /> : (<>
      <Field label="Visit address"><input data-testid="address-input" className="nb-input" placeholder="Street address, unit, buzzer" value={d.address} onChange={(e) => set({ address: e.target.value })} /></Field>
      <Notice testid="mapbox-config-notice" icon={MapPin}>Address search needs a Mapbox token, which isn't configured in this preview. Type your address and choose your area below.</Notice>
      </>)}
      <p className="nb-label">Your area</p>
      <div className="grid grid-cols-2 gap-2">
        {db.zones.map((z) => (
          <button key={z.id} data-testid={`zone-tile-${z.id}`} onClick={() => set({ zoneId: z.id })} className={cx("nb-select-tile", d.zoneId === z.id ? "border-nb-blue bg-sky-50/60" : "border-sky-100 bg-white")}>
            <p className="font-semibold text-sm">{z.name}</p><p className="text-xs text-nb-mute">{z.fee ? `Travel ${money0(z.fee)}` : "No travel fee"}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function ServiceStep({ d, set, db, campaign }) {
  const list = db.services.filter((s) => s.published && (!campaign || s.id === campaign.serviceId));
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {list.map((s) => (
        <button key={s.id} data-testid={`svc-tile-${s.slug}`} onClick={() => set({ serviceId: s.id, time: "" })} className={cx("text-left rounded-3xl overflow-hidden border-2 transition-[border-color,transform] active:scale-[0.98] bg-white", d.serviceId === s.id ? "border-nb-blue" : "border-transparent ring-1 ring-sky-100")}>
          <div className="flex gap-3 p-2.5">
            <img src={s.img} alt="" className="h-20 w-20 rounded-2xl object-cover" />
            <div className="flex-1 py-1"><p className="font-semibold text-sm">{s.name}</p><p className="text-xs text-nb-mute">{s.duration} min</p><p className="text-sm font-semibold nb-num mt-1.5">{money0(s.price)}{campaign && <span className="ml-2 text-nb-coral text-xs">−{campaign.discountPercent}%</span>}</p></div>
            {d.serviceId === s.id && <span className="h-6 w-6 rounded-full bg-nb-blue text-white grid place-items-center nb-pop"><Check className="h-3.5 w-3.5" /></span>}
          </div>
        </button>
      ))}
    </div>
  );
}

function TimeStep({ d, set, db, svc, campaign }) {
  const s = svc(d.serviceId);
  const pids = db.practitioners.filter((p) => p.bookable && p.specialties.includes(d.serviceId)).map((p) => p.id);
  let slots = freeSlots(db, pids, d.date, s.duration);
  if (campaign) slots = slots.filter((x) => x.time >= campaign.windowStart && x.time < campaign.windowEnd);
  return (
    <div>
      <p className="nb-label">{fmtDate(d.date, { weekday: "long", month: "long", day: "numeric" })}</p>
      {campaign ? <Notice tone="info" icon={Zap}>Offer valid {fmtDate(campaign.bookingStart)} · {timeLabel(campaign.windowStart)}–{timeLabel(campaign.windowEnd)}</Notice> : <DayStrip value={d.date} onChange={(x) => set({ date: x, time: "" })} start={todayISO()} testid="book-day-strip" />}
      <p className="nb-label mt-5">Available times · Edmonton</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {slots.length === 0 && <p className="col-span-3 text-sm text-nb-mute">No openings this day — try another date.</p>}
        {slots.map((x) => <button key={x.time} data-testid={`book-slot-${x.time}`} onClick={() => set({ time: x.time })} className={cx("h-12 rounded-2xl text-sm font-semibold nb-num transition-[background-color,transform] active:scale-95", d.time === x.time ? "nb-lagoon text-white shadow-lg" : "bg-white ring-1 ring-sky-100 hover:ring-nb-sky")}>{timeLabel(x.time)}</button>)}
      </div>
    </div>
  );
}

function ProStep({ d, set, db, svc }) {
  const pids = freeSlots(db, db.practitioners.filter((p) => p.bookable && p.specialties.includes(d.serviceId)).map((p) => p.id), d.date, svc(d.serviceId).duration).find((x) => x.time === d.time)?.practitioners || [];
  return (
    <div className="space-y-2">
      <button data-testid="pro-best-match" onClick={() => set({ practitionerId: "best" })} className={cx("w-full nb-select-tile flex items-center gap-3", d.practitionerId === "best" ? "border-nb-blue bg-sky-50/60" : "border-sky-100 bg-white")}>
        <span className="grid place-items-center h-12 w-12 rounded-full nb-gradient text-white"><Sparkles className="h-5 w-5" /></span>
        <div><p className="font-semibold">Best match</p><p className="text-xs text-nb-mute">First available therapist for this treatment</p></div>
      </button>
      {pids.map((id) => { const p = db.practitioners.find((x) => x.id === id); return (
        <button key={id} data-testid={`pro-tile-${id}`} onClick={() => set({ practitionerId: id })} className={cx("w-full nb-select-tile flex items-center gap-3", d.practitionerId === id ? "border-nb-blue bg-sky-50/60" : "border-sky-100 bg-white")}>
          <Avatar src={p.photo} name={p.name} size={48} /><div className="text-left"><p className="font-semibold">{p.name}</p><p className="text-xs text-nb-mute">{p.title} · {p.years} yrs</p></div>
        </button>
      ); })}
    </div>
  );
}

function ReviewStep({ d, set, q, svc, zone, proName }) {
  const s = svc(d.serviceId);
  return (
    <div className="space-y-4">
      <div className="rounded-[28px] nb-tide text-white p-5">
        <p className="text-white/60 text-xs">Your visit</p>
        <p className="text-xl font-semibold mt-1">{s.name}</p>
        <p className="text-sm text-white/80">{fmtDate(d.date, { weekday: "long", month: "long", day: "numeric" })} · {timeLabel(d.time)}</p>
        <p className="text-sm text-white/80 mt-1">{proName} · {d.address || "Address"}, {zone(d.zoneId)?.name}</p>
      </div>
      <div className="nb-card p-4" data-testid="quote-card">
        <p className="nb-eyebrow mb-1">Server quote</p>
        <Row label={`Treatment · ${s.duration} min`} value={money(s.price)} />
        {q.discount > 0 && <Row label="Flash offer" value={<span className="text-nb-coral">−{money(q.discount)}</span>} />}
        <Row label="Travel (zone fee)" value={money(q.travel)} />
        <Row label="GST 5%" value={money(q.tax)} />
        <Row label="Total" value={<span data-testid="quote-total">{money(q.total)}</span>} strong className="border-t border-dashed border-sky-100 mt-1 pt-3" />
      </div>
      <Field label="Notes for your therapist" hint="Notes help your therapist prepare. They never change the treatment or price."><textarea data-testid="booking-notes" rows={3} className="nb-input h-auto py-3" value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Focus areas, access, pets…" /></Field>
    </div>
  );
}

function PaymentStep({ d, set, guest }) {
  return (
    <div className="space-y-3">
      <button data-testid="pay-cash-tile" onClick={() => set({ method: "cash" })} className={cx("w-full nb-select-tile flex items-center gap-3", d.method === "cash" ? "border-nb-blue bg-sky-50/60" : "border-sky-100 bg-white")}>
        <span className="grid place-items-center h-11 w-11 rounded-2xl tint-meadow text-[#4E9A2B]"><Banknote className="h-5 w-5" /></span>
        <div className="text-left"><p className="font-semibold">Pay at your visit</p><p className="text-xs text-nb-mute">Cash. Your booking stays unpaid until your therapist records it.</p></div>
      </button>
      <div data-testid="pay-card-tile-disabled" className="nb-select-tile border-sky-100 bg-slate-50 flex items-center gap-3 opacity-70">
        <span className="grid place-items-center h-11 w-11 rounded-2xl bg-white text-nb-mute"><CreditCard className="h-5 w-5" /></span>
        <div className="text-left"><p className="font-semibold text-nb-mute">Card</p><p className="text-xs text-nb-mute">Not available — card checkout isn't configured</p></div>
      </div>
      {guest && (
        <div className="pt-2">
          <Field label="Your name"><input data-testid="guest-name" className="nb-input" value={d.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Email"><input data-testid="guest-email" type="email" className="nb-input" value={d.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Phone"><input data-testid="guest-phone" className="nb-input" value={d.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
        </div>
      )}
    </div>
  );
}

function Confirmed({ d, svc, proName, q }) {
  return (
    <div data-testid="booking-confirmed" className="max-w-lg mx-auto px-5 pt-10 text-center">
      <div className="relative mx-auto h-28 w-28">
        <span className="absolute inset-0 rounded-full nb-gradient opacity-30 nb-ping" />
        <span className="absolute inset-0 rounded-full nb-gradient grid place-items-center nb-pop">
          <svg viewBox="0 0 40 40" className="h-14 w-14"><path d="M11 21 l6 6 l12 -14" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="nb-draw" /></svg>
        </span>
      </div>
      <h1 className="mt-6 text-3xl font-semibold">Request <span className="font-display italic font-normal nb-gradient-text">received</span></h1>
      <p className="text-nb-mute mt-2">We'll confirm shortly. You pay at the visit — it stays unpaid until cash is recorded.</p>
      <div className="nb-card p-5 mt-6 text-left">
        <p className="font-semibold">{svc(d.serviceId).name}</p>
        <p className="text-sm text-nb-mute">{fmtDate(d.date, { weekday: "long", month: "long", day: "numeric" })} · {timeLabel(d.time)} · {proName}</p>
        <Row label="Total at visit" value={money(q.total)} strong className="mt-2" />
      </div>
      <div className="grid grid-cols-2 gap-3 mt-5">
        <Link to="/track/preview" data-testid="confirmed-track-btn" className="nb-btn-ghost h-12"><Navigation className="h-4 w-4" />Track visit</Link>
        <Link to="/me" data-testid="confirmed-me-btn" className="nb-btn-primary"><CalendarPlus className="h-4 w-4" />My visits</Link>
      </div>
    </div>
  );
}

export default function Book() {
  const { db, svc, zone, api, role, me, cli } = usePreview();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [d, setD] = useState(() => {
    const saved = sp.get("resume") ? JSON.parse(localStorage.getItem(KEY) || "{}") : {};
    const c = role === "client" ? cli(me.client) : null;
    const base = { ...blank, ...(c ? { address: c.address, zoneId: c.zoneId, name: c.name, email: c.email, phone: c.phone } : {}), ...saved };
    const camp = sp.get("campaign") && db.campaigns.find((x) => x.id === sp.get("campaign"));
    if (camp) return { ...base, campaignId: camp.id, serviceId: camp.serviceId, date: camp.bookingStart };
    if (sp.get("service")) base.serviceId = sp.get("service");
    if (sp.get("pro")) Object.assign(base, { practitionerId: sp.get("pro"), date: sp.get("date") || base.date, time: sp.get("time") || "", serviceId: base.serviceId || db.practitioners.find((p) => p.id === sp.get("pro")).specialties[0] });
    return base;
  });
  const [dir, setDir] = useState(1);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (ch) => setD((x) => ({ ...x, ...ch }));
  const campaign = db.campaigns.find((x) => x.id === d.campaignId);
  useEffect(() => { if (!done) localStorage.setItem(KEY, JSON.stringify(d)); }, [d, done]);
  const q = useMemo(() => (d.serviceId ? quote(svc(d.serviceId), zone(d.zoneId), campaign?.discountPercent || 0) : null), [d.serviceId, d.zoneId, campaign, svc, zone]);
  const pickedPro = d.practitionerId === "best" ? (d.time ? freeSlots(db, db.practitioners.filter((p) => p.bookable && p.specialties.includes(d.serviceId)).map((p) => p.id), d.date, svc(d.serviceId).duration).find((x) => x.time === d.time)?.practitioners[0] : null) : d.practitionerId;
  const proName = pickedPro ? db.practitioners.find((p) => p.id === pickedPro)?.name : "Best match";
  const valid = [d.address.trim() && d.zoneId, d.serviceId, d.time, true, true, d.method === "cash" && (role !== "guest" || (d.name && d.email))][d.step];
  const go = (n) => { setDir(n > d.step ? 1 : -1); set({ step: n }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const submit = async () => {
    setBusy(true);
    await api.book({ serviceId: d.serviceId, practitionerId: pickedPro, clientId: role === "client" ? me.client : "c1", date: d.date, time: d.time, zoneId: d.zoneId, address: d.address, notes: d.notes, method: "cash", discountPercent: campaign?.discountPercent || 0 });
    setBusy(false);
    localStorage.removeItem(KEY);
    setDone(true);
  };
  if (done) return <Confirmed d={d} svc={svc} proName={proName} q={q} />;
  const props = { d, set, db, svc, zone, campaign, q, proName, guest: role === "guest" };
  const Body = [LocationStep, ServiceStep, TimeStep, ProStep, ReviewStep, PaymentStep][d.step];
  return (
    <div className="max-w-2xl mx-auto px-5 pt-4 pb-44 md:pb-32">
      <div className="flex items-center gap-3 mb-4">
        <button data-testid="book-back-btn" onClick={() => (d.step ? go(d.step - 1) : nav(-1))} className="h-11 w-11 grid place-items-center rounded-full bg-white ring-1 ring-sky-100"><ArrowLeft className="h-4 w-4" /></button>
        <div><p className="nb-eyebrow">Step {d.step + 1} of 6{campaign ? " · Flash offer" : ""}</p><h1 className="text-2xl font-semibold">{["Where should we come?", "Choose your treatment", "Pick a time", "Choose your therapist", "Review your visit", "How you'll pay"][d.step]}</h1></div>
      </div>
      <div className="mb-6"><Stepper steps={STEPS} current={d.step} testid="booking-stepper" /></div>
      <AnimatePresence mode="wait" custom={dir} initial={false}>
        <motion.div key={d.step} custom={dir} initial={{ opacity: 0, x: dir * 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -28 }} transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}>
          <Body {...props} />
        </motion.div>
      </AnimatePresence>
      <div className="fixed inset-x-3 bottom-[84px] md:bottom-5 z-40">
        <div data-testid="booking-summary-bar" className="max-w-2xl mx-auto rounded-full bg-nb-ink text-white pl-5 pr-1.5 h-16 flex items-center gap-3 shadow-[0_20px_40px_-16px_rgba(11,27,63,.6)]">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-white/60 truncate">{d.serviceId ? svc(d.serviceId).name : "Your visit"}{d.time ? ` · ${fmtDate(d.date)} ${timeLabel(d.time)}` : ""}</p>
            <p className="text-sm font-semibold nb-num">{q ? (d.zoneId ? money(q.total) : `${money0(q.price)} + travel & GST`) : "Nothing selected yet"}</p>
          </div>
          <button data-testid="booking-next-btn" disabled={!valid || busy} onClick={() => (d.step === 5 ? submit() : go(d.step + 1))} className="nb-btn h-12 px-6 rounded-full bg-white text-nb-ink disabled:opacity-40">{busy ? "Booking…" : d.step === 5 ? "Confirm" : "Next"}<ArrowRight className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}
