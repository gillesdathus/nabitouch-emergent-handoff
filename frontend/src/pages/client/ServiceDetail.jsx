import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Building2, Check, Home as HomeIcon, Info } from "lucide-react";
import { PromoBanner } from "@/components/client";
import { CatalogueImage } from "@/components/ui-kit";
import { EmptyState, TideAvatar } from "@/components/tide";
import { useDemo } from "@/store/DemoStore";
import { money, publiclyBookable, quote, welcomeOfferListed, bookableCatalogueService, clinicBookable } from "@/lib/domain";

export default function ServiceDetail() {
  const { slug } = useParams();
  const { idx, state, me, patchDraft, user } = useDemo();
  const nav = useNavigate();
  const service = idx.services[slug];
  const durations = service ? Object.keys(service.prices || {}) : [];
  const [duration, setDuration] = useState(durations.includes("60") ? "60" : durations[0]);
  const preview = user?.role === "owner" && service && !bookableCatalogueService(service);
  if (!service || (!bookableCatalogueService(service) && !preview)) {
    return <EmptyState title="Treatment not found" body="It may be unpublished." testid="service-not-found" action={<Link to="/services" className="nb-btn-ghost">Back to services</Link>} />;
  }
  const priced = quote({ service, duration, client: me, promotions: state.promotions, settings: idx.settings });
  const welcome = state.promotions.find((promo) => promo.id === "promo-welcome");
  const eligible = welcomeOfferListed(welcome);
  const practitioners = state.practitioners.filter((person) => publiclyBookable(person) && (person.specialties || []).includes(slug));
  const book = (practitionerId) => { patchDraft({ serviceSlug: slug, duration: Number(duration), practitionerId: practitionerId || "", step: 0 }); nav("/book"); };

  return (
    <div className="mx-auto max-w-5xl px-5 pt-5">
      <div className="relative h-64 overflow-hidden rounded-[32px] sm:h-80">
        <CatalogueImage src={service.img} alt={service.name} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-nb-ink/80 via-nb-ink/10" />
        <Link to="/services" data-testid="service-back-link" className="absolute left-4 top-4 grid h-10 w-10 place-items-center rounded-full nb-glass"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="absolute bottom-5 left-5 right-5 text-white">
          {preview && <p className="mb-2 inline-flex rounded-full bg-amber-300 px-3 py-1 text-xs font-bold text-nb-ink" data-testid="service-preview-banner">Preview — not bookable</p>}
          <p className="nb-eyebrow !text-nb-turq">{service.category || "Treatment"}</p>
          <h1 className="mt-1 text-3xl font-semibold sm:text-4xl" data-testid="service-title">{service.name}</h1>
          <p className="mt-1 text-sm text-white/80">{duration} min · {money(service.prices[duration])} treatment</p>
        </div>
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <p className="leading-relaxed text-nb-mute">{service.description}</p>
          <div>
            <p className="nb-eyebrow mb-2">Benefits</p>
            <div className="flex flex-wrap gap-2">{(service.benefits || []).map((benefit) => <span key={benefit} className="nb-chip-off h-8 text-xs"><Check className="h-3 w-3 text-nb-teal" />{benefit}</span>)}</div>
            <p className="mt-3 flex gap-2 text-xs text-slate-500"><Info className="h-3.5 w-3.5 shrink-0" />Everyone responds differently. Benefits are not guaranteed medical outcomes.</p>
          </div>
          {(service.goals || []).length > 0 && (
            <div>
              <p className="nb-eyebrow mb-2">Great for</p>
              <div className="flex flex-wrap gap-2">{service.goals.map((goal) => <span key={goal} className="rounded-full bg-sky-50 px-3 py-1.5 text-sm text-nb-navy">{goal}</span>)}</div>
            </div>
          )}
          {(service.prep || []).length > 0 && (
            <div className="p-5 nb-soft">
              <p className="nb-eyebrow mb-2">Before your visit</p>
              <ul className="space-y-1 text-sm text-nb-mute">{service.prep.map((step) => <li key={step}>· {step}</li>)}</ul>
            </div>
          )}
          {practitioners.length > 0 && (
            <div>
              <p className="nb-eyebrow mb-2">Therapists</p>
              <div className="flex flex-wrap gap-3">{practitioners.map((person) => (
                <button key={person.id} type="button" onClick={() => book(person.id)} data-testid={`service-pract-${person.id}`} className="nb-card flex items-center gap-2 px-3 py-2 text-left">
                  <TideAvatar person={person} size={32} /><span className="text-sm font-medium">{person.name.split(" ")[0]}</span>
                </button>
              ))}</div>
              <p className="mt-2 text-[11px] text-slate-500"><Link to="/practitioners" className="font-semibold text-nb-blue">See practitioner profiles</Link></p>
            </div>
          )}
        </div>
        <aside className="h-fit space-y-4 md:sticky md:top-28">
          <div className="nb-card p-5" data-testid="service-price-card">
            <p className="text-sm text-nb-mute">Choose duration</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {durations.map((item) => (
                <button key={item} type="button" onClick={() => setDuration(item)} data-testid={`service-duration-${item}`} className={`rounded-2xl border-2 py-3 text-center ${duration === item ? "border-nb-blue bg-sky-50" : "border-sky-100"}`}>
                  <span className="block text-sm font-semibold">{item} min</span>
                  <span className="text-xs text-nb-mute">{money(service.prices[item])}</span>
                </button>
              ))}
            </div>
            <p className="mt-5 text-sm text-nb-mute">Treatment</p>
            <p className="nb-num text-3xl font-semibold">{money(priced.treatmentAfterDiscount)}</p>
            <div className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-nb-mute">Listed price</span><span>{money(priced.base)}</span></div>
              {priced.discount > 0 && <div className="flex justify-between font-medium text-nb-teal" data-testid="service-discount-line"><span>Welcome discount (20%)</span><span>−{money(priced.discount)}</span></div>}
              <p className="text-xs text-nb-mute">Travel depends on your zone. GST 5% is added at review. This is not the final server quote.</p>
            </div>
            <div className="mt-4 flex gap-2 text-xs">
              {service.mobile !== false && <span className="flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-teal-800"><HomeIcon className="h-3 w-3" />Mobile visits</span>}
              {clinicBookable(idx.settings?.clinic) && service.clinic && <span className="flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-nb-navy"><Building2 className="h-3 w-3" />In clinic</span>}
            </div>
            <button type="button" onClick={() => book()} disabled={preview} data-testid="service-book-btn" className="nb-btn-primary mt-4 w-full disabled:opacity-50">{preview ? "Preview only" : "Book this treatment"}<ArrowRight className="h-4 w-4" /></button>
          </div>
          <PromoBanner compact eligible={eligible} testid="service-promo-banner" />
        </aside>
      </div>
    </div>
  );
}
