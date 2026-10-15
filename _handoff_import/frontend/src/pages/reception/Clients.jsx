import { useState } from "react";
import { Phone, Mail, Plus } from "lucide-react";
import { NewBookingDialog } from "@/components/NewBookingDialog";
import { Avatar, Pill, SectionHead } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { OPEN, fmtDate, fmtTime } from "@/lib/domain";

const complete = (i) => i.insurer && i.policy && i.memberId && i.holderName;

export default function Clients() {
  const { state, idx, perm } = useDemo();
  const [q, setQ] = useState("");
  const [book, setBook] = useState(null);
  const list = state.clients.filter((c) => `${c.firstName} ${c.lastName} ${c.phone} ${c.email}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-5" data-testid="desk-clients">
      <SectionHead eyebrow="Lookup" title="Clients" />
      <input className="nb-input" placeholder="Search by name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} data-testid="desk-client-search" />
      <div className="grid gap-3 md:grid-cols-2">
        {list.map((c) => { const next = state.appointments.filter((a) => a.clientId === c.id && OPEN.includes(a.status)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0]; return (
          <div key={c.id} className="nb-card p-5" data-testid={`desk-client-${c.id}`}>
            <div className="flex items-center gap-3"><Avatar person={c} photo={c.photo} /><div className="flex-1"><p className="font-semibold">{c.firstName} {c.lastName}</p><p className="flex flex-wrap gap-3 text-xs text-nb-mute"><span className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span><span className="flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</span></p></div>
              {perm("createBooking") && <button onClick={() => setBook(c.id)} data-testid={`desk-client-book-${c.id}`} className="nb-btn-ghost h-9 px-3 text-xs"><Plus className="h-3.5 w-3.5" />Book</button>}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {perm("viewInsuranceStatus") && (c.insurance.length ? c.insurance.map((i) => <Pill key={i.id} tone={complete(i) ? "turq" : "amber"}>{complete(i) ? "Insurance complete" : "Insurance incomplete"}</Pill>) : <Pill>No insurance</Pill>)}
              <Pill tone="slate">Prefers {c.contactMethod}</Pill>{c.emergencyContact && <Pill tone="slate">Emergency contact on file</Pill>}
            </div>
            {next && <p className="mt-3 text-xs text-nb-mute">Next: {idx.services[next.serviceSlug].name} · {fmtDate(next.date)} {fmtTime(next.time)}</p>}
          </div>); })}
      </div>
      {book && <NewBookingDialog open clientId={book} onClose={() => setBook(null)} />}
    </div>
  );
}
