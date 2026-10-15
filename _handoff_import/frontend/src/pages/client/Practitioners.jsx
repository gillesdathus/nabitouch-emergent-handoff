import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { CatalogueImage } from "@/components/ui-kit";
import { EmptyState, PageHeader, Reveal } from "@/components/tide";
import { useDemo } from "@/store/DemoStore";
import { practitionerSlug, profileVisibility, publicBio } from "@/lib/domain";

export default function Practitioners() {
  const { state, idx } = useDemo();
  const people = [...state.practitioners]
    .filter((person) => profileVisibility(person) === "published")
    .sort((a, b) => (a.displayOrder ?? 100) - (b.displayOrder ?? 100) || a.name.localeCompare(b.name));
  return (
    <div className="mx-auto max-w-6xl px-5 pt-6" data-testid="practitioners-page">
      <PageHeader eyebrow="Our team" title="Therapists" sub="Published profiles only. Booking opens when credentials, schedule, and availability are valid." />
      {people.length === 0 && <EmptyState title="No published profiles yet" body="Therapists appear here after the owner publishes them." />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {people.map((person, index) => {
          const specialty = idx.services[(person.specialties || [])[0]]?.name;
          return (
            <Reveal key={person.id} i={index}>
              <Link to={`/practitioners/${practitionerSlug(person)}`} data-testid={`practitioner-card-${person.id}`} className="group relative block h-64 overflow-hidden rounded-[28px] tint-ice">
                <CatalogueImage src={person.photo} alt="" size="thumb" className="absolute bottom-0 right-0 h-full w-3/5 object-cover object-top transition-transform duration-500 group-hover:scale-105" />
                <div className="relative flex h-full flex-col p-5">
                  {specialty && <span className="inline-flex h-6 w-fit items-center rounded-full bg-white px-2.5 text-[11px] font-semibold text-nb-teal ring-1 ring-inset ring-nb-turq/30">{specialty}</span>}
                  <p className="mt-3 max-w-[52%] text-xl font-semibold leading-tight">{person.name}</p>
                  <p className="mt-1 max-w-[52%] text-xs text-nb-mute">{person.designation || publicBio(person.bio)}</p>
                  <span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-nb-blue" data-testid={`practitioner-open-${person.id}`}>View profile<ArrowRight className="h-4 w-4" /></span>
                </div>
              </Link>
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}
