import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Building2, CalendarCheck, Dumbbell, HandHeart, HeartPulse, Leaf, MapPin, RotateCcw, Timer } from "lucide-react";
import { PromoBanner } from "@/components/client";
import { AddressPicker } from "@/components/AddressPicker";
import { CatalogueImage } from "@/components/ui-kit";
import { IconTile, Notice, PageHeader, Reveal, TideAvatar } from "@/components/tide";
import { useDemo } from "@/store/DemoStore";
import { api } from "@/lib/api";
import { bookableCatalogueService, clinicBookable, money, promoBannerCopy, publiclyBookable, trialCampaignVisible, welcomeOfferVisible } from "@/lib/domain";

const GROUPS = [
  ["Relax", Leaf, "tint-mint", "text-nb-teal", (service) => /relax/i.test(service.category || service.name || "") || ["swedish", "hot-stone", "scalp", "foot-reflexology"].includes(service.slug)],
  ["Recover", Dumbbell, "tint-lagoon", "text-nb-blue", (service) => /recover|therapeutic|sport/i.test(`${service.category || ""} ${service.name || ""}`) || ["deep-tissue", "sports"].includes(service.slug)],
  ["Care", HeartPulse, "tint-ice", "text-nb-sky", (service) => /care|gentle|prenatal|senior/i.test(`${service.category || ""} ${service.name || ""}`) || ["prenatal", "senior", "hand-arm"].includes(service.slug)],
  ["Quick reset", Timer, "tint-meadow", "text-[#4E9A2B]", (service) => !!service.prices?.["30"] || Number(service.duration) <= 45],
];

function priceFrom(service) {
  const values = Object.values(service.prices || {});
  return values.length ? Math.min(...values.map(Number)) : 0;
}

function minutesOf(service) {
  const keys = Object.keys(service.prices || {});
  if (keys.length) return keys.includes("60") ? "60" : keys[0];
  return service.duration || "";
}

export default function Home() {
  const { state, patchDraft, draft, idx } = useDemo();
  const nav = useNavigate();
  const [query, setQuery] = useState(draft.addressQuery || "");
  const [campaigns, setCampaigns] = useState([]);
  const eligibility = state.offerEligibility;
  const welcome = state.promotions.find((promo) => promo.id === "promo-welcome");
  const eligible = welcomeOfferVisible(welcome, "home", eligibility);
  const welcomeCopy = promoBannerCopy(welcome);
  const welcomeBadge = welcome?.type === "percent" ? `${Number(welcome.value) || 0}%` : (welcome ? money(welcome.value) : "");
  const services = state.services.filter(bookableCatalogueService);
  const people = state.practitioners.filter(publiclyBookable);
  const clinicOpen = clinicBookable(idx.settings?.clinic);
  const trial = campaigns.find((row) => trialCampaignVisible(row, "home", eligibility));
  const flash = campaigns.find((row) => row.offerKind !== "trial" && row.showHome !== false);
  const resume = draft.serviceSlug && draft.step > 0;

  useEffect(() => {
    let live = true;
    api.publicCampaigns().then((body) => { if (live) setCampaigns(body.campaigns || []); }).catch(() => {});
    return () => { live = false; };
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-9 px-5 pt-5">
      {(trial || eligible) && (
        <section className="grid gap-3 sm:grid-cols-2" data-testid="home-featured-offers">
          {trial && (
            <Link
              to="/book"
              data-testid="home-trial-card"
              className="flex items-center gap-4 rounded-[28px] px-4 py-4 text-white shadow-[0_18px_40px_-16px_rgba(11,46,138,0.55)] nb-tide sm:px-5"
              onClick={() => patchDraft({
                campaignId: trial.id,
                serviceSlug: trial.serviceSlug || "ten-minutes-on-us",
                duration: trial.durationMinutes || trial.complimentaryMinutes || 10,
                locationType: (trial.locationTypes || []).includes("home") ? "home" : ((trial.locationTypes || ["home"])[0] || "home"),
                practitionerId: trial.practitionerId || undefined,
                date: trial.bookingStart,
                step: 0,
                idempotencyKey: `cmp-${trial.id}-${Date.now()}`,
              })}
            >
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white/15 text-lg font-bold leading-none">FREE</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-bold uppercase tracking-[0.16em] text-nb-turq">Free trial</span>
                <span className="mt-1 block text-base font-semibold leading-tight sm:text-lg">{trial.headline || "Try Nabitouch. 10 Minutes. On Us."}</span>
                <span className="mt-1 block text-sm text-white/75">{trial.ctaLabel || "Claim my free 10 minutes"}</span>
              </span>
              <ArrowRight className="h-5 w-5 shrink-0 text-nb-turq" />
            </Link>
          )}
          {eligible && (
            <Link to="/book" data-testid="hero-promo-chip" className="flex items-center gap-4 rounded-[28px] px-4 py-4 text-white shadow-[0_18px_40px_-16px_rgba(11,46,138,0.75)] nb-lagoon sm:px-5">
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-nb-lime text-xl font-bold leading-none text-nb-ink">{welcomeBadge}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-bold uppercase tracking-[0.16em] text-nb-lime">20% off</span>
                <span className="mt-1 block text-base font-semibold leading-tight sm:text-lg">{welcomeCopy.headline}</span>
                <span className="mt-1 block text-sm font-medium text-white/80">{welcomeCopy.cta}</span>
              </span>
              <ArrowRight className="h-5 w-5 shrink-0 text-nb-lime" />
            </Link>
          )}
        </section>
      )}
      <section className="grid items-stretch gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Reveal className="order-2 flex flex-col justify-center lg:order-1">
          <span data-testid="hero-mobile-badge" className="inline-flex w-fit max-w-full flex-wrap items-center gap-x-2 gap-y-1 self-start rounded-full px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_28px_-12px_rgba(21,101,240,0.8)] nb-lagoon"><MapPin className="h-4 w-4 shrink-0 text-nb-turq" />Mobile massage<span className="font-medium text-white/80">We come to you</span></span>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl" data-testid="hero-title">Relax, recover —<br /><span className="font-display text-[1em] font-normal italic nb-gradient-text">anywhere.</span></h1>
          <p className="mt-4 max-w-md text-nb-mute">Registered therapists come to your home, hotel or office with everything needed. Confirm a service address when you book.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/book" data-testid="hero-book-btn" className="nb-btn-primary">Book a massage<ArrowRight className="h-4 w-4" /></Link>
            <Link to="/services" data-testid="hero-services-btn" className="nb-btn-ghost h-12">Explore services</Link>
          </div>
        </Reveal>
        <Reveal i={1} className="relative order-1 min-h-[260px] overflow-hidden rounded-[32px] lg:order-2 lg:min-h-[440px]">
          <img src="/img/hero.jpg" alt="A massage therapist providing a calming treatment at home" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-nb-ink/60 via-transparent" />
          <div className="absolute bottom-4 left-4 right-4 flex items-center gap-3 rounded-3xl p-3 nb-glass">
            <div className="flex -space-x-2">{people.slice(0, 4).map((person) => <TideAvatar key={person.id} person={person} size={34} />)}</div>
            <p className="flex-1 text-xs text-nb-ink"><span className="font-semibold">Therapists on the team</span><br />The next opening is shown when you book</p>
            <CalendarCheck className="h-5 w-5 text-nb-teal" />
          </div>
        </Reveal>
      </section>

      {resume && (
        <Link to="/book" data-testid="resume-booking-card" className="nb-card flex items-center gap-3 p-4 transition-transform hover:-translate-y-0.5">
          <span className="grid h-11 w-11 place-items-center rounded-2xl text-nb-blue tint-lagoon"><RotateCcw className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">Pick up where you left off</p><p className="truncate text-xs text-nb-mute">{idx.services[draft.serviceSlug]?.name || "Your visit"} · step {draft.step + 1} of 7</p></div>
          <ArrowRight className="h-4 w-4 text-nb-blue" />
        </Link>
      )}

      <section className="nb-card p-5" data-testid="area-check-card">
        <p className="text-sm font-semibold text-nb-ink">Do we come to you?</p>
        <p className="mb-3 text-xs text-nb-mute">Check whether your address is eligible for a mobile visit. The result comes from Nabitouch, not a sample list.</p>
        <AddressPicker
          testid="area-check"
          query={query}
          onQuery={setQuery}
          value={draft.address}
          onChange={(address) => {
            if (!address) {
              patchDraft({ address: null });
              return;
            }
            patchDraft({ address, addressQuery: address.line || query });
          }}
        />
      </section>

      <section>
        <PageHeader title="What does your body need?" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {GROUPS.map(([label, Icon, tint, iconClass, match], index) => (
            <Reveal key={label} i={index}>
              <IconTile testid={`cat-${label}`} icon={Icon} label={label} tint={tint} iconClass={iconClass} sub={`${services.filter(match).length} treatments`} onClick={() => nav("/services")} />
            </Reveal>
          ))}
        </div>
      </section>

      {flash && (
        <Link to="/offers" data-testid="home-flash-banner" className="relative block overflow-hidden rounded-[28px] p-5 text-white nb-tide">
          <div className="nb-breathe absolute -right-10 -top-10 h-44 w-44 rounded-full opacity-60 blur-2xl nb-gradient" />
          <div className="relative flex items-center gap-4">
            <div className="flex-1">
              <span className="inline-flex rounded-full bg-white/10 px-2.5 text-[11px] font-semibold text-nb-turq ring-1 ring-inset ring-white/20">Flash offer</span>
              <p className="mt-2 text-lg font-semibold">{flash.title}</p>
              <p className="text-sm text-white/70">{flash.soldOut ? "Sold out" : `${flash.remaining ?? "Limited"} spots`} · {flash.discountPercent}% off</p>
            </div>
            <p className="font-display text-5xl font-medium nb-gradient-text">−{flash.discountPercent}%</p>
          </div>
        </Link>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-base font-semibold text-nb-ink md:text-lg">Popular treatments</h2>
          <Link to="/services" data-testid="home-all-services" className="text-sm font-medium text-nb-blue">See all</Link>
        </div>
        <div className="no-scrollbar -mx-5 flex snap-x gap-4 overflow-x-auto px-5 pb-2">
          {services.slice(0, 6).map((service) => (
            <Link key={service.slug} to={`/services/${service.slug}`} data-testid={`home-service-${service.slug}`} className="nb-card group w-56 shrink-0 snap-start overflow-hidden">
              <div className="h-36 overflow-hidden"><CatalogueImage src={service.img} alt={service.name} size="thumb" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" /></div>
              <div className="p-4"><p className="text-sm font-semibold">{service.name}</p><p className="mt-0.5 text-xs text-nb-mute">{minutesOf(service)} min · from {money(priceFrom(service))}</p></div>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {[[MapPin, "Tell us where", "Home, hotel or office at a confirmed service address."], [HandHeart, "Pick your treatment", "See the treatment and GST before you confirm."], [CalendarCheck, "Relax", "Follow the visit when your therapist starts sharing location."]].map(([Icon, title, body], index) => (
          <Reveal key={title} i={index} className="p-5 nb-soft"><span className="text-xs font-bold text-nb-teal">0{index + 1}</span><Icon className="mt-2 h-5 w-5 text-nb-blue" /><p className="mt-2 font-semibold">{title}</p><p className="mt-1 text-sm text-nb-mute">{body}</p></Reveal>
        ))}
      </section>

      {eligible && <PromoBanner eligible={eligible} promo={welcome} testid="home-promo-banner" />}

      <section className={`grid gap-3 pb-6 ${clinicOpen ? "sm:grid-cols-2" : ""}`}>
        <Link to="/practitioners" data-testid="home-practitioners" className="nb-card flex items-center gap-4 p-5 transition-transform hover:-translate-y-0.5">
          <div className="flex -space-x-3">{people.slice(0, 3).map((person) => <TideAvatar key={person.id} person={person} size={44} />)}</div>
          <div className="flex-1"><p className="font-semibold">Meet our therapists</p><p className="text-xs text-nb-mute">Profiles, specialties and booking</p></div>
          <ArrowRight className="h-4 w-4 text-nb-blue" />
        </Link>
        {clinicOpen && <Notice tone="info" icon={Building2}>In-clinic booking is open. Choose it in the booking flow.</Notice>}
      </section>
    </div>
  );
}
