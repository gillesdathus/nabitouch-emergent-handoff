import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Languages, CalendarDays } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { Reveal, PageHeader, Pill, EmptyState } from "@/components/ui-kit";
import { DayStrip } from "@/components/Calendar";
import { freeSlots } from "@/lib/schedule";
import { timeLabel, todayISO, fmtDate } from "@/lib/domain";

export default function Practitioners() {
  const { db, svc } = usePreview();
  return (
    <div className="max-w-6xl mx-auto px-5 pt-6">
      <PageHeader eyebrow="Our team" title="Therapists" sub="Only fully credentialed therapists appear here." />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {db.practitioners.filter((p) => p.bookable).map((p, i) => (
          <Reveal key={p.id} i={i}>
            <Link to={`/practitioners/${p.slug}`} data-testid={`practitioner-card-${p.slug}`} className="block relative rounded-[28px] overflow-hidden tint-ice h-64 group">
              <img src={p.photo} alt={p.name} className="absolute right-0 bottom-0 h-full w-3/5 object-cover object-top transition-transform duration-500 group-hover:scale-105 [mask-image:linear-gradient(to_left,black_65%,transparent)]" />
              <div className="relative p-5 h-full flex flex-col">
                <Pill tone="bg-white text-nb-teal ring-nb-turq/30" className="self-start">{svc(p.specialties[0]).name}</Pill>
                <p className="mt-3 text-xl font-semibold leading-tight max-w-[50%]">{p.name}</p>
                <p className="text-xs text-nb-mute mt-1 max-w-[50%]">{p.years} years · {p.languages.join(", ")}</p>
                <span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-nb-blue">View profile<ArrowRight className="h-4 w-4" /></span>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

export function PractitionerPublic() {
  const { slug } = useParams();
  const { db, svc } = usePreview();
  const nav = useNavigate();
  const p = db.practitioners.find((x) => x.slug === slug && x.bookable);
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("");
  if (!p) return <EmptyState title="Profile not available" testid="practitioner-not-found" />;
  const slots = freeSlots(db, [p.id], date, 60);
  return (
    <div className="max-w-4xl mx-auto px-5 pt-5 pb-10">
      <div className="relative rounded-[32px] overflow-hidden tint-ice h-72 sm:h-80">
        <div className="absolute inset-0 bg-gradient-to-br from-nb-cyan/25 via-transparent to-nb-turq/30" />
        <img src={p.photo} alt={p.name} className="absolute right-0 bottom-0 h-full w-[55%] object-cover object-top [mask-image:linear-gradient(to_left,black_70%,transparent)]" />
        <div className="relative p-5 sm:p-7 h-full flex flex-col">
          <Link to="/practitioners" data-testid="practitioner-back" className="h-10 w-10 grid place-items-center rounded-full bg-white/80"><ArrowLeft className="h-4 w-4" /></Link>
          <Pill tone="bg-white text-nb-teal ring-nb-turq/30" className="self-start mt-4">{p.title}</Pill>
          <h1 className="mt-3 text-3xl sm:text-4xl font-semibold leading-tight max-w-[50%]">{p.name}</h1>
          <p className="text-sm text-nb-mute mt-1 flex items-center gap-1"><Languages className="h-3.5 w-3.5" />{p.languages.join(" · ")}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 -mt-8 mx-4 relative rounded-3xl nb-glass shadow-xl py-4 text-center">
        {[[`${p.years}+`, "Years"], [p.specialties.length, "Treatments"], [p.languages.length, "Languages"]].map(([v, l]) => <div key={l}><p className="text-2xl font-semibold nb-num">{v}</p><p className="text-[11px] text-nb-mute">{l}</p></div>)}
      </div>
      <p className="text-nb-mute leading-relaxed mt-6">{p.bio}</p>
      <div className="flex flex-wrap gap-2 mt-3">{p.specialties.map((s) => <span key={s} className="nb-chip-off h-8 text-xs">{svc(s).name}</span>)}</div>
      <div className="nb-card p-5 mt-6" data-testid="practitioner-booking-card">
        <div className="flex items-center justify-between mb-3"><p className="font-semibold">Book with {p.name.split(" ")[0]}</p><span className="text-xs text-nb-mute flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{fmtDate(date)}</span></div>
        <DayStrip value={date} onChange={(d) => { setDate(d); setTime(""); }} start={todayISO()} testid="pp-day-strip" />
        <p className="text-sm font-medium mt-4 mb-2">Choose a suitable time</p>
        <div className="grid grid-cols-3 gap-2">
          {slots.length === 0 && <p className="col-span-3 text-sm text-nb-mute">No open times this day.</p>}
          {slots.slice(0, 9).map((s) => <button key={s.time} data-testid={`pp-slot-${s.time}`} onClick={() => setTime(s.time)} className={time === s.time ? "nb-chip-on justify-center" : "nb-chip-off justify-center"}>{timeLabel(s.time)}</button>)}
        </div>
        <button data-testid="pp-book-btn" disabled={!time} onClick={() => nav(`/book?pro=${p.id}&date=${date}&time=${time}`)} className="nb-btn-primary w-full mt-5">{time ? `Continue · ${timeLabel(time)}` : "Pick a time"}</button>
      </div>
    </div>
  );
}
