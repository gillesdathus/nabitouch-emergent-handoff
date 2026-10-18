import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BadgeCheck, CalendarPlus } from "lucide-react";
import { CatalogueImage, Avatar } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { practitionerSlug, publicBio, publiclyBookable, profileVisibility } from "@/lib/domain";

export default function PractitionerProfile() {
  const { slug } = useParams();
  const { state, idx, patchDraft, user } = useDemo();
  const nav = useNavigate();
  const person = state.practitioners.find((row) => practitionerSlug(row) === slug || row.id === slug);
  const owner = user?.role === "owner";
  useEffect(() => {
    const previous = document.title;
    const description = document.querySelector('meta[name="description"]');
    const previousDescription = description?.getAttribute("content") || "";
    if (person) {
      document.title = `${person.name}${person.designation ? `, ${person.designation}` : ""} · Nabitouch`;
      description?.setAttribute("content", publicBio(person.bio) || "Mobile massage practitioner in Edmonton.");
    }
    return () => {
      document.title = previous;
      if (description) description.setAttribute("content", previousDescription);
    };
  }, [person]);
  if (!person || (!owner && profileVisibility(person) !== "published")) {
    return <div className="mx-auto max-w-3xl px-5 py-16 text-center">Practitioner not found. <Link to="/practitioners" className="text-nb-blue">Back to practitioners</Link></div>;
  }
  const services = (person.specialties || []).map((item) => idx.services[item]).filter(Boolean);
  const quals = (person.qualifications || []).slice(0, 6);
  const book = () => {
    patchDraft({ practitionerId: person.id, step: 0 });
    nav("/book");
  };
  const first = (person.name || "").split(" ")[0] || "them";
  return (
    <article className="mx-auto max-w-3xl px-4 pb-24 pt-4 sm:px-5 sm:pb-10" data-testid={`practitioner-profile-${person.id}`}>
      {owner && profileVisibility(person) !== "published" && (
        <p className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="profile-preview-banner">
          This profile is {profileVisibility(person)}. Visitors cannot see it, and it cannot accept bookings.
        </p>
      )}

      <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0B2E8A] via-[#1565F0] to-[#14D8C4] text-white shadow-[0_20px_40px_-24px_rgba(11,46,138,0.7)]">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" aria-hidden="true" />
        <div className="relative p-5 sm:p-7">
          <Link to="/practitioners" data-testid="practitioner-back" className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold backdrop-blur">
            <ArrowLeft className="h-3.5 w-3.5" /> Practitioners
          </Link>
          <div className="mt-6 flex items-end gap-4">
            <div className="shrink-0 overflow-hidden rounded-[22px] ring-4 ring-white/30">
              {person.photo
                ? <CatalogueImage src={person.photo} alt="" size="thumb" className="h-28 w-28 object-cover sm:h-36 sm:w-36" />
                : <div className="grid h-28 w-28 place-items-center bg-white/20 sm:h-36 sm:w-36"><Avatar person={person} size={96} /></div>}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-nb-lime">Registered therapist</p>
              <h1 className="mt-1 text-2xl font-semibold leading-tight sm:text-4xl">{person.name}</h1>
              {person.designation && <p className="mt-1 text-sm text-white/85">{person.designation}</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 rounded-3xl bg-white p-3 text-center shadow-sm ring-1 ring-sky-100 sm:p-4">
        <div><p className="nb-num text-xl font-semibold sm:text-2xl">{services.length}</p><p className="text-[10px] text-nb-mute sm:text-[11px]">Treatments</p></div>
        <div><p className="nb-num text-xl font-semibold sm:text-2xl">{quals.length || "—"}</p><p className="text-[10px] text-nb-mute sm:text-[11px]">Credentials</p></div>
        <div><p className="text-sm font-semibold sm:text-base">{publiclyBookable(person) ? "Open" : "Closed"}</p><p className="text-[10px] text-nb-mute sm:text-[11px]">Booking</p></div>
      </div>

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-nb-ink">About</h2>
        <p className="mt-2 text-base leading-relaxed text-nb-ink/90">{publicBio(person.bio) || "Biography coming soon."}</p>
      </section>

      {person.experience && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-nb-ink">Experience</h2>
          <p className="mt-2 text-sm leading-relaxed text-nb-mute">{person.experience}</p>
        </section>
      )}

      {quals.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-nb-ink">Credentials summary</h2>
          <ul className="mt-3 space-y-2">
            {quals.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-nb-mute">
                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-nb-teal" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-nb-mute">Public summaries only. Registration numbers and insurance documents stay private.</p>
        </section>
      )}

      {services.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-nb-ink">Treatments</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {services.map((service) => (
              <Link key={service.slug} to={`/services/${service.slug}`} className="rounded-full bg-sky-50 px-3 py-1.5 text-sm font-medium text-nb-navy ring-1 ring-sky-100">
                {service.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {(person.gallery || []).length > 0 && (
        <section className="mt-6" aria-label="Gallery">
          <h2 className="text-lg font-semibold text-nb-ink">Gallery</h2>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {(person.gallery || []).slice(0, 6).map((item) => (
              <CatalogueImage key={item.id} src={item.src} alt="" size="thumb" className="aspect-square w-full rounded-xl object-cover" />
            ))}
          </div>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-sky-100 bg-white/95 p-4 backdrop-blur sm:static sm:mt-8 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        {publiclyBookable(person) ? (
          <button type="button" className="nb-btn-primary h-12 w-full px-6 sm:w-auto" onClick={book} data-testid={`profile-book-${person.id}`}>
            <CalendarPlus className="h-4 w-4" /> Book with {first}
          </button>
        ) : (
          <p className="text-center text-sm text-nb-mute sm:text-left" data-testid={`profile-unavailable-${person.id}`}>
            This profile is visible, and booking is not open.
          </p>
        )}
      </div>
    </article>
  );
}
