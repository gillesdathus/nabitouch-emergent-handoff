import { Link } from "react-router-dom";
import { ArrowRight, Leaf, Dumbbell, HeartPulse, Timer, MapPin, Building2, CalendarCheck, HandHeart, Send, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { usePreview } from "@/store/PreviewStore";
import { Reveal, Avatar, IconTile, SectionHead, Field, Pill } from "@/components/ui-kit";
import { useCountdown } from "@/pages/public/Offers";
import { money0 } from "@/lib/domain";
import { wait } from "@/lib/api";

function ResumeDraft() {
  const raw = localStorage.getItem("nb-booking-draft");
  const { svc } = usePreview();
  if (!raw) return null;
  const d = JSON.parse(raw);
  if (!d.serviceId) return null;
  return (
    <Link to="/book?resume=1" data-testid="resume-booking-card" className="flex items-center gap-3 nb-card p-4 hover:-translate-y-0.5 transition-transform">
      <span className="grid place-items-center h-11 w-11 rounded-2xl tint-lagoon text-nb-blue"><RotateCcw className="h-5 w-5" /></span>
      <div className="flex-1 min-w-0"><p className="text-sm font-semibold">Pick up where you left off</p><p className="text-xs text-nb-mute truncate">{svc(d.serviceId)?.name} · step {d.step + 1} of 6</p></div>
      <ArrowRight className="h-4 w-4 text-nb-blue" />
    </Link>
  );
}

function FlashBanner() {
  const { db, svc } = usePreview();
  const c = db.campaigns.find((x) => x.status === "live");
  const left = useCountdown(c?.expiresAt);
  if (!c) return null;
  return (
    <Link to="/offers" data-testid="home-flash-banner" className="relative block overflow-hidden rounded-[28px] nb-tide text-white p-5">
      <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full nb-gradient opacity-60 blur-2xl nb-breathe" />
      <div className="relative flex items-center gap-4">
        <div className="flex-1">
          <Pill tone="bg-white/10 text-nb-turq ring-white/20">Flash offer · ends in {left}</Pill>
          <p className="mt-2 text-lg font-semibold">{c.name}</p>
          <p className="text-sm text-white/70">{svc(c.serviceId).name} tonight</p>
        </div>
        <p className="font-display text-5xl font-medium nb-gradient-text">−{c.discountPercent}%</p>
      </div>
    </Link>
  );
}

export default function Home() {
  const { db } = usePreview();
  const pub = db.services.filter((s) => s.published);
  const cats = [["Relax", Leaf, "tint-mint", "text-nb-teal"], ["Recover", Dumbbell, "tint-lagoon", "text-nb-blue"], ["Care", HeartPulse, "tint-ice", "text-nb-sky"], ["Quick reset", Timer, "tint-meadow", "text-[#4E9A2B]"]];
  return (
    <div className="max-w-6xl mx-auto px-5 pt-5 space-y-9">
      <section className="grid lg:grid-cols-[1.1fr_1fr] gap-6 items-stretch">
        <Reveal className="flex flex-col justify-center order-2 lg:order-1">
          <Pill tone="bg-white text-nb-teal ring-nb-turq/30" className="self-start"><MapPin className="h-3 w-3" />Mobile massage · Edmonton</Pill>
          <h1 className="mt-4 text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05]">Relax, recover —<br /><span className="font-display italic font-normal nb-gradient-text">anywhere.</span></h1>
          <p className="mt-4 text-nb-mute max-w-md">Registered therapists come to your home, hotel or office with everything needed. Travel and GST are always shown separately.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/book" data-testid="hero-book-btn" className="nb-btn-primary">Book a massage<ArrowRight className="h-4 w-4" /></Link>
            <Link to="/services" data-testid="hero-services-btn" className="nb-btn-ghost h-12">Explore services</Link>
          </div>
        </Reveal>
        <Reveal i={1} className="order-1 lg:order-2 relative rounded-[32px] overflow-hidden min-h-[260px] lg:min-h-[440px]">
          <img src="/img/hero.jpg" alt="Massage at home" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-nb-ink/60 via-transparent" />
          <div className="absolute bottom-4 left-4 right-4 nb-glass rounded-3xl p-3 flex items-center gap-3">
            <div className="flex -space-x-2">{db.practitioners.filter((p) => p.bookable).map((p) => <Avatar key={p.id} src={p.photo} name={p.name} size={34} />)}</div>
            <p className="text-xs text-nb-ink flex-1"><span className="font-semibold">Therapists available today</span><br />Next opening shown at booking</p>
            <CalendarCheck className="h-5 w-5 text-nb-teal" />
          </div>
        </Reveal>
      </section>
      <ResumeDraft />
      <section>
        <SectionHead title="What does your body need?" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {cats.map(([l, I, t, ic], i) => <Reveal key={l} i={i}><IconTile testid={`cat-${l}`} icon={I} label={l} sub={`${pub.filter((s) => s.category === l || (l === "Quick reset" && s.duration <= 45)).length} treatments`} tint={t} iconClass={ic} onClick={() => (window.location.href = "/services")} /></Reveal>)}
        </div>
      </section>
      <FlashBanner />
      <section>
        <SectionHead title="Popular treatments" action="See all" onAction={() => (window.location.href = "/services")} testid="see-all-services" />
        <div className="flex gap-4 overflow-x-auto no-scrollbar -mx-5 px-5 snap-x pb-2">
          {pub.slice(0, 6).map((s) => (
            <Link key={s.id} to={`/services/${s.slug}`} data-testid={`home-service-${s.slug}`} className="snap-start shrink-0 w-56 nb-card overflow-hidden group">
              <div className="h-36 overflow-hidden"><img src={s.img} alt={s.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" /></div>
              <div className="p-4"><p className="font-semibold text-sm">{s.name}</p><p className="text-xs text-nb-mute mt-0.5">{s.duration} min · from {money0(s.price)}</p></div>
            </Link>
          ))}
        </div>
      </section>
      <section className="grid sm:grid-cols-3 gap-3">
        {[[MapPin, "Tell us where", "Home, hotel or office within our Edmonton zones."], [HandHeart, "Pick your treatment", "See the treatment, travel and GST before you confirm."], [CalendarCheck, "Relax", "Track your therapist's arrival on the day."]].map(([I, t, b], i) => (
          <Reveal key={t} i={i} className="nb-soft p-5"><span className="text-xs font-bold text-nb-teal">0{i + 1}</span><I className="h-5 w-5 text-nb-blue mt-2" /><p className="font-semibold mt-2">{t}</p><p className="text-sm text-nb-mute mt-1">{b}</p></Reveal>
        ))}
      </section>
      <section className="grid sm:grid-cols-2 gap-3 pb-6">
        <Link to="/practitioners" data-testid="home-practitioners-link" className="nb-card p-5 flex items-center gap-4 hover:-translate-y-0.5 transition-transform">
          <div className="flex -space-x-3">{db.practitioners.filter((p) => p.bookable).map((p) => <Avatar key={p.id} src={p.photo} name={p.name} size={44} />)}</div>
          <div className="flex-1"><p className="font-semibold">Meet our therapists</p><p className="text-xs text-nb-mute">Profiles, specialties and open times</p></div><ArrowRight className="h-4 w-4 text-nb-blue" />
        </Link>
        <div data-testid="clinic-tile-disabled" className="rounded-3xl bg-slate-100 p-5 flex items-center gap-4 opacity-80">
          <span className="grid place-items-center h-11 w-11 rounded-2xl bg-white text-nb-mute"><Building2 className="h-5 w-5" /></span>
          <div><p className="font-semibold text-nb-mute">In-clinic visits</p><p className="text-xs text-nb-mute">Not available for online booking yet</p></div>
        </div>
      </section>
    </div>
  );
}

export function Contact() {
  const [busy, setBusy] = useState(false);
  const send = async (e) => { e.preventDefault(); setBusy(true); await wait(); setBusy(false); toast.success("Message received (preview — nothing was sent)"); e.target.reset(); };
  return (
    <div className="max-w-xl mx-auto px-5 pt-6">
      <h1 className="text-4xl font-semibold tracking-tight">Say <span className="font-display italic font-normal nb-gradient-text">hello</span></h1>
      <p className="text-nb-mute mt-2 mb-6">Questions about a visit, gift or corporate wellness? We reply within one business day.</p>
      <form onSubmit={send} className="nb-card p-5" data-testid="contact-form">
        <Field label="Name"><input required className="nb-input" data-testid="contact-name" /></Field>
        <Field label="Email"><input required type="email" className="nb-input" data-testid="contact-email" /></Field>
        <Field label="Message"><textarea required rows={4} className="nb-input h-auto py-3" data-testid="contact-message" /></Field>
        <button disabled={busy} data-testid="contact-submit" className="nb-btn-primary w-full"><Send className="h-4 w-4" />{busy ? "Sending…" : "Send message"}</button>
      </form>
    </div>
  );
}
