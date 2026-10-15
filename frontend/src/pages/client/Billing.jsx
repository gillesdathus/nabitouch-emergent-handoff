import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight, FileText, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { EmptyState, Notice, PageHeader, Reveal, Segmented } from "@/components/tide";
import { InvoiceStatePill } from "@/components/billing/InvoiceBits";
import { InvoiceDrawer } from "@/components/billing/InvoiceDrawer";
import { formatCents } from "@/lib/billing";
import { restrictedFlag } from "@/lib/feature-flags";
import { fmtDate } from "@/lib/domain";
import { sumInvoices, useInvoices } from "@/lib/useInvoices";
import { useDemo } from "@/store/DemoStore";

const FILTERS = [{ value: "open", label: "Open" }, { value: "insurance", label: "Insurance" }, { value: "paid", label: "Paid" }, { value: "all", label: "All" }];
const pick = (f, r) => f === "all" || (f === "open" && r.balance.cents > 0 && r.state !== "voided") || (f === "paid" && r.state === "paid") || (f === "insurance" && (r.claimed.cents > 0 || r.insuranceReceived.cents > 0 || r.expectedInsurance.cents > 0));

function Summary({ totals }) {
  const tiles = [
    ["Outstanding", totals.balance, "billing-sum-balance", "text-nb-ink", `${totals.open} open`],
    ["Insurance pending", totals.insurancePending, "billing-sum-ins-pending", "text-cyan-700", "Not yet received"],
    ["Insurance received", totals.insuranceReceived, "billing-sum-ins-received", "text-nb-teal", "Confirmed"],
    ["You've paid", totals.clientPaid, "billing-sum-client-paid", "text-nb-teal", "Confirmed"],
  ];
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="billing-summary">
      {tiles.map(([label, cents, id, tone, hint], i) => (
        <Reveal key={id} i={i}>
          <div className={`h-full rounded-3xl p-4 ${i === 0 ? "nb-lagoon text-white" : "nb-card"}`} data-testid={id}>
            <p className={`text-xs ${i === 0 ? "text-white/75" : "text-nb-mute"}`}>{label}</p>
            <p className={`nb-num mt-1 text-2xl font-semibold ${i === 0 ? "text-white" : tone}`}>{formatCents(cents)}</p>
            <p className={`mt-0.5 text-[11px] ${i === 0 ? "text-white/70" : "text-slate-400"}`}>{hint}</p>
          </div>
        </Reveal>
      ))}
    </section>
  );
}

function InvoiceRow({ invoice, onOpen, i }) {
  return (
    <Reveal i={i}>
      <button type="button" onClick={onOpen} data-testid={`billing-invoice-${invoice.id}`} className="nb-card group flex w-full items-center gap-4 p-4 text-left transition-transform duration-200 hover:-translate-y-0.5">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl tint-lagoon"><FileText className="h-5 w-5 text-nb-blue" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{invoice.number || "Draft"}</span><InvoiceStatePill invoice={invoice} /></span>
          <span className="mt-0.5 block truncate text-xs text-nb-mute">{invoice.service}{invoice.serviceDate ? ` · ${fmtDate(invoice.serviceDate)}` : ""}</span>
          {invoice.expectedInsurance.cents > 0 && <span className="mt-1 flex items-center gap-1 text-[11px] text-cyan-700"><ShieldCheck className="h-3 w-3" />{invoice.expectedInsurance.display} insurance pending</span>}
        </span>
        <span className="text-right"><span className="nb-num block text-base font-semibold">{invoice.balance.cents > 0 ? invoice.balance.display : invoice.total.display}</span><span className="block text-[11px] text-nb-mute">{invoice.balance.cents > 0 ? "due" : "total"}</span></span>
        <ChevronRight className="h-4 w-4 text-sky-300 transition-transform group-hover:translate-x-0.5" />
      </button>
    </Reveal>
  );
}

export default function Billing() {
  const { me, idx } = useDemo();
  const { rows, error, reload, replace } = useInvoices();
  const [filter, setFilter] = useState("open");
  const [openId, setOpenId] = useState(null);
  const flags = { cardsOn: restrictedFlag(idx?.settings, "cardCheckoutEnabled"), emailOn: restrictedFlag(idx?.settings, "invoiceEmailEnabled"), giftOn: restrictedFlag(idx?.settings, "giftCardsEnabled") };
  if (!me) return <div className="mx-auto max-w-xl px-5 py-16 text-center"><p>Please sign in to see your invoices.</p><Link to="/login" className="nb-btn-primary mt-4" data-testid="billing-signin-link">Sign in</Link></div>;
  const totals = sumInvoices(rows);
  const list = (rows || []).filter((r) => r.state !== "draft" && pick(filter, r));
  const active = (rows || []).find((r) => r.id === openId);
  return (
    <div className="mx-auto max-w-5xl px-5 py-8 nb-page" data-testid="client-billing-page">
      <Link to="/me" data-testid="billing-back" className="mb-4 inline-flex items-center gap-1 text-sm text-nb-mute"><ArrowLeft className="h-4 w-4" />My Nabitouch</Link>
      <PageHeader eyebrow="Billing" title="Invoices & payments" sub="Every amount comes from your issued invoices. Insurance counts as paid only once it is received." right={<button type="button" onClick={reload} aria-label="Refresh" data-testid="billing-refresh" className="grid h-10 w-10 place-items-center rounded-full bg-white ring-1 ring-sky-100"><RefreshCw className="h-4 w-4 text-nb-blue" /></button>} />
      {rows === undefined ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((n) => <div key={n} className="h-24 rounded-3xl nb-skeleton" />)}</div> : <Summary totals={totals} />}
      {error && <Notice className="mt-4" testid="billing-error">{error}</Notice>}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Your invoices</h2><Segmented testid="billing-filter" value={filter} onChange={setFilter} options={FILTERS} /></div>
      <div className="mt-4 space-y-3" data-testid="billing-invoice-list">
        {rows === undefined && [0, 1, 2].map((n) => <div key={n} className="h-20 rounded-3xl nb-skeleton" />)}
        {rows && list.length === 0 && <EmptyState icon={Wallet} testid="billing-empty" title={filter === "open" ? "Nothing owing" : "No invoices here"} body="Invoices appear after a visit is invoiced by Nabitouch." />}
        {list.map((invoice, i) => <InvoiceRow key={invoice.id} invoice={invoice} i={i} onOpen={() => setOpenId(invoice.id)} />)}
      </div>
      <Notice className="mt-8" testid="billing-insurance-note">Nabitouch does not submit insurance claims for you. Approved insurance is shown separately and is never counted as a payment until the insurer's money is received.</Notice>
      <InvoiceDrawer invoice={active} open={Boolean(active)} onOpenChange={(o) => !o && setOpenId(null)} flags={flags} onChange={replace} />
    </div>
  );
}
