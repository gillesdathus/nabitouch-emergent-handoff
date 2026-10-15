import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CatalogueImage } from "@/components/ui-kit";
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
  const book = () => {
    patchDraft({ practitionerId: person.id, step: 0 });
    nav("/book");
  };
  return (
    <article className="mx-auto max-w-4xl px-5 pb-10 pt-5" data-testid={`practitioner-profile-${person.id}`}>
      {owner && profileVisibility(person) !== "published" && <p className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="profile-preview-banner">This profile is {profileVisibility(person)}. Visitors cannot see it, and it cannot accept bookings.</p>}
      <div className="relative h-72 overflow-hidden rounded-[32px] sm:h-80 tint-ice">
        <div className="absolute inset-0 bg-gradient-to-br from-nb-cyan/25 via-transparent to-nb-turq/30" />
        <CatalogueImage src={person.photo} alt="" size="thumb" className="absolute bottom-0 right-0 h-full w-[55%] object-cover object-top" />
        <div className="relative flex h-full flex-col p-5 sm:p-7">
          <Link to="/practitioners" data-testid="practitioner-back" className="grid h-10 w-10 place-items-center rounded-full bg-white/80"><span className="text-sm font-semibold text-nb-blue">Back</span></Link>
          <p className="nb-eyebrow mt-4">Mobile massage</p>
          <h1 className="mt-2 max-w-[58%] text-3xl font-semibold leading-tight sm:text-4xl">{person.name}</h1>
          {person.designation && <p className="mt-1 text-sm text-nb-navy">{person.designation}</p>}
        </div>
      </div>
      <div className="relative z-10 mx-4 -mt-8 grid grid-cols-3 rounded-3xl py-4 text-center shadow-xl nb-glass">
        <div><p className="nb-num text-2xl font-semibold">{services.length}</p><p className="text-[11px] text-nb-mute">Treatments</p></div>
        <div><p className="nb-num text-2xl font-semibold">{(person.qualifications || []).length || "—"}</p><p className="text-[11px] text-nb-mute">Credentials</p></div>
        <div><p className="text-sm font-semibold">{publiclyBookable(person) ? "Open" : "Closed"}</p><p className="text-[11px] text-nb-mute">Booking</p></div>
      </div>
      <p className="mt-6 text-base leading-relaxed text-nb-ink">{publicBio(person.bio)}</p>
      {person.experience && <section className="mt-6"><h2 className="font-semibold text-nb-ink">Experience</h2><p className="mt-2 text-sm leading-relaxed text-nb-mute">{person.experience}</p></section>}
      {(person.qualifications || []).length > 0 && (
        <section className="mt-6">
          <h2 className="font-semibold text-nb-ink">Qualifications</h2>
          <ul className="mt-2 space-y-1 text-sm text-nb-mute">{person.qualifications.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      )}
      {services.length > 0 && (
        <section className="mt-6">
          <h2 className="font-semibold text-nb-ink">Treatments</h2>
          <div className="mt-3 flex flex-wrap gap-2">{services.map((service) => <Link key={service.slug} to={`/services/${service.slug}`} className="rounded-full bg-sky-50 px-3 py-1.5 text-sm font-medium text-nb-navy">{service.name}</Link>)}</div>
        </section>
      )}
      {(person.gallery || []).length > 0 && (
        <section className="mt-6" aria-label="Gallery">
          <h2 className="font-semibold text-nb-ink">Gallery</h2>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {(person.gallery || []).slice(0, 6).map((item) => <CatalogueImage key={item.id} src={item.src} alt="" size="thumb" className="aspect-square w-full rounded-xl object-cover" />)}
          </div>
        </section>
      )}
      <div className="mt-8">
        {publiclyBookable(person) ? <button type="button" className="nb-btn-primary h-12 px-6" onClick={book} data-testid={`profile-book-${person.id}`}>Book with {person.name.split(" ")[0]}</button> : <p className="text-sm text-nb-mute" data-testid={`profile-unavailable-${person.id}`}>This profile is visible, and booking is not open.</p>}
      </div>
    </article>
  );
}
