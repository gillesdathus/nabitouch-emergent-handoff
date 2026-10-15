import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Clock } from "lucide-react";
import { CatalogueImage } from "@/components/ui-kit";
import { PromoBanner, StickyBook } from "@/components/client";
import { EmptyState, PageHeader, Reveal, Segmented } from "@/components/tide";
import { useDemo } from "@/store/DemoStore";
import { bookableCatalogueService, money, welcomeOfferListed } from "@/lib/domain";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "relax", label: "Relax" },
  { value: "therapeutic", label: "Recover" },
  { value: "gentle", label: "Care" },
  { value: "quick", label: "Quick" },
];

const match = (filter, service) => filter === "all"
  || (filter === "relax" && ["swedish", "hot-stone", "scalp", "foot-reflexology", "mobile"].includes(service.slug))
  || (filter === "therapeutic" && ["deep-tissue", "sports", "mobile"].includes(service.slug))
  || (filter === "gentle" && ["prenatal", "senior", "hand-arm"].includes(service.slug))
  || (filter === "quick" && service.prices?.["30"]);

function fromPrice(service) {
  const values = Object.values(service.prices || {}).map(Number);
  return values.length ? Math.min(...values) : 0;
}

function leadDuration(service) {
  const keys = Object.keys(service.prices || {});
  return keys.includes("60") ? "60" : keys[0] || service.duration || "";
}

export default function Services() {
  const { state } = useDemo();
  const nav = useNavigate();
  const [filter, setFilter] = useState("all");
  const welcome = state.promotions.find((promo) => promo.id === "promo-welcome");
  const eligible = welcomeOfferListed(welcome);
  const list = state.services.filter((service) => bookableCatalogueService(service) && match(filter, service));
  return (
    <div className="mx-auto max-w-6xl px-5 pt-6">
      <PageHeader eyebrow="Catalogue" title="Treatments" sub="Prices are for the treatment. Travel and GST are added separately at review." />
      <div className="mb-4"><PromoBanner compact eligible={eligible} testid="services-promo-banner" /></div>
      <Segmented testid="services-filter" value={filter} onChange={setFilter} options={FILTERS} className="mb-5" />
      {list.length === 0 && <EmptyState title="No treatments in this group" body="Try another filter, or book from the full catalogue." />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="services-grid">
        {list.map((service, index) => (
          <Reveal key={service.slug} i={index}>
            <Link to={`/services/${service.slug}`} data-testid={`service-card-${service.slug}`} className="nb-card group block overflow-hidden">
              <div className="relative h-44 overflow-hidden">
                <CatalogueImage src={service.img} alt={service.name} size="thumb" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                <span className="absolute left-3 top-3 grid h-7 place-items-center rounded-full px-3 text-xs font-semibold nb-glass"><span className="flex items-center gap-1"><Clock className="h-3 w-3" />{leadDuration(service)} min</span></span>
                {eligible && <span className="absolute right-3 top-3 rounded-full bg-nb-lime px-2.5 py-1 text-[10px] font-bold text-nb-ink">Welcome offer</span>}
              </div>
              <div className="flex items-end justify-between gap-3 p-4">
                <div><p className="font-semibold">{service.name}</p><p className="mt-1 line-clamp-2 text-xs text-nb-mute">{service.short}</p></div>
                <p className="nb-num shrink-0 text-lg font-semibold">{money(fromPrice(service))}</p>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
      <StickyBook onClick={() => nav("/book")} />
    </div>
  );
}
