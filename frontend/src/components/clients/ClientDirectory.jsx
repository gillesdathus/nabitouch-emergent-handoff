import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, Mail, Phone, Receipt, UserRound, Users } from "lucide-react";
import { NewBookingDialog } from "@/components/NewBookingDialog";
import { CreateInvoiceDialog } from "@/components/CreateInvoiceDialog";
import { EmptyState, SearchField, Segmented } from "@/components/ds";
import { Avatar, Pill } from "@/components/ui-kit";
import { formatCents } from "@/lib/billing";
import { OPEN, fmtDate, fmtTime } from "@/lib/domain";
import { useInvoices } from "@/lib/useInvoices";
import { useDemo } from "@/store/DemoStore";

const FILTERS = [["all", "All"], ["upcoming", "Upcoming visit"], ["balance", "Balance due"], ["new", "No visits yet"]];
const insuranceReady = (i) => i.insurer && i.memberId;

function ClientCard({ c, info, base, canBook, canInvoice, showInsurance, onBook, onInvoice }) {
  const { next, visits, balance } = info;
  return (
    <article className="nb-panel flex min-w-0 flex-col p-4" data-testid={`client-card-${c.id}`}>
      <div className="flex min-w-0 items-start gap-3">
        <Avatar person={c} photo={c.photo} size={44} />
        <div className="min-w-0 flex-1">
          <Link to={`${base}/${c.id}`} className="block truncate font-semibold hover:text-nb-blue" data-testid={`client-card-name-${c.id}`}>{c.preferredName || c.firstName} {c.lastName}</Link>
          <p className="truncate text-xs text-nb-mute">{c.email || "No email"}</p>
          <p className="truncate text-xs text-nb-mute">{c.phone || "No phone"}</p>
        </div>
        {balance > 0 && <Pill tone="amber" testid={`client-card-balance-${c.id}`}>{formatCents(balance)} due</Pill>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="min-w-0 rounded-xl bg-sky-50/70 px-2.5 py-2"><dt className="text-nb-mute">Visits</dt><dd className="nb-num font-semibold">{visits}</dd></div>
        <div className="min-w-0 rounded-xl bg-sky-50/70 px-2.5 py-2"><dt className="text-nb-mute">Next visit</dt><dd className="truncate font-semibold">{next ? `${fmtDate(next.date, { month: "short", day: "numeric" })} · ${fmtTime(next.time)}` : "—"}</dd></div>
      </dl>
      {(showInsurance || c.marketingConsent) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {showInsurance && ((c.insurance || []).length ? <Pill tone={(c.insurance || []).every(insuranceReady) ? "turq" : "amber"}>{(c.insurance || []).every(insuranceReady) ? "Insurance on file" : "Insurance incomplete"}</Pill> : <Pill tone="slate">No insurance</Pill>)}
          {c.marketingConsent && <Pill tone="blue">Marketing opt-in</Pill>}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-sky-50 pt-3">
        <Link to={`${base}/${c.id}`} className="nb-btn-dark h-9 px-3 text-xs" data-testid={`client-card-open-${c.id}`}><UserRound className="h-3.5 w-3.5" />Record</Link>
        {canBook && <button type="button" onClick={() => onBook(c.id)} className="nb-btn-ghost h-9 px-3 text-xs" data-testid={`client-card-book-${c.id}`}><CalendarPlus className="h-3.5 w-3.5" />Book</button>}
        {canInvoice && <button type="button" onClick={() => onInvoice(c.id)} className="nb-btn-ghost h-9 px-3 text-xs" data-testid={`client-card-invoice-${c.id}`}><Receipt className="h-3.5 w-3.5" />Invoice</button>}
        {c.phone && <a href={`tel:${c.phone}`} aria-label={`Call ${c.firstName}`} className="nb-btn-ghost h-9 w-9 px-0" data-testid={`client-card-call-${c.id}`}><Phone className="h-3.5 w-3.5" /></a>}
        {c.email && <a href={`mailto:${c.email}`} aria-label={`Email ${c.firstName}`} className="nb-btn-ghost h-9 w-9 px-0" data-testid={`client-card-email-${c.id}`}><Mail className="h-3.5 w-3.5" /></a>}
      </div>
    </article>
  );
}

export function ClientDirectory({ role = "owner" }) {
  const { state, perm } = useDemo();
  const owner = role === "owner";
  const canBook = owner || perm("createBooking");
  const canInvoice = owner || perm("managePayments");
  const { rows: invoices } = useInvoices({}, canInvoice);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [book, setBook] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const info = useMemo(() => {
    const out = {};
    state.clients.forEach((c) => { out[c.id] = { visits: 0, next: null, balance: 0 }; });
    [...state.appointments].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).forEach((a) => {
      const row = out[a.clientId];
      if (!row) return;
      if (!["cancelled", "no_show"].includes(a.status)) row.visits += 1;
      if (!row.next && OPEN.includes(a.status)) row.next = a;
    });
    (invoices || []).forEach((r) => { if (out[r.clientId] && !["draft", "voided"].includes(r.state)) out[r.clientId].balance += r.balance?.cents || 0; });
    return out;
  }, [state.clients, state.appointments, invoices]);
  const needle = q.trim().toLowerCase();
  const list = state.clients
    .filter((c) => !needle || `${c.firstName} ${c.lastName} ${c.preferredName || ""} ${c.email || ""} ${c.phone || ""}`.toLowerCase().includes(needle))
    .filter((c) => filter === "all" || (filter === "upcoming" && info[c.id].next) || (filter === "balance" && info[c.id].balance > 0) || (filter === "new" && !info[c.id].visits))
    .sort((a, b) => `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`));
  const base = owner ? "/owner/clients" : "/desk/clients";
  return (
    <div className="space-y-4" data-testid="client-directory">
      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
        <SearchField value={q} onChange={setQ} placeholder="Search name, phone or email" testid="client-search" />
        <Segmented options={FILTERS} value={filter} onChange={setFilter} testid="client-filter" label="Client filter" />
      </div>
      <p className="text-xs text-nb-mute" data-testid="client-count">{list.length} of {state.clients.length} clients</p>
      {list.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => <ClientCard key={c.id} c={c} info={info[c.id]} base={base} canBook={canBook} canInvoice={canInvoice} showInsurance={owner || perm("viewInsuranceStatus")} onBook={setBook} onInvoice={setInvoice} />)}
        </div>
      ) : <EmptyState icon={Users} title={state.clients.length ? "No clients match" : "No clients yet"} body={state.clients.length ? "Clear the search or choose another filter." : "Clients appear after their first booking or when you add one during a phone booking."} testid="client-empty" />}
      {book && <NewBookingDialog open clientId={book} onClose={() => setBook(null)} />}
      {invoice && <CreateInvoiceDialog open clientId={invoice} onClose={() => setInvoice(null)} />}
    </div>
  );
}
