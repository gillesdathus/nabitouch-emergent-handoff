import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Clock, Check, ArrowLeft, ArrowRight } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { Reveal, Segmented, PageHeader, EmptyState, Avatar } from "@/components/ui-kit";
import { money0 } from "@/lib/domain";

export default function Services() {
  const { db } = usePreview();
  const [cat, setCat] = useState("all");
  const list = db.services.filter((s) => s.published && (cat === "all" || s.category === cat));
  return (
    <div className="max-w-6xl mx-auto px-5 pt-6">
      <PageHeader eyebrow="Catalogue" title="Treatments" sub="Prices are for the treatment. Travel and GST are added separately." />
      <Segmented testid="service-filter" value={cat} onChange={setCat} options={[{ value: "all", label: "All" }, { value: "Relax", label: "Relax" }, { value: "Recover", label: "Recover" }, { value: "Care", label: "Care" }]} className="mb-5" />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.map((s, i) => (
          <Reveal key={s.id} i={i}>
            <Link to={`/services/${s.slug}`} data-testid={`service-card-${s.slug}`} className="block nb-card overflow-hidden group">
              <div className="h-44 overflow-hidden relative"><img src={s.img} alt={s.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" /><span className="absolute top-3 left-3 nb-glass rounded-full px-3 h-7 grid place-items-center text-xs font-semibold"><span className="flex items-center gap-1"><Clock className="h-3 w-3" />{s.duration} min</span></span></div>
              <div className="p-4 flex items-end justify-between gap-3"><div><p className="font-semibold">{s.name}</p><p className="text-xs text-nb-mute mt-1 line-clamp-2">{s.blurb}</p></div><p className="text-lg font-semibold nb-num shrink-0">{money0(s.price)}</p></div>
            </Link>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

export function ServiceDetail() {
  const { slug } = useParams();
  const { db } = usePreview();
  const s = db.services.find((x) => x.slug === slug && x.published);
  if (!s) return <EmptyState title="Treatment not found" body="It may be unpublished." testid="service-not-found" action={<Link to="/services" className="nb-btn-ghost">Back to services</Link>} />;
  const pros = db.practitioners.filter((p) => p.bookable && p.specialties.includes(s.id));
  return (
    <div className="max-w-5xl mx-auto px-5 pt-5">
      <div className="relative rounded-[32px] overflow-hidden h-64 sm:h-80">
        <img src={s.img} alt={s.name} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-nb-ink/80 via-nb-ink/10" />
        <Link to="/services" data-testid="service-back" className="absolute top-4 left-4 h-10 w-10 grid place-items-center rounded-full nb-glass"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="absolute bottom-5 left-5 right-5 text-white"><p className="nb-eyebrow !text-nb-turq">{s.category}</p><h1 className="text-3xl sm:text-4xl font-semibold mt-1">{s.name}</h1><p className="text-white/80 text-sm mt-1">{s.duration} min · {money0(s.price)} treatment</p></div>
      </div>
      <div className="grid md:grid-cols-[1.4fr_1fr] gap-5 mt-5">
        <div className="space-y-5">
          <p className="text-nb-mute leading-relaxed">{s.blurb}</p>
          <div><p className="nb-eyebrow mb-2">Benefits</p><div className="flex flex-wrap gap-2">{s.benefits.map((b) => <span key={b} className="nb-chip-off h-8 text-xs"><Check className="h-3 w-3 text-nb-teal" />{b}</span>)}</div></div>
          {s.prep.length > 0 && <div><p className="nb-eyebrow mb-2">Before your visit</p><ul className="text-sm text-nb-mute space-y-1">{s.prep.map((p) => <li key={p}>· {p}</li>)}</ul></div>}
          <div><p className="nb-eyebrow mb-2">Therapists</p><div className="flex gap-3">{pros.map((p) => <Link key={p.id} to={`/practitioners/${p.slug}`} className="flex items-center gap-2 nb-card px-3 py-2"><Avatar src={p.photo} name={p.name} size={32} /><span className="text-sm font-medium">{p.name.split(" ")[0]}</span></Link>)}</div></div>
        </div>
        <div className="nb-card p-5 h-fit md:sticky md:top-28">
          <p className="text-sm text-nb-mute">Treatment</p><p className="text-3xl font-semibold nb-num">{money0(s.price)}</p>
          <p className="text-xs text-nb-mute mt-1">Travel fee depends on your zone. GST 5% is added at review.</p>
          <Link to={`/book?service=${s.id}`} data-testid="service-book-btn" className="nb-btn-primary w-full mt-4">Book this treatment<ArrowRight className="h-4 w-4" /></Link>
        </div>
      </div>
    </div>
  );
}
